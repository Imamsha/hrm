import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  confirmEmployeeSchema,
  createBankAccountSchema,
  createEmployeeSchema,
  DOCUMENT_MAX_BYTES,
  employeeListQuerySchema,
  employeeSettingsSchema,
  extendProbationSchema,
  jobChangeSchema,
  linkMemberSchema,
  rejoinSchema,
  separationSchema,
  statutoryIdsSchema,
  updateBankAccountSchema,
  updateDocumentSchema,
  updateEmployeeSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  CurrentPrincipal,
  RequirePermissions,
  RequireScopedPermissions,
} from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { EmployeeDocumentsService, type UploadedFileLike } from './employee-documents.service.js';
import { EmployeeRecordsService } from './employee-records.service.js';
import { EmployeeSensitiveService } from './employee-sensitive.service.js';
import { EmployeesService } from './employees.service.js';
import { EmploymentService } from './employment.service.js';

const P = PERMISSIONS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();

/** RFC 6266 Content-Disposition with an ASCII fallback and UTF-8 name. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Employee management (HR). Endpoints accept grants at any scope; services restrict data to
 * the caller's scopes (ABAC) and answer 404 for employees outside them.
 */
@ApiTags('Employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly employment: EmploymentService,
    private readonly records: EmployeeRecordsService,
    private readonly sensitive: EmployeeSensitiveService,
    private readonly documents: EmployeeDocumentsService,
  ) {}

  // ------------------------------------------------------------------ directory & profile
  @Get()
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_READ)
  @ApiOperation({ summary: 'Employee directory (limited to the caller’s scopes)' })
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(employeeListQuerySchema)) q: z.output<typeof employeeListQuerySchema>,
  ) {
    return this.employees.list(p, q);
  }

  @Post()
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_CREATE)
  @ApiOperation({ summary: 'Add an employee (joining) with their first job assignment' })
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(createEmployeeSchema)) body: z.output<typeof createEmployeeSchema>,
  ) {
    return this.employees.create(p, body);
  }

  @Get('settings')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_CREATE)
  getSettings(@CurrentPrincipal() p: AuthPrincipal) {
    return this.employees.getSettings(p);
  }

  @Put('settings')
  @RequirePermissions(P.EMPLOYEES_SETTINGS_MANAGE)
  updateSettings(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(employeeSettingsSchema)) body: z.output<typeof employeeSettingsSchema>,
  ) {
    return this.employees.updateSettings(p, body);
  }

  @Get(':id')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_READ)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.employees.get(p, id);
  }

  @Patch(':id')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_UPDATE)
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(updateEmployeeSchema)) body: z.output<typeof updateEmployeeSchema>,
  ) {
    return this.employees.update(p, id, body);
  }

  @Put(':id/member')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_UPDATE)
  @ApiOperation({ summary: 'Link or unlink the employee’s login account (membership)' })
  linkMember(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(linkMemberSchema)) body: z.output<typeof linkMemberSchema>,
  ) {
    return this.employees.linkMember(p, id, body.membershipId);
  }

  @Get(':id/direct-reports')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_READ)
  directReports(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.employees.directReports(p, id);
  }

  // ------------------------------------------------------------------ lifecycle
  @Get(':id/employment-history')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_READ)
  history(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.employment.history(p, id);
  }

  @Post(':id/job-changes')
  @RequireScopedPermissions(P.EMPLOYEES_LIFECYCLE_MANAGE)
  @ApiOperation({ summary: 'Transfer, promotion, redesignation or manager change from a date' })
  jobChange(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(jobChangeSchema)) body: z.output<typeof jobChangeSchema>,
  ) {
    return this.employment.jobChange(p, id, body);
  }

  @Post(':id/confirmation')
  @RequireScopedPermissions(P.EMPLOYEES_LIFECYCLE_MANAGE)
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(confirmEmployeeSchema)) body: z.output<typeof confirmEmployeeSchema>,
  ) {
    return this.employment.confirm(p, id, body);
  }

  @Post(':id/probation-extension')
  @RequireScopedPermissions(P.EMPLOYEES_LIFECYCLE_MANAGE)
  @HttpCode(HttpStatus.OK)
  extendProbation(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(extendProbationSchema)) body: z.output<typeof extendProbationSchema>,
  ) {
    return this.employment.extendProbation(p, id, body);
  }

  @Post(':id/separation')
  @RequireScopedPermissions(P.EMPLOYEES_LIFECYCLE_MANAGE)
  @HttpCode(HttpStatus.OK)
  startSeparation(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(separationSchema)) body: z.output<typeof separationSchema>,
  ) {
    return this.employment.startSeparation(p, id, body);
  }

  @Delete(':id/separation')
  @RequireScopedPermissions(P.EMPLOYEES_LIFECYCLE_MANAGE)
  withdrawSeparation(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.employment.withdrawSeparation(p, id);
  }

  @Post(':id/separation/complete')
  @RequireScopedPermissions(P.EMPLOYEES_LIFECYCLE_MANAGE)
  @HttpCode(HttpStatus.OK)
  completeSeparation(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.employment.completeSeparation(p, id);
  }

  @Post(':id/rejoin')
  @RequireScopedPermissions(P.EMPLOYEES_LIFECYCLE_MANAGE)
  @HttpCode(HttpStatus.OK)
  rejoin(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(rejoinSchema)) body: z.output<typeof rejoinSchema>,
  ) {
    return this.employment.rejoin(p, id, body);
  }

  // ------------------------------------------------------------------ bank & statutory
  @Get(':id/bank-accounts')
  @RequireScopedPermissions(P.EMPLOYEES_SENSITIVE_READ)
  listBank(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.sensitive.listBankAccounts(p, id);
  }

  @Post(':id/bank-accounts')
  @RequireScopedPermissions(P.EMPLOYEES_SENSITIVE_MANAGE)
  createBank(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(createBankAccountSchema)) body: z.output<typeof createBankAccountSchema>,
  ) {
    return this.sensitive.createBankAccount(p, id, body);
  }

  @Patch(':id/bank-accounts/:accountId')
  @RequireScopedPermissions(P.EMPLOYEES_SENSITIVE_MANAGE)
  updateBank(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('accountId', uuid) accountId: string,
    @Body(pipe(updateBankAccountSchema)) body: z.output<typeof updateBankAccountSchema>,
  ) {
    return this.sensitive.updateBankAccount(p, id, accountId, body);
  }

  @Delete(':id/bank-accounts/:accountId')
  @RequireScopedPermissions(P.EMPLOYEES_SENSITIVE_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeBank(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('accountId', uuid) accountId: string,
  ) {
    await this.sensitive.removeBankAccount(p, id, accountId);
  }

  @Post(':id/bank-accounts/:accountId/reveal')
  @RequireScopedPermissions(P.EMPLOYEES_SENSITIVE_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Full account number (audited)' })
  revealBank(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('accountId', uuid) accountId: string,
  ) {
    return this.sensitive.revealBankAccount(p, id, accountId);
  }

  @Get(':id/statutory-ids')
  @RequireScopedPermissions(P.EMPLOYEES_SENSITIVE_READ)
  getStatutory(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.sensitive.getStatutory(p, id);
  }

  @Put(':id/statutory-ids')
  @RequireScopedPermissions(P.EMPLOYEES_SENSITIVE_MANAGE)
  setStatutory(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(statutoryIdsSchema)) body: z.output<typeof statutoryIdsSchema>,
  ) {
    return this.sensitive.setStatutory(p, id, body);
  }

  @Post(':id/statutory-ids/reveal')
  @RequireScopedPermissions(P.EMPLOYEES_SENSITIVE_READ)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Full PAN / UAN (audited)' })
  revealStatutory(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.sensitive.revealStatutory(p, id);
  }

  // ------------------------------------------------------------------ documents
  @Get(':id/documents')
  @RequireScopedPermissions(P.EMPLOYEES_DOCUMENT_READ)
  listDocuments(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.documents.list(p, id);
  }

  @Post(':id/documents')
  @RequireScopedPermissions(P.EMPLOYEES_DOCUMENT_MANAGE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES + 1, files: 1 } }),
  )
  upload(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @Body() fields: unknown,
  ) {
    return this.documents.upload(p, id, file, fields);
  }

  @Get(':id/documents/:documentId/download')
  @RequireScopedPermissions(P.EMPLOYEES_DOCUMENT_READ)
  async download(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('documentId', uuid) documentId: string,
  ) {
    const doc = await this.documents.open(p, id, documentId);
    return new StreamableFile(doc.stream, {
      type: doc.contentType,
      length: doc.sizeBytes,
      disposition: contentDisposition(doc.fileName),
    });
  }

  @Patch(':id/documents/:documentId')
  @RequireScopedPermissions(P.EMPLOYEES_DOCUMENT_MANAGE)
  updateDocument(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('documentId', uuid) documentId: string,
    @Body(pipe(updateDocumentSchema)) body: z.output<typeof updateDocumentSchema>,
  ) {
    return this.documents.update(p, id, documentId, body);
  }

  @Delete(':id/documents/:documentId')
  @RequireScopedPermissions(P.EMPLOYEES_DOCUMENT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDocument(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('documentId', uuid) documentId: string,
  ) {
    await this.documents.remove(p, id, documentId);
  }

  // ------------------------------------------------------------------ profile collections
  // Declared last: `:collection` is validated by the service (unknown names → 404).
  @Get(':id/:collection')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_READ)
  listCollection(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('collection') collection: string,
  ) {
    return this.records.list(p, 'hr', id, collection);
  }

  @Post(':id/:collection')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_UPDATE)
  createInCollection(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('collection') collection: string,
    @Body() body: unknown,
  ) {
    return this.records.create(p, 'hr', id, collection, body);
  }

  @Patch(':id/:collection/:itemId')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_UPDATE)
  updateInCollection(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('collection') collection: string,
    @Param('itemId', uuid) itemId: string,
    @Body() body: unknown,
  ) {
    return this.records.update(p, 'hr', id, collection, itemId, body);
  }

  @Delete(':id/:collection/:itemId')
  @RequireScopedPermissions(P.EMPLOYEES_EMPLOYEE_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFromCollection(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('collection') collection: string,
    @Param('itemId', uuid) itemId: string,
  ) {
    await this.records.remove(p, 'hr', id, collection, itemId);
  }
}

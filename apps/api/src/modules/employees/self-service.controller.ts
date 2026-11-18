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
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import { updateSelfSchema } from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { EmployeeDocumentsService } from './employee-documents.service.js';
import { EmployeeRecordsService } from './employee-records.service.js';
import { EmployeeSensitiveService } from './employee-sensitive.service.js';
import { contentDisposition } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';
import { EmploymentService } from './employment.service.js';

const uuid = new ParseUUIDPipe();

/** Employee self-service: the caller's own record only (linked through their membership). */
@ApiTags('Employee self-service')
@ApiBearerAuth()
@RequirePermissions(PERMISSIONS.EMPLOYEES_SELF_ACCESS)
@Controller('me/employee')
export class SelfServiceController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly employment: EmploymentService,
    private readonly records: EmployeeRecordsService,
    private readonly sensitive: EmployeeSensitiveService,
    private readonly documents: EmployeeDocumentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My employee profile' })
  async profile(@CurrentPrincipal() p: AuthPrincipal) {
    return this.employees.get(p, await this.employees.selfId(p));
  }

  @Patch()
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(updateSelfSchema)) body: z.output<typeof updateSelfSchema>,
  ) {
    return this.employees.updateSelf(p, body);
  }

  @Get('employment-history')
  async history(@CurrentPrincipal() p: AuthPrincipal) {
    return this.employment.history(p, await this.employees.selfId(p));
  }

  @Get('team')
  @ApiOperation({ summary: 'My direct reports' })
  team(@CurrentPrincipal() p: AuthPrincipal) {
    return this.employees.myTeam(p);
  }

  @Get('bank-accounts')
  async bank(@CurrentPrincipal() p: AuthPrincipal) {
    return this.sensitive.listBankAccounts(p, await this.employees.selfId(p), true);
  }

  @Get('statutory-ids')
  async statutory(@CurrentPrincipal() p: AuthPrincipal) {
    return this.sensitive.getStatutory(p, await this.employees.selfId(p), true);
  }

  @Get('documents')
  async listDocuments(@CurrentPrincipal() p: AuthPrincipal) {
    return this.documents.list(p, await this.employees.selfId(p), true);
  }

  @Get('documents/:documentId/download')
  async download(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('documentId', uuid) documentId: string,
  ) {
    const doc = await this.documents.open(p, await this.employees.selfId(p), documentId, true);
    return new StreamableFile(doc.stream, {
      type: doc.contentType,
      length: doc.sizeBytes,
      disposition: contentDisposition(doc.fileName),
    });
  }

  @Get(':collection')
  async list(@CurrentPrincipal() p: AuthPrincipal, @Param('collection') collection: string) {
    return this.records.list(p, 'self', await this.employees.selfId(p), collection);
  }

  @Post(':collection')
  async create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('collection') collection: string,
    @Body() body: unknown,
  ) {
    return this.records.create(p, 'self', await this.employees.selfId(p), collection, body);
  }

  @Patch(':collection/:itemId')
  async patch(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('collection') collection: string,
    @Param('itemId', uuid) itemId: string,
    @Body() body: unknown,
  ) {
    return this.records.update(p, 'self', await this.employees.selfId(p), collection, itemId, body);
  }

  @Delete(':collection/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('collection') collection: string,
    @Param('itemId', uuid) itemId: string,
  ) {
    await this.records.remove(p, 'self', await this.employees.selfId(p), collection, itemId);
  }
}

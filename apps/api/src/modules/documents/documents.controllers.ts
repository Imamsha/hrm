import type { Readable } from 'node:stream';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  declineSchema,
  DOCUMENT_MAX_BYTES,
  documentTemplateSchema,
  generateDocumentSchema,
  libraryDocumentSchema,
  otpAcceptSchema,
  templateVersionSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { RequestContext } from '../../common/context/request-context.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  AuthRateLimited,
  CurrentPrincipal,
  Public,
  RequirePermissions,
} from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import type { UploadedFileLike } from '../employees/employee-documents.service.js';
import { contentDisposition } from '../employees/employees.controller.js';
import { DocumentsService, type SignerContext } from './documents.service.js';
import { LibraryService } from './library.service.js';

const P = PERMISSIONS;
const SELF = P.EMPLOYEES_SELF_ACCESS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
const libraryStatusSchema = z.object({ status: z.enum(['PUBLISHED', 'ARCHIVED']) });
const listQuery = z.object({ employeeId: z.uuid().optional(), offerId: z.uuid().optional() });
const fileQuery = z.object({ certificate: z.stringbool().optional() });
const upload = FileInterceptor('file', { limits: { fileSize: DOCUMENT_MAX_BYTES + 1, files: 1 } });
/** Multipart fields arrive as strings. */
const libraryForm = libraryDocumentSchema.extend({
  requiresAcknowledgement: z.stringbool().default(false),
});

const signerContext = (): SignerContext => {
  const ctx = RequestContext.get();
  return { ip: ctx?.ipAddress ?? null, userAgent: ctx?.userAgent ?? null };
};
const pdf = (f: { stream: Readable; fileName: string; size: number }) =>
  new StreamableFile(f.stream, {
    type: 'application/pdf',
    ...(f.size ? { length: f.size } : {}),
    disposition: contentDisposition(f.fileName),
  });

@ApiTags('Documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(
    private readonly docs: DocumentsService,
    private readonly library: LibraryService,
  ) {}

  @Get('documents/templates')
  @RequirePermissions(P.DOCUMENTS_TEMPLATE_MANAGE)
  templates() {
    return this.docs.templates();
  }

  @Post('documents/templates')
  @RequirePermissions(P.DOCUMENTS_TEMPLATE_MANAGE)
  createTemplate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(documentTemplateSchema)) b: Out<typeof documentTemplateSchema>,
  ) {
    return this.docs.createTemplate(p, b);
  }

  @Post('documents/templates/:id/versions')
  @RequirePermissions(P.DOCUMENTS_TEMPLATE_MANAGE)
  newVersion(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(templateVersionSchema)) b: Out<typeof templateVersionSchema>,
  ) {
    return this.docs.newVersion(p, id, b);
  }

  @Put('documents/templates/:id/status')
  @RequirePermissions(P.DOCUMENTS_TEMPLATE_MANAGE)
  templateStatus(
    @Param('id', uuid) id: string,
    @Body(pipe(statusSchema)) b: Out<typeof statusSchema>,
  ) {
    return this.docs.setTemplateStatus(id, b.status);
  }

  /** Generated documents the caller may see (all for document generators). */
  @Get('documents')
  @RequirePermissions(SELF)
  list(@CurrentPrincipal() p: AuthPrincipal, @Query(pipe(listQuery)) q: Out<typeof listQuery>) {
    return this.docs.list(p, q);
  }

  @Post('documents')
  @RequirePermissions(P.DOCUMENTS_DOCUMENT_GENERATE)
  generate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(generateDocumentSchema)) b: Out<typeof generateDocumentSchema>,
  ) {
    return this.docs.generate(p, b);
  }

  @Get('documents/:id')
  @RequirePermissions(SELF)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.docs.get(p, id);
  }

  @Get('documents/:id/file')
  @RequirePermissions(SELF)
  async file(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query(pipe(fileQuery)) q: Out<typeof fileQuery>,
  ) {
    return pdf(await this.docs.open(p, id, q.certificate ?? false));
  }

  @Post('documents/:id/accept')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  accept(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.docs.accept(p, id, signerContext());
  }

  @Post('documents/:id/decline')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  decline(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(declineSchema)) b: Out<typeof declineSchema>,
  ) {
    return this.docs.decline(p, id, b, signerContext());
  }

  // ---------------------------------------------------------------------------- library

  @Get('library')
  @RequirePermissions(SELF)
  libraryList(@CurrentPrincipal() p: AuthPrincipal) {
    return this.library.list(p);
  }

  @Post('library')
  @RequirePermissions(P.DOCUMENTS_LIBRARY_MANAGE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  publish(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(libraryForm)) b: Out<typeof libraryForm>,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.library.create(p, b, file);
  }

  @Post('library/:id/versions')
  @RequirePermissions(P.DOCUMENTS_LIBRARY_MANAGE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(upload)
  libraryVersion(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.library.newVersion(p, id, file);
  }

  @Put('library/:id/status')
  @RequirePermissions(P.DOCUMENTS_LIBRARY_MANAGE)
  libraryStatus(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(libraryStatusSchema)) b: Out<typeof libraryStatusSchema>,
  ) {
    return this.library.setStatus(p, id, b.status);
  }

  @Post('library/:id/acknowledge')
  @RequirePermissions(SELF)
  @HttpCode(HttpStatus.OK)
  acknowledge(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.library.acknowledge(p, id);
  }

  @Get('library/:id/file')
  @RequirePermissions(SELF)
  async libraryFile(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return pdf(await this.library.open(p, id));
  }
}

/** Candidates accept offer letters from an e-mailed link, confirmed by a one-time code. */
@ApiTags('Documents')
@Public()
@Controller('public/acceptance/:token')
export class PublicAcceptanceController {
  constructor(private readonly docs: DocumentsService) {}

  @Get()
  view(@Param('token') token: string) {
    return this.docs.publicView(token);
  }

  @Get('file')
  async file(@Param('token') token: string) {
    return pdf(await this.docs.publicFile(token));
  }

  @Post('code')
  @AuthRateLimited()
  @HttpCode(HttpStatus.OK)
  code(@Param('token') token: string) {
    return this.docs.sendCode(token);
  }

  @Post('accept')
  @AuthRateLimited()
  @HttpCode(HttpStatus.OK)
  accept(
    @Param('token') token: string,
    @Body(pipe(otpAcceptSchema)) b: Out<typeof otpAcceptSchema>,
  ) {
    return this.docs.publicAccept(token, b.code, signerContext());
  }

  @Post('decline')
  @AuthRateLimited()
  @HttpCode(HttpStatus.OK)
  decline(@Param('token') token: string, @Body(pipe(declineSchema)) b: Out<typeof declineSchema>) {
    return this.docs.publicDecline(token, b.reason, signerContext());
  }
}

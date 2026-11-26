import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { DocumentsController, PublicAcceptanceController } from './documents.controllers.js';
import { DocumentsService } from './documents.service.js';
import { LibraryService } from './library.service.js';
import { PdfService } from './pdf.service.js';
import { StatementsService } from './statements.service.js';

/**
 * Templates, generated letters with e-acceptance, the company library, and system PDFs
 * (Phase 11a, ADR-018). Global so payroll and billing can render payslips and invoices.
 */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [DocumentsController, PublicAcceptanceController],
  providers: [AuditService, PdfService, StatementsService, DocumentsService, LibraryService],
  exports: [StatementsService],
})
export class DocumentsModule {}

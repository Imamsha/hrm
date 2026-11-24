import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { BillingService } from './billing.service.js';
import { ClientsService } from './clients.service.js';
import { PortalService } from './portal.service.js';
import {
  BillingController,
  ClientsController,
  PortalController,
  ProjectsController,
  TimesheetsController,
} from './projects.controllers.js';
import { ProjectsService } from './projects.service.js';
import { TimesheetsService } from './timesheets.service.js';

/** Clients, projects, work items, sprints, timesheets, billing and the client portal (Phase 10, ADR-017). */
@Module({
  controllers: [
    ClientsController,
    ProjectsController,
    TimesheetsController,
    BillingController,
    PortalController,
  ],
  providers: [
    AuditService,
    ClientsService,
    ProjectsService,
    TimesheetsService,
    BillingService,
    PortalService,
  ],
})
export class ProjectsModule {}

import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { BranchesService } from './branches.service.js';
import { CalendarsController } from './calendars.controller.js';
import { CalendarsService } from './calendars.service.js';
import { CompaniesService } from './companies.service.js';
import { CostCentersService } from './cost-centers.service.js';
import { DepartmentsService } from './departments.service.js';
import { JobCatalogController } from './job-catalog.controller.js';
import { JobCatalogService } from './job-catalog.service.js';
import { LegalEntitiesService } from './legal-entities.service.js';
import { LocationsService } from './locations.service.js';
import { OrgChartService } from './org-chart.service.js';
import { StructureController } from './structure.controller.js';
import { TeamsService } from './teams.service.js';

/** Organization structure, job catalog and calendars (Phase 03). */
@Module({
  controllers: [StructureController, JobCatalogController, CalendarsController],
  providers: [
    AuditService,
    CompaniesService,
    LegalEntitiesService,
    LocationsService,
    BranchesService,
    CostCentersService,
    DepartmentsService,
    TeamsService,
    JobCatalogService,
    CalendarsService,
    OrgChartService,
  ],
  exports: [DepartmentsService],
})
export class StructureModule {}

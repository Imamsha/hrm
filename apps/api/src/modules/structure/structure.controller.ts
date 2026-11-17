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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  createBranchSchema,
  createCompanySchema,
  createCostCenterSchema,
  createDepartmentSchema,
  createLegalEntitySchema,
  createLocationSchema,
  createTeamSchema,
  structureListQuerySchema,
  updateBranchSchema,
  updateCompanySchema,
  updateCostCenterSchema,
  updateDepartmentSchema,
  updateLegalEntitySchema,
  updateLocationSchema,
  updateTeamSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { BranchesService } from './branches.service.js';
import { CompaniesService } from './companies.service.js';
import { CostCentersService } from './cost-centers.service.js';
import { DepartmentsService } from './departments.service.js';
import { LegalEntitiesService } from './legal-entities.service.js';
import { LocationsService } from './locations.service.js';
import { TeamsService } from './teams.service.js';

const READ = PERMISSIONS.ORGANIZATION_STRUCTURE_READ;
const MANAGE = PERMISSIONS.ORGANIZATION_STRUCTURE_MANAGE;
const listPipe = new ZodValidationPipe(structureListQuerySchema);
type ListQuery = z.output<typeof structureListQuerySchema>;

@ApiTags('Organization structure')
@ApiBearerAuth()
@Controller()
export class StructureController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly legalEntities: LegalEntitiesService,
    private readonly locations: LocationsService,
    private readonly branches: BranchesService,
    private readonly costCenters: CostCentersService,
    private readonly departments: DepartmentsService,
    private readonly teams: TeamsService,
  ) {}

  // ------------------------------------------------------------------ companies
  @Get('companies')
  @RequirePermissions(READ)
  listCompanies(@Query(listPipe) q: ListQuery) {
    return this.companies.list(q);
  }

  @Get('companies/:id')
  @RequirePermissions(READ)
  getCompany(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.get(id);
  }

  @Post('companies')
  @RequirePermissions(MANAGE)
  createCompany(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createCompanySchema)) body: z.output<typeof createCompanySchema>,
  ) {
    return this.companies.create(p, body);
  }

  @Patch('companies/:id')
  @RequirePermissions(MANAGE)
  updateCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCompanySchema)) body: z.output<typeof updateCompanySchema>,
  ) {
    return this.companies.update(id, body);
  }

  @Delete('companies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeCompany(@Param('id', ParseUUIDPipe) id: string) {
    await this.companies.remove(id);
  }

  // ------------------------------------------------------------------ legal entities
  @Get('legal-entities')
  @RequirePermissions(READ)
  listLegalEntities(@Query(listPipe) q: ListQuery) {
    return this.legalEntities.list(q);
  }

  @Get('legal-entities/:id')
  @RequirePermissions(READ)
  getLegalEntity(@Param('id', ParseUUIDPipe) id: string) {
    return this.legalEntities.get(id);
  }

  @Post('legal-entities')
  @RequirePermissions(MANAGE)
  createLegalEntity(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createLegalEntitySchema))
    body: z.output<typeof createLegalEntitySchema>,
  ) {
    return this.legalEntities.create(p, body);
  }

  @Patch('legal-entities/:id')
  @RequirePermissions(MANAGE)
  updateLegalEntity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLegalEntitySchema))
    body: z.output<typeof updateLegalEntitySchema>,
  ) {
    return this.legalEntities.update(id, body);
  }

  @Delete('legal-entities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeLegalEntity(@Param('id', ParseUUIDPipe) id: string) {
    await this.legalEntities.remove(id);
  }

  // ------------------------------------------------------------------ locations
  @Get('locations')
  @RequirePermissions(READ)
  listLocations(@Query(listPipe) q: ListQuery) {
    return this.locations.list(q);
  }

  @Get('locations/:id')
  @RequirePermissions(READ)
  getLocation(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.get(id);
  }

  @Post('locations')
  @RequirePermissions(MANAGE)
  createLocation(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createLocationSchema)) body: z.output<typeof createLocationSchema>,
  ) {
    return this.locations.create(p, body);
  }

  @Patch('locations/:id')
  @RequirePermissions(MANAGE)
  updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLocationSchema)) body: z.output<typeof updateLocationSchema>,
  ) {
    return this.locations.update(id, body);
  }

  @Delete('locations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeLocation(@Param('id', ParseUUIDPipe) id: string) {
    await this.locations.remove(id);
  }

  // ------------------------------------------------------------------ branches
  @Get('branches')
  @RequirePermissions(READ)
  listBranches(@Query(listPipe) q: ListQuery) {
    return this.branches.list(q);
  }

  @Get('branches/:id')
  @RequirePermissions(READ)
  getBranch(@Param('id', ParseUUIDPipe) id: string) {
    return this.branches.get(id);
  }

  @Post('branches')
  @RequirePermissions(MANAGE)
  createBranch(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createBranchSchema)) body: z.output<typeof createBranchSchema>,
  ) {
    return this.branches.create(p, body);
  }

  @Patch('branches/:id')
  @RequirePermissions(MANAGE)
  updateBranch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateBranchSchema)) body: z.output<typeof updateBranchSchema>,
  ) {
    return this.branches.update(id, body);
  }

  @Delete('branches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeBranch(@Param('id', ParseUUIDPipe) id: string) {
    await this.branches.remove(id);
  }

  // ------------------------------------------------------------------ cost centers
  @Get('cost-centers')
  @RequirePermissions(READ)
  listCostCenters(@Query(listPipe) q: ListQuery) {
    return this.costCenters.list(q);
  }

  @Get('cost-centers/:id')
  @RequirePermissions(READ)
  getCostCenter(@Param('id', ParseUUIDPipe) id: string) {
    return this.costCenters.get(id);
  }

  @Post('cost-centers')
  @RequirePermissions(MANAGE)
  createCostCenter(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createCostCenterSchema))
    body: z.output<typeof createCostCenterSchema>,
  ) {
    return this.costCenters.create(p, body);
  }

  @Patch('cost-centers/:id')
  @RequirePermissions(MANAGE)
  updateCostCenter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCostCenterSchema))
    body: z.output<typeof updateCostCenterSchema>,
  ) {
    return this.costCenters.update(id, body);
  }

  @Delete('cost-centers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeCostCenter(@Param('id', ParseUUIDPipe) id: string) {
    await this.costCenters.remove(id);
  }

  // ------------------------------------------------------------------ departments
  @Get('departments')
  @RequirePermissions(READ)
  listDepartments(@Query(listPipe) q: ListQuery) {
    return this.departments.list(q);
  }

  @Get('departments/:id')
  @RequirePermissions(READ)
  getDepartment(@Param('id', ParseUUIDPipe) id: string) {
    return this.departments.get(id);
  }

  @Post('departments')
  @RequirePermissions(MANAGE)
  createDepartment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createDepartmentSchema))
    body: z.output<typeof createDepartmentSchema>,
  ) {
    return this.departments.create(p, body);
  }

  @Patch('departments/:id')
  @RequirePermissions(MANAGE)
  updateDepartment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDepartmentSchema))
    body: z.output<typeof updateDepartmentSchema>,
  ) {
    return this.departments.update(p, id, body);
  }

  @Delete('departments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeDepartment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.departments.remove(p, id);
  }

  // ------------------------------------------------------------------ teams
  @Get('teams')
  @RequirePermissions(READ)
  listTeams(@Query(listPipe) q: ListQuery) {
    return this.teams.list(q);
  }

  @Get('teams/:id')
  @RequirePermissions(READ)
  getTeam(@Param('id', ParseUUIDPipe) id: string) {
    return this.teams.get(id);
  }

  @Post('teams')
  @RequirePermissions(MANAGE)
  createTeam(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createTeamSchema)) body: z.output<typeof createTeamSchema>,
  ) {
    return this.teams.create(p, body);
  }

  @Patch('teams/:id')
  @RequirePermissions(MANAGE)
  updateTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTeamSchema)) body: z.output<typeof updateTeamSchema>,
  ) {
    return this.teams.update(id, body);
  }

  @Delete('teams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeTeam(@Param('id', ParseUUIDPipe) id: string) {
    await this.teams.remove(id);
  }
}

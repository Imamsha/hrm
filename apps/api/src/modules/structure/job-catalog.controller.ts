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
  createDesignationSchema,
  createJobGradeSchema,
  structureListQuerySchema,
  updateDesignationSchema,
  updateJobGradeSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { JobCatalogService } from './job-catalog.service.js';

const READ = PERMISSIONS.ORGANIZATION_JOB_CATALOG_READ;
const MANAGE = PERMISSIONS.ORGANIZATION_JOB_CATALOG_MANAGE;
const listPipe = new ZodValidationPipe(structureListQuerySchema);
type ListQuery = z.output<typeof structureListQuerySchema>;

@ApiTags('Job catalog')
@ApiBearerAuth()
@Controller()
export class JobCatalogController {
  constructor(private readonly catalog: JobCatalogService) {}

  @Get('job-grades')
  @RequirePermissions(READ)
  listGrades(@Query(listPipe) q: ListQuery) {
    return this.catalog.listGrades(q);
  }

  @Post('job-grades')
  @RequirePermissions(MANAGE)
  createGrade(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createJobGradeSchema)) body: z.output<typeof createJobGradeSchema>,
  ) {
    return this.catalog.createGrade(p, body);
  }

  @Patch('job-grades/:id')
  @RequirePermissions(MANAGE)
  updateGrade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateJobGradeSchema)) body: z.output<typeof updateJobGradeSchema>,
  ) {
    return this.catalog.updateGrade(id, body);
  }

  @Delete('job-grades/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeGrade(@Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.removeGrade(id);
  }

  @Get('designations')
  @RequirePermissions(READ)
  listDesignations(@Query(listPipe) q: ListQuery) {
    return this.catalog.listDesignations(q);
  }

  @Get('designations/:id')
  @RequirePermissions(READ)
  getDesignation(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getDesignation(id);
  }

  @Post('designations')
  @RequirePermissions(MANAGE)
  createDesignation(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(new ZodValidationPipe(createDesignationSchema))
    body: z.output<typeof createDesignationSchema>,
  ) {
    return this.catalog.createDesignation(p, body);
  }

  @Patch('designations/:id')
  @RequirePermissions(MANAGE)
  updateDesignation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateDesignationSchema))
    body: z.output<typeof updateDesignationSchema>,
  ) {
    return this.catalog.updateDesignation(id, body);
  }

  @Delete('designations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(MANAGE)
  async removeDesignation(@Param('id', ParseUUIDPipe) id: string) {
    await this.catalog.removeDesignation(id);
  }
}

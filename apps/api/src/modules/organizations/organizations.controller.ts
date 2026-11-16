import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type OrganizationDetails, PERMISSIONS, type SubscriptionDetails } from '@hrm/shared-types';
import { createOrganizationSchema, updateOrganizationSchema } from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('current')
  @RequirePermissions(PERMISSIONS.ORGANIZATION_SETTINGS_READ)
  getCurrent(): Promise<OrganizationDetails> {
    return this.organizations.getCurrent();
  }

  @Patch('current')
  @RequirePermissions(PERMISSIONS.ORGANIZATION_SETTINGS_UPDATE)
  updateCurrent(
    @Body(new ZodValidationPipe(updateOrganizationSchema))
    body: z.output<typeof updateOrganizationSchema>,
  ): Promise<OrganizationDetails> {
    return this.organizations.updateCurrent(body);
  }

  @Post()
  @ApiOperation({
    summary: 'Create another organization; the caller becomes its owner and it becomes active',
  })
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(createOrganizationSchema))
    body: z.output<typeof createOrganizationSchema>,
  ) {
    return this.organizations.create(principal, body);
  }

  @Get('current/subscription')
  @RequirePermissions(PERMISSIONS.SUBSCRIPTION_PLAN_READ)
  getSubscription(): Promise<SubscriptionDetails> {
    return this.organizations.getSubscription();
  }
}

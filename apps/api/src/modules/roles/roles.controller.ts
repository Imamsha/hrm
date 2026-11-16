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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type PermissionCatalogItem, type RoleDetails } from '@hrm/shared-types';
import { createRoleSchema, updateRoleSchema } from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { RolesService } from './roles.service.js';

@ApiTags('Roles & permissions')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.ROLES_ROLE_READ)
  catalog(): Promise<PermissionCatalogItem[]> {
    return this.roles.catalog();
  }

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_ROLE_READ)
  list(): Promise<RoleDetails[]> {
    return this.roles.list();
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_ROLE_MANAGE)
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(createRoleSchema)) body: z.output<typeof createRoleSchema>,
  ): Promise<RoleDetails> {
    return this.roles.create(principal, body);
  }

  @Patch('roles/:id')
  @RequirePermissions(PERMISSIONS.ROLES_ROLE_MANAGE)
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: z.output<typeof updateRoleSchema>,
  ): Promise<RoleDetails> {
    return this.roles.update(principal, id, body);
  }

  @Delete('roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.ROLES_ROLE_MANAGE)
  async remove(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.roles.remove(principal, id);
  }
}

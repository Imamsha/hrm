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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type MemberListItem, type PaginatedResult, PERMISSIONS } from '@hrm/shared-types';
import {
  memberListQuerySchema,
  scopedRoleAssignmentSchema,
  setMemberRolesSchema,
  updateMemberSchema,
} from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { MembersService } from './members.service.js';
import { RoleAssignmentsService } from './role-assignments.service.js';

@ApiTags('Members')
@ApiBearerAuth()
@Controller('members')
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly assignments: RoleAssignmentsService,
  ) {}

  @Get(':membershipId/role-assignments')
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_READ)
  listAssignments(@Param('membershipId', ParseUUIDPipe) membershipId: string) {
    return this.assignments.list(membershipId);
  }

  @Post(':membershipId/role-assignments')
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_UPDATE)
  addAssignment(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(scopedRoleAssignmentSchema))
    body: z.output<typeof scopedRoleAssignmentSchema>,
  ) {
    return this.assignments.add(principal, membershipId, body);
  }

  @Delete(':membershipId/role-assignments/:assignmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_UPDATE)
  async removeAssignment(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
  ) {
    await this.assignments.remove(principal, membershipId, assignmentId);
  }

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_READ)
  list(
    @Query(new ZodValidationPipe(memberListQuerySchema))
    query: z.output<typeof memberListQuerySchema>,
  ): Promise<PaginatedResult<MemberListItem>> {
    return this.members.list(query);
  }

  @Patch(':membershipId')
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_UPDATE)
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(updateMemberSchema)) body: z.output<typeof updateMemberSchema>,
  ): Promise<MemberListItem> {
    return this.members.updateStatus(principal, membershipId, body.status);
  }

  @Put(':membershipId/roles')
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_UPDATE)
  setRoles(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(setMemberRolesSchema)) body: z.output<typeof setMemberRolesSchema>,
  ): Promise<MemberListItem> {
    return this.members.setRoles(principal, membershipId, body.roleIds);
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_REMOVE)
  async remove(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ) {
    await this.members.remove(principal, membershipId);
  }
}

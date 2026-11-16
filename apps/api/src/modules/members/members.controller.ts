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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { type MemberListItem, type PaginatedResult, PERMISSIONS } from '@hrm/shared-types';
import { memberListQuerySchema, setMemberRolesSchema, updateMemberSchema } from '@hrm/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { MembersService } from './members.service.js';

@ApiTags('Members')
@ApiBearerAuth()
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

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

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type InvitationItem, type InvitationPreview, PERMISSIONS } from '@hrm/shared-types';
import { acceptInvitationSchema, inviteMemberSchema } from '@hrm/validation';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import {
  AuthRateLimited,
  CurrentPrincipal,
  OptionalPrincipal,
  Public,
  RequirePermissions,
} from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { deliverTokens } from '../auth/refresh-cookie.js';
import { InvitationsService } from './invitations.service.js';

const previewQuerySchema = z.object({ token: z.string().min(32).max(256) });

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly invitations: InvitationsService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_INVITE)
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(inviteMemberSchema)) body: z.output<typeof inviteMemberSchema>,
  ): Promise<InvitationItem> {
    return this.invitations.create(principal, body);
  }

  @Get()
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_READ)
  listPending(): Promise<InvitationItem[]> {
    return this.invitations.listPending();
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @RequirePermissions(PERMISSIONS.USERS_MEMBER_INVITE)
  async revoke(@Param('id', ParseUUIDPipe) id: string) {
    await this.invitations.revoke(id);
  }

  @Public()
  @AuthRateLimited()
  @Get('preview')
  @ApiOperation({ summary: 'Public details of an invitation for the accept page' })
  preview(
    @Query(new ZodValidationPipe(previewQuerySchema)) query: z.output<typeof previewQuerySchema>,
  ): Promise<InvitationPreview> {
    return this.invitations.preview(query.token);
  }

  @Public()
  @AuthRateLimited()
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an invitation (new account, or signed in as the invited e-mail)',
  })
  async accept(
    @OptionalPrincipal() principal: AuthPrincipal | undefined,
    @Body(new ZodValidationPipe(acceptInvitationSchema))
    body: z.output<typeof acceptInvitationSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, organizationId } = await this.invitations.accept(body, principal);
    return {
      organizationId,
      ...(tokens
        ? deliverTokens(res, tokens, body.tokenTransport, this.config.AUTH_COOKIE_SECURE)
        : {}),
    };
  }
}

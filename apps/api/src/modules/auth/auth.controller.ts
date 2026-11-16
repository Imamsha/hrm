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
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AuthEventItem,
  AuthTokens,
  LoginResult,
  MfaEnabledResult,
  MfaSetup,
  SessionInfo,
  SessionListItem,
} from '@hrm/shared-types';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaDisableSchema,
  mfaEnableSchema,
  mfaVerifySchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  switchOrganizationSchema,
} from '@hrm/validation';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AppException } from '../../common/http/app.exception.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/env.schema.js';
import { AuthRateLimited, CurrentPrincipal, Public } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { AuthService } from './auth.service.js';
import { MfaService } from './mfa.service.js';
import { clearRefreshCookie, deliverTokens, readRefreshCookie } from './refresh-cookie.js';
import { SecurityEventsService } from './security-events.service.js';
import { SessionsService } from './sessions.service.js';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionsService,
    private readonly events: SecurityEventsService,
  ) {}

  private get secureCookie() {
    return this.config.AUTH_COOKIE_SECURE;
  }

  @Public()
  @AuthRateLimited()
  @Post('register')
  @ApiOperation({ summary: 'Create an account, its organization (owner) and a trial subscription' })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: z.output<typeof registerSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.auth.register(body);
    return deliverTokens(res, tokens, body.tokenTransport, this.secureCookie);
  }

  @Public()
  @AuthRateLimited()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with e-mail and password (may require a second factor)' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: z.output<typeof loginSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const outcome = await this.auth.login(body);
    if (outcome.kind === 'mfa') return { mfaRequired: true, mfaToken: outcome.mfaToken };
    return deliverTokens(res, outcome.tokens, body.tokenTransport, this.secureCookie);
  }

  @Public()
  @AuthRateLimited()
  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete sign-in with an authenticator or recovery code' })
  async verifyMfa(
    @Body(new ZodValidationPipe(mfaVerifySchema)) body: z.output<typeof mfaVerifySchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.auth.verifyMfa(body);
    return deliverTokens(res, tokens, body.tokenTransport, this.secureCookie);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh token (cookie or body) and issue a new access token',
  })
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: z.output<typeof refreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const token = body.refreshToken ?? readRefreshCookie(req);
    if (!token) throw AppException.unauthenticated('No refresh token');
    try {
      const tokens = await this.sessions.refresh(token);
      return deliverTokens(
        res,
        tokens,
        body.refreshToken ? 'body' : body.tokenTransport,
        this.secureCookie,
      );
    } catch (err) {
      clearRefreshCookie(res, this.secureCookie);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  async logout(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(principal);
    clearRefreshCookie(res, this.secureCookie);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  async logoutAll(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logoutAll(principal);
    clearRefreshCookie(res, this.secureCookie);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user, memberships and effective permissions' })
  me(@CurrentPrincipal() principal: AuthPrincipal): Promise<SessionInfo> {
    return this.auth.me(principal);
  }

  @Post('switch-organization')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  switchOrganization(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(switchOrganizationSchema))
    body: z.output<typeof switchOrganizationSchema>,
  ): Promise<AuthTokens> {
    return this.auth.switchOrganization(principal, body.organizationId);
  }

  @Public()
  @AuthRateLimited()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a password reset link (same response whether or not the account exists)',
  })
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) body: z.output<typeof forgotPasswordSchema>,
  ): Promise<{ accepted: true }> {
    await this.auth.requestPasswordReset(body.email);
    return { accepted: true };
  }

  @Public()
  @AuthRateLimited()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: z.output<typeof resetPasswordSchema>,
  ) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  async changePassword(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: z.output<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(principal, body.currentPassword, body.newPassword);
  }

  @Post('mfa/totp/setup')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  mfaSetup(@CurrentPrincipal() principal: AuthPrincipal): Promise<MfaSetup> {
    return this.mfa.setup(principal);
  }

  @Post('mfa/totp/enable')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  mfaEnable(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(mfaEnableSchema)) body: z.output<typeof mfaEnableSchema>,
  ): Promise<MfaEnabledResult> {
    return this.mfa.enable(principal, body.code);
  }

  @Post('mfa/totp/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  async mfaDisable(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(mfaDisableSchema)) body: z.output<typeof mfaDisableSchema>,
  ) {
    await this.mfa.disable(principal, body.password, body.code);
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Active sessions (devices) of the current user' })
  listSessions(@CurrentPrincipal() principal: AuthPrincipal): Promise<SessionListItem[]> {
    return this.sessions.listForUser(principal.userId, principal.sessionId);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  async revokeSession(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.sessions.revokeOwn(principal.userId, id);
  }

  @Get('login-history')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Recent security events of the current user' })
  loginHistory(@CurrentPrincipal() principal: AuthPrincipal): Promise<AuthEventItem[]> {
    return this.events.listForUser(principal.userId);
  }
}

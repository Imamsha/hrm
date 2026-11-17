import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { MfaService } from './auth/mfa.service.js';
import { SecurityEventsService } from './auth/security-events.service.js';
import { SessionsService } from './auth/sessions.service.js';
import { InvitationsController } from './members/invitations.controller.js';
import { InvitationsService } from './members/invitations.service.js';
import { MembersController } from './members/members.controller.js';
import { MembersService } from './members/members.service.js';
import { RoleAssignmentsService } from './members/role-assignments.service.js';
import { OrganizationProvisioner } from './organizations/organization-provisioner.service.js';
import { OrganizationsController } from './organizations/organizations.controller.js';
import { OrganizationsService } from './organizations/organizations.service.js';
import { RolesController } from './roles/roles.controller.js';
import { RolesService } from './roles/roles.service.js';

/**
 * Identity & access bounded context: authentication, sessions, organizations (tenants), members,
 * invitations, roles/permissions, audit and subscription read-model. Grouped in one Nest module
 * because these services are tightly coupled (provisioning creates roles, members and sessions);
 * each concern keeps its own service/controller files.
 */
@Module({
  controllers: [
    AuthController,
    OrganizationsController,
    MembersController,
    InvitationsController,
    RolesController,
    AuditController,
  ],
  providers: [
    AuthService,
    MfaService,
    SessionsService,
    SecurityEventsService,
    OrganizationProvisioner,
    OrganizationsService,
    MembersService,
    RoleAssignmentsService,
    InvitationsService,
    RolesService,
    AuditService,
  ],
  exports: [AuditService, SecurityEventsService],
})
export class IdentityModule {}

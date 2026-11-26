import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  approvalDecisionSchema,
  delegationSchema,
  workflowDefinitionSchema,
  workflowStatusSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { WorkflowsService } from './workflows.service.js';

const P = PERMISSIONS;
const SELF = P.EMPLOYEES_SELF_ACCESS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;
const historyQuery = z.object({
  process: z.enum(['LEAVE_REQUEST', 'EXPENSE_CLAIM', 'TRAVEL_REQUEST', 'TIMESHEET', 'RESIGNATION']),
  subjectId: z.uuid(),
});

@ApiTags('Workflows')
@ApiBearerAuth()
@Controller()
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get('workflows')
  @RequirePermissions(P.WORKFLOWS_DEFINITION_MANAGE)
  definitions() {
    return this.workflows.definitions();
  }

  @Post('workflows')
  @RequirePermissions(P.WORKFLOWS_DEFINITION_MANAGE)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(workflowDefinitionSchema)) b: Out<typeof workflowDefinitionSchema>,
  ) {
    return this.workflows.create(p, b);
  }

  @Put('workflows/:id/status')
  @RequirePermissions(P.WORKFLOWS_DEFINITION_MANAGE)
  status(
    @Param('id', uuid) id: string,
    @Body(pipe(workflowStatusSchema)) b: Out<typeof workflowStatusSchema>,
  ) {
    return this.workflows.setStatus(id, b);
  }

  @Get('me/approval-tasks')
  @RequirePermissions(SELF)
  inbox(@CurrentPrincipal() p: AuthPrincipal) {
    return this.workflows.inbox(p);
  }

  @Post('approvals/:taskId/decision')
  @RequirePermissions(SELF)
  decide(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('taskId', uuid) taskId: string,
    @Body(pipe(approvalDecisionSchema)) b: Out<typeof approvalDecisionSchema>,
  ) {
    return this.workflows.decide(p, taskId, b);
  }

  /** The approval trail of one request (requester, deciders, or workflow readers). */
  @Get('approvals/history')
  @RequirePermissions(SELF)
  history(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(historyQuery)) q: Out<typeof historyQuery>,
  ) {
    return this.workflows.history(p, q.process, q.subjectId);
  }

  @Get('me/delegations')
  @RequirePermissions(SELF)
  delegations(@CurrentPrincipal() p: AuthPrincipal) {
    return this.workflows.myDelegations(p);
  }

  @Post('me/delegations')
  @RequirePermissions(SELF)
  delegate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(delegationSchema)) b: Out<typeof delegationSchema>,
  ) {
    return this.workflows.delegate(p, b);
  }

  @Delete('me/delegations/:id')
  @RequirePermissions(SELF)
  revoke(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.workflows.revoke(p, id);
  }
}

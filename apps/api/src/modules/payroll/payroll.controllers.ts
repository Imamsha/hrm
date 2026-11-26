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
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  createPayrollRunSchema,
  employeeSalarySchema,
  financialYearSchema,
  isoDateSchema,
  payrollAdjustmentSchema,
  payrollProfileSchema,
  payrollRunListQuerySchema,
  payrollSettingsSchema,
  ruleSetStatusSchema,
  runDecisionSchema,
  salaryComponentSchema,
  salaryStructureSchema,
  settlementSchema,
  statutoryRuleSetSchema,
  taxDeclarationSchema,
  updateSalaryComponentSchema,
  updateSalaryStructureSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import { PayrollConfigService } from './payroll-config.service.js';
import { PayrollEmployeesService } from './payroll-employees.service.js';
import { PayrollRunsService } from './payroll-runs.service.js';
import { SettlementsService } from './settlements.service.js';

const P = PERMISSIONS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;
const fyPipe = pipe(financialYearSchema);
const ruleFilterSchema = z.object({
  type: z.enum(['EPF', 'ESI', 'PT', 'INCOME_TAX', 'GRATUITY']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'RETIRED']).optional(),
});
const closeSchema = z.object({ effectiveTo: isoDateSchema });
const resultFilterSchema = z.object({ problemsOnly: z.stringbool().optional() });
const settlementFilterSchema = z.object({
  status: z.enum(['DRAFT', 'CALCULATED', 'APPROVED', 'FINALIZED', 'CANCELLED']).optional(),
});

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly config: PayrollConfigService,
    private readonly employees: PayrollEmployeesService,
    private readonly runs: PayrollRunsService,
    private readonly settlements: SettlementsService,
  ) {}

  // ------------------------------------------------------------------ settings
  @Get('settings')
  @RequirePermissions(P.PAYROLL_SALARY_READ)
  settings() {
    return this.config.getSettings();
  }

  @Put('settings')
  @RequirePermissions(P.PAYROLL_SETTINGS_MANAGE)
  putSettings(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(payrollSettingsSchema)) body: Out<typeof payrollSettingsSchema>,
  ) {
    return this.config.putSettings(p, body);
  }

  // ------------------------------------------------------------------ statutory rule sets
  @Get('rule-sets')
  @RequirePermissions(P.PAYROLL_RUN_READ)
  ruleSets(@Query(pipe(ruleFilterSchema)) q: Out<typeof ruleFilterSchema>) {
    return this.config.listRuleSets(q);
  }

  @Get('rule-sets/:id')
  @RequirePermissions(P.PAYROLL_RUN_READ)
  ruleSet(@Param('id', uuid) id: string) {
    return this.config.getRuleSet(id);
  }

  @Post('rule-sets')
  @RequirePermissions(P.PAYROLL_STATUTORY_MANAGE)
  @ApiOperation({
    summary: 'Create a DRAFT statutory rule set (values come from the cited official source)',
  })
  createRuleSet(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(statutoryRuleSetSchema)) body: Out<typeof statutoryRuleSetSchema>,
  ) {
    return this.config.createRuleSet(p, body);
  }

  @Put('rule-sets/:id')
  @RequirePermissions(P.PAYROLL_STATUTORY_MANAGE)
  updateRuleSet(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(statutoryRuleSetSchema)) body: Out<typeof statutoryRuleSetSchema>,
  ) {
    return this.config.updateRuleSet(p, id, body);
  }

  @Delete('rule-sets/:id')
  @RequirePermissions(P.PAYROLL_STATUTORY_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRuleSet(@Param('id', uuid) id: string) {
    return this.config.deleteRuleSet(id);
  }

  @Put('rule-sets/:id/status')
  @RequirePermissions(P.PAYROLL_STATUTORY_MANAGE)
  ruleSetStatus(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(ruleSetStatusSchema)) body: Out<typeof ruleSetStatusSchema>,
  ) {
    return this.config.setRuleSetStatus(p, id, body.status);
  }

  @Put('rule-sets/:id/close')
  @RequirePermissions(P.PAYROLL_STATUTORY_MANAGE)
  closeRuleSet(
    @Param('id', uuid) id: string,
    @Body(pipe(closeSchema)) body: Out<typeof closeSchema>,
  ) {
    return this.config.closeRuleSet(id, body.effectiveTo);
  }

  // ------------------------------------------------------------------ components & structures
  @Get('components')
  @RequirePermissions(P.PAYROLL_SALARY_READ)
  components() {
    return this.config.listComponents();
  }

  @Post('components')
  @RequirePermissions(P.PAYROLL_SETTINGS_MANAGE)
  createComponent(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(salaryComponentSchema)) body: Out<typeof salaryComponentSchema>,
  ) {
    return this.config.createComponent(p, body);
  }

  @Patch('components/:id')
  @RequirePermissions(P.PAYROLL_SETTINGS_MANAGE)
  updateComponent(
    @Param('id', uuid) id: string,
    @Body(pipe(updateSalaryComponentSchema)) body: Out<typeof updateSalaryComponentSchema>,
  ) {
    return this.config.updateComponent(id, body);
  }

  @Get('structures')
  @RequirePermissions(P.PAYROLL_SALARY_READ)
  structures() {
    return this.config.listStructures();
  }

  @Get('structures/:id')
  @RequirePermissions(P.PAYROLL_SALARY_READ)
  structure(@Param('id', uuid) id: string) {
    return this.config.getStructure(id);
  }

  @Post('structures')
  @RequirePermissions(P.PAYROLL_SETTINGS_MANAGE)
  createStructure(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(salaryStructureSchema)) body: Out<typeof salaryStructureSchema>,
  ) {
    return this.config.createStructure(p, body);
  }

  @Patch('structures/:id')
  @RequirePermissions(P.PAYROLL_SETTINGS_MANAGE)
  updateStructure(
    @Param('id', uuid) id: string,
    @Body(pipe(updateSalaryStructureSchema)) body: Out<typeof updateSalaryStructureSchema>,
  ) {
    return this.config.updateStructure(id, body);
  }

  // ------------------------------------------------------------------ employees
  @Get('employees/:id')
  @RequirePermissions(P.PAYROLL_SALARY_READ)
  employee(@Param('id', uuid) id: string) {
    return this.employees.get(id);
  }

  @Post('employees/:id/salaries')
  @RequirePermissions(P.PAYROLL_SALARY_MANAGE)
  addSalary(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(employeeSalarySchema)) body: Out<typeof employeeSalarySchema>,
  ) {
    return this.employees.addSalary(p, id, body);
  }

  @Delete('employees/:id/salaries/:salaryId')
  @RequirePermissions(P.PAYROLL_SALARY_MANAGE)
  deleteSalary(@Param('id', uuid) id: string, @Param('salaryId', uuid) salaryId: string) {
    return this.employees.deleteSalary(id, salaryId);
  }

  @Put('employees/:id/profile')
  @RequirePermissions(P.PAYROLL_SALARY_MANAGE)
  putProfile(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(payrollProfileSchema)) body: Out<typeof payrollProfileSchema>,
  ) {
    return this.employees.putProfile(p, id, body);
  }

  @Get('employees/:id/declarations/:fy')
  @RequirePermissions(P.PAYROLL_SALARY_READ)
  declaration(@Param('id', uuid) id: string, @Param('fy', fyPipe) fy: string) {
    return this.employees.declaration(id, fy);
  }

  @Put('employees/:id/declarations')
  @RequirePermissions(P.PAYROLL_SALARY_MANAGE)
  putDeclaration(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(taxDeclarationSchema)) body: Out<typeof taxDeclarationSchema>,
  ) {
    return this.employees.putDeclaration(p, id, body);
  }

  // ------------------------------------------------------------------ runs
  @Get('runs')
  @RequirePermissions(P.PAYROLL_RUN_READ)
  runList(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(payrollRunListQuerySchema)) q: Out<typeof payrollRunListQuerySchema>,
  ) {
    return this.runs.list(p, q);
  }

  @Post('runs')
  @RequirePermissions(P.PAYROLL_RUN_MANAGE)
  createRun(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(createPayrollRunSchema)) body: Out<typeof createPayrollRunSchema>,
  ) {
    return this.runs.create(p, body);
  }

  @Get('runs/:id')
  @RequirePermissions(P.PAYROLL_RUN_READ)
  run(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.runs.get(p, id);
  }

  @Post('runs/:id/calculate')
  @RequirePermissions(P.PAYROLL_RUN_MANAGE)
  @HttpCode(HttpStatus.OK)
  calculate(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.runs.calculate(p, id);
  }

  @Get('runs/:id/results')
  @RequirePermissions(P.PAYROLL_RUN_READ)
  results(
    @Param('id', uuid) id: string,
    @Query(pipe(resultFilterSchema)) q: Out<typeof resultFilterSchema>,
  ) {
    return this.runs.results(id, q);
  }

  @Get('runs/:id/adjustments')
  @RequirePermissions(P.PAYROLL_RUN_READ)
  adjustments(@Param('id', uuid) id: string) {
    return this.runs.adjustments(id);
  }

  @Post('runs/:id/adjustments')
  @RequirePermissions(P.PAYROLL_RUN_MANAGE)
  addAdjustment(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(payrollAdjustmentSchema)) body: Out<typeof payrollAdjustmentSchema>,
  ) {
    return this.runs.addAdjustment(p, id, body);
  }

  @Delete('runs/:id/adjustments/:adjustmentId')
  @RequirePermissions(P.PAYROLL_RUN_MANAGE)
  deleteAdjustment(
    @Param('id', uuid) id: string,
    @Param('adjustmentId', uuid) adjustmentId: string,
  ) {
    return this.runs.deleteAdjustment(id, adjustmentId);
  }

  @Post('runs/:id/decision')
  @RequirePermissions(P.PAYROLL_RUN_APPROVE)
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(runDecisionSchema)) body: Out<typeof runDecisionSchema>,
  ) {
    return this.runs.decide(p, id, body);
  }

  @Post('runs/:id/finalize')
  @RequirePermissions(P.PAYROLL_RUN_MANAGE)
  @HttpCode(HttpStatus.OK)
  finalize(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.runs.finalize(p, id);
  }

  @Post('runs/:id/cancel')
  @RequirePermissions(P.PAYROLL_RUN_MANAGE)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.runs.cancel(p, id);
  }

  @Get('runs/:id/bank-file')
  @RequirePermissions(P.PAYROLL_BANK_FILE_EXPORT)
  async bankFile(@Param('id', uuid) id: string) {
    const f = await this.runs.bankFile(id);
    const body = Buffer.from(f.content, 'utf8');
    return new StreamableFile(body, {
      type: 'text/csv; charset=utf-8',
      length: body.length,
      disposition: `attachment; filename="${f.filename}"`,
    });
  }

  @Get('payslips/:resultId')
  @RequirePermissions(P.PAYROLL_RUN_READ)
  payslip(@Param('resultId', uuid) resultId: string) {
    return this.runs.payslip(resultId);
  }

  @Get('payslips/:resultId/pdf')
  @RequirePermissions(P.PAYROLL_RUN_READ)
  async payslipPdf(@Param('resultId', uuid) resultId: string) {
    const f = await this.runs.payslipPdf(resultId);
    return new StreamableFile(Buffer.from(f.body), {
      type: 'application/pdf',
      length: f.body.length,
      disposition: `inline; filename="${f.fileName}"`,
    });
  }

  // ------------------------------------------------------------------ full & final
  @Get('settlements')
  @RequirePermissions(P.PAYROLL_SETTLEMENT_MANAGE)
  settlementList(
    @CurrentPrincipal() p: AuthPrincipal,
    @Query(pipe(settlementFilterSchema)) q: Out<typeof settlementFilterSchema>,
  ) {
    return this.settlements.list(p, q.status);
  }

  @Post('settlements')
  @RequirePermissions(P.PAYROLL_SETTLEMENT_MANAGE)
  createSettlement(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(settlementSchema)) body: Out<typeof settlementSchema>,
  ) {
    return this.settlements.create(p, body);
  }

  @Get('settlements/:id')
  @RequirePermissions(P.PAYROLL_SETTLEMENT_MANAGE)
  settlement(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.settlements.get(p, id);
  }

  @Put('settlements/:id')
  @RequirePermissions(P.PAYROLL_SETTLEMENT_MANAGE)
  recalculateSettlement(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(settlementSchema)) body: Out<typeof settlementSchema>,
  ) {
    return this.settlements.recalculate(p, id, body);
  }

  @Post('settlements/:id/decision')
  @RequirePermissions(P.PAYROLL_RUN_APPROVE)
  @HttpCode(HttpStatus.OK)
  decideSettlement(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(runDecisionSchema)) body: Out<typeof runDecisionSchema>,
  ) {
    return this.settlements.decide(p, id, body);
  }

  @Post('settlements/:id/finalize')
  @RequirePermissions(P.PAYROLL_SETTLEMENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  finalizeSettlement(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.settlements.finalize(p, id);
  }

  @Post('settlements/:id/cancel')
  @RequirePermissions(P.PAYROLL_SETTLEMENT_MANAGE)
  @HttpCode(HttpStatus.OK)
  cancelSettlement(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.settlements.cancel(p, id);
  }
}

/** Employee self-service: own salary, payslips and tax declarations. */
@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('me')
export class MyPayrollController {
  constructor(
    private readonly employees: PayrollEmployeesService,
    private readonly runs: PayrollRunsService,
  ) {}

  @Get('salary')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  salary(@CurrentPrincipal() p: AuthPrincipal) {
    return this.employees.mySalary(p);
  }

  @Get('payslips')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  payslips(@CurrentPrincipal() p: AuthPrincipal) {
    return this.runs.myPayslips(p);
  }

  @Get('payslips/:resultId')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  payslip(@CurrentPrincipal() p: AuthPrincipal, @Param('resultId', uuid) resultId: string) {
    return this.runs.myPayslip(p, resultId);
  }

  @Get('payslips/:resultId/pdf')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  async payslipPdf(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('resultId', uuid) resultId: string,
  ) {
    const f = await this.runs.myPayslipPdf(p, resultId);
    return new StreamableFile(Buffer.from(f.body), {
      type: 'application/pdf',
      length: f.body.length,
      disposition: `inline; filename="${f.fileName}"`,
    });
  }

  @Get('tax-declarations/:fy')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  declaration(@CurrentPrincipal() p: AuthPrincipal, @Param('fy', fyPipe) fy: string) {
    return this.employees.myDeclaration(p, fy);
  }

  @Put('tax-declarations')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  putDeclaration(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(taxDeclarationSchema)) body: Out<typeof taxDeclarationSchema>,
  ) {
    return this.employees.putMyDeclaration(p, body);
  }
}

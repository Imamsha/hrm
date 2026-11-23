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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hrm/shared-types';
import {
  assetAllocationSchema,
  assetCategorySchema,
  assetListQuerySchema,
  assetReturnSchema,
  assetSchema,
  assetStatusSchema,
  DOCUMENT_MAX_BYTES,
  expenseCategorySchema,
  expenseClaimSchema,
  expenseListQuerySchema,
  expenseSettingsSchema,
  financeDecisionSchema,
  licenseAssignmentSchema,
  maintenanceSchema,
  managerDecisionSchema,
  markPaidSchema,
  softwareLicenseSchema,
  travelAdvanceSchema,
  travelBookingSchema,
  travelDecisionSchema,
  travelRequestSchema,
  travelSettleSchema,
  updateAssetSchema,
  updateExpenseCategorySchema,
  updateSoftwareLicenseSchema,
} from '@hrm/validation';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentPrincipal, RequirePermissions } from '../access/decorators.js';
import type { AuthPrincipal } from '../access/principal.js';
import type { UploadedFileLike } from '../employees/employee-documents.service.js';
import { contentDisposition } from '../employees/employees.controller.js';
import { AssetsService } from './assets.service.js';
import { ExpensesService } from './expenses.service.js';
import { TravelService } from './travel.service.js';

const P = PERMISSIONS;
const pipe = <S extends z.ZodType>(s: S) => new ZodValidationPipe(s);
const uuid = new ParseUUIDPipe();
type Out<S extends z.ZodType> = z.output<S>;
const listPipe = pipe(expenseListQuerySchema);
type ListQuery = Out<typeof expenseListQuerySchema>;
const scopeSchema = expenseListQuerySchema.extend({
  scope: z.enum(['approvals', 'all']).default('approvals'),
});
const categoryQuerySchema = z.object({ includeInactive: z.stringbool().optional() });
const fileUpload = FileInterceptor('file', {
  limits: { fileSize: DOCUMENT_MAX_BYTES + 1, files: 1 },
});

@ApiTags('Expenses')
@ApiBearerAuth()
@Controller()
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get('expenses/settings')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  settings() {
    return this.expenses.settings();
  }

  @Put('expenses/settings')
  @RequirePermissions(P.EXPENSES_CATEGORY_MANAGE)
  putSettings(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(expenseSettingsSchema)) body: Out<typeof expenseSettingsSchema>,
  ) {
    return this.expenses.putSettings(p, body);
  }

  @Get('expenses/categories')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  categories(@Query(pipe(categoryQuerySchema)) q: Out<typeof categoryQuerySchema>) {
    return this.expenses.categories(q.includeInactive ?? false);
  }

  @Post('expenses/categories')
  @RequirePermissions(P.EXPENSES_CATEGORY_MANAGE)
  createCategory(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(expenseCategorySchema)) body: Out<typeof expenseCategorySchema>,
  ) {
    return this.expenses.createCategory(p, body);
  }

  @Patch('expenses/categories/:id')
  @RequirePermissions(P.EXPENSES_CATEGORY_MANAGE)
  updateCategory(
    @Param('id', uuid) id: string,
    @Body(pipe(updateExpenseCategorySchema)) body: Out<typeof updateExpenseCategorySchema>,
  ) {
    return this.expenses.updateCategory(id, body);
  }

  @Get('me/expense-claims')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  mine(@CurrentPrincipal() p: AuthPrincipal, @Query(listPipe) q: ListQuery) {
    return this.expenses.list(p, 'mine', q);
  }

  @Post('me/expense-claims')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(expenseClaimSchema)) body: Out<typeof expenseClaimSchema>,
  ) {
    return this.expenses.create(p, body);
  }

  /** `scope=approvals`: claims awaiting the caller as manager; `scope=all`: every claim (expenses.claim.read). */
  @Get('expense-claims')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  list(@CurrentPrincipal() p: AuthPrincipal, @Query(pipe(scopeSchema)) q: Out<typeof scopeSchema>) {
    return this.expenses.list(p, q.scope, q);
  }

  @Get('expense-claims/:id')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.expenses.get(p, id);
  }

  @Put('expense-claims/:id')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(expenseClaimSchema)) body: Out<typeof expenseClaimSchema>,
  ) {
    return this.expenses.update(p, id, body);
  }

  @Post('expense-claims/:id/items/:itemId/receipt')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(fileUpload)
  uploadReceipt(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
  ) {
    return this.expenses.uploadReceipt(p, id, itemId, file);
  }

  @Get('expense-claims/:id/items/:itemId/receipt')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  async receipt(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('itemId', uuid) itemId: string,
  ) {
    const r = await this.expenses.openReceipt(p, id, itemId);
    return new StreamableFile(r.stream, {
      type: r.contentType,
      length: r.sizeBytes,
      disposition: contentDisposition(r.fileName),
    });
  }

  @Post('expense-claims/:id/submit')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @HttpCode(HttpStatus.OK)
  submit(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.expenses.submit(p, id);
  }

  @Post('expense-claims/:id/cancel')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.expenses.cancel(p, id);
  }

  @Post('expense-claims/:id/reopen')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @HttpCode(HttpStatus.OK)
  reopen(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.expenses.reopen(p, id);
  }

  @Post('expense-claims/:id/manager-decision')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @HttpCode(HttpStatus.OK)
  managerDecision(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(managerDecisionSchema)) body: Out<typeof managerDecisionSchema>,
  ) {
    return this.expenses.managerDecision(p, id, body);
  }

  @Post('expense-claims/:id/finance-decision')
  @RequirePermissions(P.EXPENSES_CLAIM_VERIFY)
  @HttpCode(HttpStatus.OK)
  financeDecision(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(financeDecisionSchema)) body: Out<typeof financeDecisionSchema>,
  ) {
    return this.expenses.financeDecision(p, id, body);
  }

  @Post('expense-claims/:id/mark-paid')
  @RequirePermissions(P.EXPENSES_CLAIM_VERIFY)
  @HttpCode(HttpStatus.OK)
  markPaid(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(markPaidSchema)) body: Out<typeof markPaidSchema>,
  ) {
    return this.expenses.markPaid(p, id, body);
  }
}

@ApiTags('Travel')
@ApiBearerAuth()
@Controller()
export class TravelController {
  constructor(private readonly travel: TravelService) {}

  @Get('me/trips')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  mine(@CurrentPrincipal() p: AuthPrincipal, @Query(listPipe) q: ListQuery) {
    return this.travel.list(p, 'mine', q);
  }

  @Post('me/trips')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(travelRequestSchema)) body: Out<typeof travelRequestSchema>,
  ) {
    return this.travel.create(p, body);
  }

  @Get('trips')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  list(@CurrentPrincipal() p: AuthPrincipal, @Query(pipe(scopeSchema)) q: Out<typeof scopeSchema>) {
    return this.travel.list(p, q.scope, q);
  }

  @Get('trips/:id')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.travel.get(p, id);
  }

  @Post('trips/:id/decision')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(travelDecisionSchema)) body: Out<typeof travelDecisionSchema>,
  ) {
    return this.travel.decide(p, id, body);
  }

  @Post('trips/:id/cancel')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuid) id: string) {
    return this.travel.cancel(p, id);
  }

  @Post('trips/:id/bookings')
  @RequirePermissions(P.TRAVEL_DESK_MANAGE)
  addBooking(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(travelBookingSchema)) body: Out<typeof travelBookingSchema>,
  ) {
    return this.travel.addBooking(p, id, body);
  }

  @Delete('trips/:id/bookings/:bookingId')
  @RequirePermissions(P.TRAVEL_DESK_MANAGE)
  deleteBooking(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('bookingId', uuid) bookingId: string,
  ) {
    return this.travel.deleteBooking(p, id, bookingId);
  }

  @Post('trips/:id/advances')
  @RequirePermissions(P.TRAVEL_DESK_MANAGE)
  addAdvance(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(travelAdvanceSchema)) body: Out<typeof travelAdvanceSchema>,
  ) {
    return this.travel.addAdvance(p, id, body);
  }

  @Post('trips/:id/settle')
  @RequirePermissions(P.TRAVEL_DESK_MANAGE)
  @HttpCode(HttpStatus.OK)
  settle(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(travelSettleSchema)) body: Out<typeof travelSettleSchema>,
  ) {
    return this.travel.settle(p, id, body);
  }
}

@ApiTags('Assets')
@ApiBearerAuth()
@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('assets/categories')
  @RequirePermissions(P.ASSETS_ASSET_READ)
  categories() {
    return this.assets.categories();
  }

  @Post('assets/categories')
  @RequirePermissions(P.ASSETS_ASSET_MANAGE)
  createCategory(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(assetCategorySchema)) body: Out<typeof assetCategorySchema>,
  ) {
    return this.assets.createCategory(p, body);
  }

  @Get('assets')
  @RequirePermissions(P.ASSETS_ASSET_READ)
  list(@Query(pipe(assetListQuerySchema)) q: Out<typeof assetListQuerySchema>) {
    return this.assets.list(q);
  }

  @Post('assets')
  @RequirePermissions(P.ASSETS_ASSET_MANAGE)
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(assetSchema)) body: Out<typeof assetSchema>,
  ) {
    return this.assets.create(p, body);
  }

  @Get('assets/:id')
  @RequirePermissions(P.ASSETS_ASSET_READ)
  get(@Param('id', uuid) id: string) {
    return this.assets.get(id);
  }

  @Patch('assets/:id')
  @RequirePermissions(P.ASSETS_ASSET_MANAGE)
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(updateAssetSchema)) body: Out<typeof updateAssetSchema>,
  ) {
    return this.assets.update(p, id, body);
  }

  @Put('assets/:id/status')
  @RequirePermissions(P.ASSETS_ASSET_MANAGE)
  status(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(assetStatusSchema)) body: Out<typeof assetStatusSchema>,
  ) {
    return this.assets.setStatus(p, id, body);
  }

  @Post('assets/:id/allocate')
  @RequirePermissions(P.ASSETS_ASSET_MANAGE)
  @HttpCode(HttpStatus.OK)
  allocate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(assetAllocationSchema)) body: Out<typeof assetAllocationSchema>,
  ) {
    return this.assets.allocate(p, id, body);
  }

  @Post('assets/:id/return')
  @RequirePermissions(P.ASSETS_ASSET_MANAGE)
  @HttpCode(HttpStatus.OK)
  returnAsset(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(assetReturnSchema)) body: Out<typeof assetReturnSchema>,
  ) {
    return this.assets.returnAsset(p, id, body);
  }

  @Post('assets/:id/maintenance')
  @RequirePermissions(P.ASSETS_ASSET_MANAGE)
  maintenance(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(maintenanceSchema)) body: Out<typeof maintenanceSchema>,
  ) {
    return this.assets.addMaintenance(p, id, body);
  }

  @Get('licenses')
  @RequirePermissions(P.ASSETS_ASSET_READ)
  licenses() {
    return this.assets.licenses();
  }

  @Post('licenses')
  @RequirePermissions(P.ASSETS_LICENSE_MANAGE)
  createLicense(
    @CurrentPrincipal() p: AuthPrincipal,
    @Body(pipe(softwareLicenseSchema)) body: Out<typeof softwareLicenseSchema>,
  ) {
    return this.assets.createLicense(p, body);
  }

  @Patch('licenses/:id')
  @RequirePermissions(P.ASSETS_LICENSE_MANAGE)
  updateLicense(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(updateSoftwareLicenseSchema)) body: Out<typeof updateSoftwareLicenseSchema>,
  ) {
    return this.assets.updateLicense(p, id, body);
  }

  @Post('licenses/:id/seats')
  @RequirePermissions(P.ASSETS_LICENSE_MANAGE)
  assign(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body(pipe(licenseAssignmentSchema)) body: Out<typeof licenseAssignmentSchema>,
  ) {
    return this.assets.assignSeat(p, id, body.employeeId);
  }

  @Delete('licenses/:id/seats/:assignmentId')
  @RequirePermissions(P.ASSETS_LICENSE_MANAGE)
  revoke(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Param('assignmentId', uuid) assignmentId: string,
  ) {
    return this.assets.revokeSeat(p, id, assignmentId);
  }

  @Get('me/assets')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  mine(@CurrentPrincipal() p: AuthPrincipal) {
    return this.assets.mine(p);
  }

  @Post('me/assets/:allocationId/acknowledge')
  @RequirePermissions(P.EMPLOYEES_SELF_ACCESS)
  @HttpCode(HttpStatus.OK)
  acknowledge(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('allocationId', uuid) allocationId: string,
  ) {
    return this.assets.acknowledge(p, allocationId);
  }
}

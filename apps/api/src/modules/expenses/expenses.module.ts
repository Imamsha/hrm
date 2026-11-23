import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AssetsService } from './assets.service.js';
import { AssetsController, ExpensesController, TravelController } from './expenses.controllers.js';
import { ExpensesService } from './expenses.service.js';
import { TravelService } from './travel.service.js';

/** Expenses, travel and assets (Phase 08, ADR-015). */
@Module({
  controllers: [ExpensesController, TravelController, AssetsController],
  providers: [AuditService, ExpensesService, TravelService, AssetsService],
})
export class ExpensesModule {}

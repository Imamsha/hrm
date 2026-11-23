import { describe, expect, it } from 'vitest';
import {
  assetCategorySchema,
  assetSchema,
  exchangeRateSchema,
  expenseClaimSchema,
  financeDecisionSchema,
  managerDecisionSchema,
  travelRequestSchema,
} from './expenses.js';

const id = '0195f1d2-0000-7000-8000-000000000001';
const ok = (r: { success: boolean }) => r.success;

describe('expense claims', () => {
  it('defaults currency and rate and requires at least one item', () => {
    const c = expenseClaimSchema.parse({
      title: 'Client visit',
      items: [{ categoryId: id, date: '2026-11-10', description: 'Taxi', originalAmount: '450' }],
    });
    expect(c.items[0]).toMatchObject({
      currency: 'INR',
      exchangeRate: '1',
      days: 1,
    });
    expect(c.tripId).toBeNull();
    expect(ok(expenseClaimSchema.safeParse({ title: 'Empty', items: [] }))).toBe(false);
  });
  it('validates exchange rates and amounts', () => {
    expect(exchangeRateSchema.parse(83.214567)).toBe('83.214567');
    expect(ok(exchangeRateSchema.safeParse('0'))).toBe(false);
    expect(ok(exchangeRateSchema.safeParse('1.1234567'))).toBe(false);
    expect(
      ok(
        expenseClaimSchema.safeParse({
          title: 'x',
          items: [{ categoryId: id, date: '2026-11-10', description: 'x', originalAmount: '0' }],
        }),
      ),
    ).toBe(false);
  });
  it('needs reasons for rejections and unreimbursed items', () => {
    expect(ok(managerDecisionSchema.safeParse({ decision: 'REJECTED' }))).toBe(false);
    expect(ok(managerDecisionSchema.safeParse({ decision: 'APPROVED' }))).toBe(true);
    expect(
      ok(
        financeDecisionSchema.safeParse({
          decision: 'APPROVED',
          items: [{ itemId: id, approvedAmount: '0' }],
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        financeDecisionSchema.safeParse({
          decision: 'APPROVED',
          items: [{ itemId: id, approvedAmount: '0', note: 'Personal expense' }],
        }),
      ),
    ).toBe(true);
  });
});

describe('travel', () => {
  const trip = {
    purpose: 'Customer workshop',
    startDate: '2026-12-01',
    endDate: '2026-12-03',
    legs: [{ from: 'Bengaluru', to: 'Pune', departOn: '2026-12-01', mode: 'FLIGHT' }],
  };
  it('keeps legs within the trip dates', () => {
    expect(ok(travelRequestSchema.safeParse(trip))).toBe(true);
    expect(ok(travelRequestSchema.safeParse({ ...trip, endDate: '2026-11-30' }))).toBe(false);
    expect(
      ok(
        travelRequestSchema.safeParse({
          ...trip,
          legs: [{ ...trip.legs[0], departOn: '2026-12-05' }],
        }),
      ),
    ).toBe(false);
  });
});

describe('assets', () => {
  it('normalizes tags and checks warranty and salvage', () => {
    expect(assetSchema.parse({ tag: 'lap-001', name: 'Laptop', categoryId: id }).tag).toBe(
      'LAP-001',
    );
    expect(
      ok(
        assetSchema.safeParse({
          tag: 'L1',
          name: 'Laptop',
          categoryId: id,
          purchaseDate: '2026-01-01',
          warrantyEnd: '2025-12-31',
        }),
      ),
    ).toBe(false);
    expect(
      ok(assetCategorySchema.safeParse({ code: 'LAPTOP', name: 'Laptops', salvagePercent: '101' })),
    ).toBe(false);
    expect(
      assetCategorySchema.parse({
        code: 'LAPTOP',
        name: 'Laptops',
        usefulLifeMonths: '36',
        salvagePercent: 10,
      }),
    ).toMatchObject({ usefulLifeMonths: 36, salvagePercent: '10' });
  });
});

describe('partial updates', () => {
  it('leaves omitted asset dates and costs untouched instead of clearing them', async () => {
    const { updateAssetSchema } = await import('./expenses.js');
    expect(updateAssetSchema.parse({ name: 'Renamed' })).not.toHaveProperty('purchaseDate', null);
    expect(updateAssetSchema.parse({ name: 'Renamed' }).purchaseCost).toBeUndefined();
    expect(updateAssetSchema.parse({ purchaseCost: '' }).purchaseCost).toBeNull();
  });
});

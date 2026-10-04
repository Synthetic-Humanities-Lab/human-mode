import { describe, expect, it } from 'vitest';
import {
  CONTEXT_EXPANSION_COST_CENTS, createEmptySession, formatMoney,
  getBudgetRemainingCents, getOperationsMax, getTokenCostCents, moneyFromCents,
  OPERATION_COST_CENTS
} from '../../src/shared';

describe('simulated prices and fractional cents', () => {
  it('keeps text ten times cheaper than the previous rate and capacity independently priced', () => {
    expect(createEmptySession().budgetCents).toBe(1000);
    expect(OPERATION_COST_CENTS).toBe(10);
    expect(getTokenCostCents(1)).toBe(0.1);
    expect(getTokenCostCents(100)).toBe(10);
    expect(CONTEXT_EXPANSION_COST_CENTS).toBe(100);
  });

  it.each([
    [0, '$0.00', 0], [0.1, '$0.001', 0.001], [10, '$0.10', 0.1],
    [10.1, '$0.101', 0.101], [100, '$1.00', 1], [989.9, '$9.899', 9.899]
  ])('displays and exports %s cents without losing fractional charges', (cents, formatted, dollars) => {
    expect(formatMoney(cents as number)).toBe(formatted);
    expect(moneyFromCents(cents as number)).toBe(dollars);
  });

  it('does not round a nearly affordable action up to an affordable one', () => {
    const session = { ...createEmptySession(), spendCents: 990.1, operationsUsed: 90 };
    expect(getBudgetRemainingCents(session)).toBe(9.9);
    expect(getOperationsMax(session)).toBe(90);
  });
});

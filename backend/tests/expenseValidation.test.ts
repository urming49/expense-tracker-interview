import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ── replicate the schemas from the route (single source of truth for tests) ──

const validAmount = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .finite('Amount must be a finite number')
  .positive('Amount must be greater than 0');

const validDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((d) => {
    const parsed = new Date(d);
    return !isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d);
  }, 'Date must be a valid calendar date');

const createExpenseSchema = z.object({
  categoryId: z.number().int().positive(),
  amount: validAmount,
  description: z.string().min(1, 'Description is required').max(255),
  date: validDate,
});

const updateExpenseSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  amount: validAmount.optional(),
  description: z.string().min(1, 'Description is required').max(255).optional(),
  date: validDate.optional(),
});

// helper — returns field-keyed error messages
function parseErrors(schema: z.ZodTypeAny, data: unknown): Record<string, string> {
  const result = schema.safeParse(data);
  if (result.success) return {};
  return Object.fromEntries(result.error.errors.map((e) => [e.path.join('.'), e.message]));
}

// ── createExpenseSchema ───────────────────────────────────────────────────────

describe('createExpenseSchema — valid input', () => {
  it('accepts a well-formed expense', () => {
    const result = createExpenseSchema.safeParse({
      categoryId: 1,
      amount: 49.99,
      description: 'Lunch',
      date: '2026-01-15',
    });
    expect(result.success).toBe(true);
  });
});

describe('createExpenseSchema — amount', () => {
  it('rejects zero', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 0, description: 'x', date: '2026-01-01' });
    expect(errors.amount).toMatch(/greater than 0/i);
  });

  it('rejects negative amount', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: -5, description: 'x', date: '2026-01-01' });
    expect(errors.amount).toMatch(/greater than 0/i);
  });

  it('rejects Infinity', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: Infinity, description: 'x', date: '2026-01-01' });
    expect(errors.amount).toMatch(/finite/i);
  });

  it('rejects -Infinity', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: -Infinity, description: 'x', date: '2026-01-01' });
    expect(errors.amount).toBeDefined();
  });

  it('rejects NaN', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: NaN, description: 'x', date: '2026-01-01' });
    expect(errors.amount).toBeDefined();
  });

  it('rejects string amount', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 'fifty', description: 'x', date: '2026-01-01' });
    expect(errors.amount).toBeDefined();
  });

  it('rejects missing amount', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, description: 'x', date: '2026-01-01' });
    expect(errors.amount).toBeDefined();
  });
});

describe('createExpenseSchema — description', () => {
  it('rejects empty string', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 10, description: '', date: '2026-01-01' });
    expect(errors.description).toMatch(/required/i);
  });

  it('rejects missing description', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 10, date: '2026-01-01' });
    expect(errors.description).toBeDefined();
  });

  it('rejects description over 255 chars', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 10, description: 'a'.repeat(256), date: '2026-01-01' });
    expect(errors.description).toBeDefined();
  });

  it('accepts description of exactly 255 chars', () => {
    const result = createExpenseSchema.safeParse({ categoryId: 1, amount: 10, description: 'a'.repeat(255), date: '2026-01-01' });
    expect(result.success).toBe(true);
  });
});

describe('createExpenseSchema — date', () => {
  it('rejects wrong format MM/DD/YYYY', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 10, description: 'x', date: '01/15/2026' });
    expect(errors.date).toMatch(/YYYY-MM-DD/i);
  });

  it('rejects impossible date Feb 30', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 10, description: 'x', date: '2026-02-30' });
    expect(errors.date).toMatch(/valid calendar date/i);
  });

  it('rejects impossible date Apr 31', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 10, description: 'x', date: '2026-04-31' });
    expect(errors.date).toMatch(/valid calendar date/i);
  });

  it('rejects missing date', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 10, description: 'x' });
    expect(errors.date).toBeDefined();
  });

  it('accepts a valid leap-year date', () => {
    const result = createExpenseSchema.safeParse({ categoryId: 1, amount: 10, description: 'x', date: '2024-02-29' });
    expect(result.success).toBe(true);
  });

  it('rejects Feb 29 on a non-leap year', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1, amount: 10, description: 'x', date: '2026-02-29' });
    expect(errors.date).toMatch(/valid calendar date/i);
  });
});

describe('createExpenseSchema — categoryId', () => {
  it('rejects zero categoryId', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 0, amount: 10, description: 'x', date: '2026-01-01' });
    expect(errors.categoryId).toBeDefined();
  });

  it('rejects float categoryId', () => {
    const errors = parseErrors(createExpenseSchema, { categoryId: 1.5, amount: 10, description: 'x', date: '2026-01-01' });
    expect(errors.categoryId).toBeDefined();
  });
});

// ── updateExpenseSchema ───────────────────────────────────────────────────────

describe('updateExpenseSchema — partial updates', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = updateExpenseSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts only amount update', () => {
    const result = updateExpenseSchema.safeParse({ amount: 99.99 });
    expect(result.success).toBe(true);
  });

  it('rejects invalid amount in partial update', () => {
    const errors = parseErrors(updateExpenseSchema, { amount: -1 });
    expect(errors.amount).toMatch(/greater than 0/i);
  });

  it('rejects invalid date in partial update', () => {
    const errors = parseErrors(updateExpenseSchema, { date: '2026-13-01' });
    expect(errors.date).toBeDefined();
  });

  it('rejects empty description in partial update', () => {
    const errors = parseErrors(updateExpenseSchema, { description: '' });
    expect(errors.description).toMatch(/required/i);
  });
});

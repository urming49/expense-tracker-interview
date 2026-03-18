import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';

// Build an in-memory DB and wire the service against it
let db: KnexType;

// We re-implement the service inline so we can inject the test DB.
// Alternatively you could refactor the service to accept a db param.
async function setupDb() {
  db = Knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });

  await db.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('email').notNullable().unique();
    t.string('passwordHash').notNullable();
    t.timestamp('createdAt').defaultTo(db.fn.now());
  });

  await db.schema.createTable('categories', (t) => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('icon').notNullable();
  });

  await db.schema.createTable('expenses', (t) => {
    t.increments('id').primary();
    t.integer('userId').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('categoryId').notNullable().references('id').inTable('categories');
    t.decimal('amount', 10, 2).notNullable();
    t.string('description').notNullable();
    t.date('date').notNullable();
    t.timestamp('createdAt').defaultTo(db.fn.now());
  });

  await db('users').insert({ email: 'test@example.com', passwordHash: 'hash' });
  await db('categories').insert([
    { name: 'Food', icon: '🍔' },
    { name: 'Transport', icon: '🚗' },
  ]);
}

// --- inline service helpers bound to test db ---
async function createExpense(params: { userId: number; categoryId: number; amount: number; description: string; date: string }) {
  const [id] = await db('expenses').insert(params);
  return db('expenses').where({ id }).first();
}

async function listExpenses(userId: number, opts: { search?: string; startDate?: string; endDate?: string } = {}) {
  let q = db('expenses')
    .join('categories', 'expenses.categoryId', 'categories.id')
    .select('expenses.*', 'categories.name as categoryName')
    .where('expenses.userId', userId)
    .orderBy('expenses.date', 'desc');
  if (opts.startDate) q = q.where('expenses.date', '>=', opts.startDate);
  if (opts.endDate)   q = q.where('expenses.date', '<=', opts.endDate);
  if (opts.search)    q = q.where('expenses.description', 'like', `%${opts.search}%`);
  return q;
}

async function updateExpense(id: number, userId: number, params: object) {
  const existing = await db('expenses').where({ id, userId }).first();
  if (!existing) return null;
  await db('expenses').where({ id, userId }).update(params);
  return db('expenses').where({ id }).first();
}

async function deleteExpense(id: number, userId: number) {
  const deleted = await db('expenses').where({ id, userId }).delete();
  return deleted > 0;
}

async function getMonthlyTotal(userId: number, year: number, month: number) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];
  const result = await db('expenses')
    .where('userId', userId)
    .whereBetween('date', [startDate, endDate])
    .sum('amount as total')
    .first();
  return Number(result?.total) || 0;
}

// -----------------------------------------------

beforeAll(setupDb);
afterAll(() => db.destroy());
beforeEach(() => db('expenses').delete());

describe('createExpense', () => {
  it('inserts and returns the new expense', async () => {
    const expense = await createExpense({ userId: 1, categoryId: 1, amount: 25.5, description: 'Lunch', date: '2026-01-10' });
    expect(expense).toMatchObject({ userId: 1, categoryId: 1, amount: 25.5, description: 'Lunch' });
    expect(expense.id).toBeDefined();
  });

  it('stores the correct date', async () => {
    const expense = await createExpense({ userId: 1, categoryId: 1, amount: 10, description: 'Coffee', date: '2026-03-01' });
    expect(expense.date).toBe('2026-03-01');
  });
});

describe('listExpenses', () => {
  beforeEach(async () => {
    await createExpense({ userId: 1, categoryId: 1, amount: 10, description: 'Breakfast', date: '2026-01-05' });
    await createExpense({ userId: 1, categoryId: 2, amount: 20, description: 'Uber ride', date: '2026-01-10' });
    await createExpense({ userId: 1, categoryId: 1, amount: 30, description: 'Dinner', date: '2026-02-01' });
  });

  it('returns all expenses for the user', async () => {
    const results = await listExpenses(1);
    expect(results).toHaveLength(3);
  });

  it('does not return expenses of another user', async () => {
    const results = await listExpenses(999);
    expect(results).toHaveLength(0);
  });

  it('filters by search term', async () => {
    const results = await listExpenses(1, { search: 'uber' });
    expect(results).toHaveLength(1);
    expect(results[0].description).toBe('Uber ride');
  });

  it('filters by date range', async () => {
    const results = await listExpenses(1, { startDate: '2026-01-01', endDate: '2026-01-31' });
    expect(results).toHaveLength(2);
  });

  it('includes categoryName from join', async () => {
    const results = await listExpenses(1);
    expect(results[0].categoryName).toBeDefined();
  });
});

describe('updateExpense', () => {
  it('updates fields and returns updated record', async () => {
    const created = await createExpense({ userId: 1, categoryId: 1, amount: 50, description: 'Old', date: '2026-01-01' });
    const updated = await updateExpense(created.id, 1, { description: 'New', amount: 75 });
    expect(updated?.description).toBe('New');
    expect(Number(updated?.amount)).toBe(75);
  });

  it('returns null when expense does not belong to user', async () => {
    const created = await createExpense({ userId: 1, categoryId: 1, amount: 50, description: 'Test', date: '2026-01-01' });
    const result = await updateExpense(created.id, 999, { description: 'Hacked' });
    expect(result).toBeNull();
  });
});

describe('deleteExpense', () => {
  it('deletes the expense and returns true', async () => {
    const created = await createExpense({ userId: 1, categoryId: 1, amount: 15, description: 'Delete me', date: '2026-01-01' });
    const result = await deleteExpense(created.id, 1);
    expect(result).toBe(true);
    const check = await db('expenses').where({ id: created.id }).first();
    expect(check).toBeUndefined();
  });

  it('returns false when expense does not exist', async () => {
    const result = await deleteExpense(9999, 1);
    expect(result).toBe(false);
  });

  it('returns false when userId does not match', async () => {
    const created = await createExpense({ userId: 1, categoryId: 1, amount: 15, description: 'Mine', date: '2026-01-01' });
    const result = await deleteExpense(created.id, 999);
    expect(result).toBe(false);
  });
});

describe('getMonthlyTotal', () => {
  it('sums expenses within the given month', async () => {
    await createExpense({ userId: 1, categoryId: 1, amount: 100, description: 'A', date: '2026-01-10' });
    await createExpense({ userId: 1, categoryId: 1, amount: 50,  description: 'B', date: '2026-01-20' });
    await createExpense({ userId: 1, categoryId: 1, amount: 200, description: 'C', date: '2026-02-01' }); // different month
    const total = await getMonthlyTotal(1, 2026, 1);
    expect(total).toBe(150);
  });

  it('returns 0 when no expenses in month', async () => {
    const total = await getMonthlyTotal(1, 2025, 6);
    expect(total).toBe(0);
  });
});

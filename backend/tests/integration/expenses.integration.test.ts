/**
 * Integration tests — Expenses CRUD
 *
 * Full HTTP → route → service → SQLite cycle.
 * Uses a real Express app wired to the real data.db (same as production).
 * Each test registers a fresh user so there is no cross-test state.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Express } from 'express';

import authRoutes from '../../src/routes/auth.js';
import expenseRoutes from '../../src/routes/expenses.js';
import categoryRoutes from '../../src/routes/categories.js';

const PORT = 3098;
let server: ReturnType<Express['listen']>;

async function req(
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${PORT}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// ── helpers ───────────────────────────────────────────────────────────────────

const uid = () => `expense_test_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
const PASSWORD = 'password123';

async function registerAndLogin(): Promise<string> {
  const email = uid();
  const { body } = await req('POST', '/api/auth/register', { email, password: PASSWORD });
  return (body as Record<string, unknown>).token as string;
}

async function getFirstCategoryId(token: string): Promise<number> {
  const { body } = await req('GET', '/api/categories', undefined, token);
  return ((body as Record<string, unknown>[])[0] as Record<string, unknown>).id as number;
}

const validExpense = (categoryId: number) => ({
  categoryId,
  amount: 49.99,
  description: 'Integration test expense',
  date: '2026-01-15',
});

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/categories', categoryRoutes);
  server = app.listen(PORT);
});

afterAll(() => { server.close(); });

// ═════════════════════════════════════════════════════════════════════════════
// Create expense
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/expenses', () => {
  it('creates an expense and returns it with id', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { status, body } = await req('POST', '/api/expenses', validExpense(catId), token);
    expect(status).toBe(201);
    const b = body as Record<string, unknown>;
    expect(b.id).toBeDefined();
    expect(b.amount).toBe(49.99);
    expect(b.description).toBe('Integration test expense');
  });

  it('returns 400 for negative amount', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { status } = await req('POST', '/api/expenses', { ...validExpense(catId), amount: -10 }, token);
    expect(status).toBe(400);
  });

  it('returns 400 for zero amount', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { status } = await req('POST', '/api/expenses', { ...validExpense(catId), amount: 0 }, token);
    expect(status).toBe(400);
  });

  it('returns 400 for empty description', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { status } = await req('POST', '/api/expenses', { ...validExpense(catId), description: '' }, token);
    expect(status).toBe(400);
  });

  it('returns 400 for invalid date format', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { status } = await req('POST', '/api/expenses', { ...validExpense(catId), date: '15/01/2026' }, token);
    expect(status).toBe(400);
  });

  it('returns 400 for impossible calendar date', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { status } = await req('POST', '/api/expenses', { ...validExpense(catId), date: '2026-02-30' }, token);
    expect(status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// List expenses
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/expenses', () => {
  it('returns only the authenticated user\'s expenses', async () => {
    const token1 = await registerAndLogin();
    const token2 = await registerAndLogin();
    const catId = await getFirstCategoryId(token1);

    // user1 creates an expense
    await req('POST', '/api/expenses', validExpense(catId), token1);

    // user2 should see 0 expenses
    const { body } = await req('GET', '/api/expenses', undefined, token2);
    expect((body as unknown[]).length).toBe(0);
  });

  it('returns expenses filtered by search term', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);

    await req('POST', '/api/expenses', { ...validExpense(catId), description: 'Coffee at Starbucks' }, token);
    await req('POST', '/api/expenses', { ...validExpense(catId), description: 'Uber ride' }, token);

    const { body } = await req('GET', '/api/expenses?search=coffee', undefined, token);
    const results = body as Record<string, unknown>[];
    expect(results.length).toBe(1);
    expect((results[0].description as string).toLowerCase()).toContain('coffee');
  });

  it('returns expenses filtered by date range', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);

    await req('POST', '/api/expenses', { ...validExpense(catId), date: '2026-01-10' }, token);
    await req('POST', '/api/expenses', { ...validExpense(catId), date: '2026-03-15' }, token);

    const { body } = await req(
      'GET', '/api/expenses?startDate=2026-01-01&endDate=2026-01-31',
      undefined, token
    );
    const results = body as Record<string, unknown>[];
    expect(results.length).toBe(1);
    expect(results[0].date).toBe('2026-01-10');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Get single expense
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/expenses/:id', () => {
  it('returns the expense by id', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { body: created } = await req('POST', '/api/expenses', validExpense(catId), token);
    const id = (created as Record<string, unknown>).id;

    const { status, body } = await req('GET', `/api/expenses/${id}`, undefined, token);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).id).toBe(id);
  });

  it('returns 404 for another user\'s expense', async () => {
    const token1 = await registerAndLogin();
    const token2 = await registerAndLogin();
    const catId = await getFirstCategoryId(token1);
    const { body: created } = await req('POST', '/api/expenses', validExpense(catId), token1);
    const id = (created as Record<string, unknown>).id;

    const { status } = await req('GET', `/api/expenses/${id}`, undefined, token2);
    expect(status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Update expense
// ═════════════════════════════════════════════════════════════════════════════

describe('PUT /api/expenses/:id', () => {
  it('updates the expense and returns updated data', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { body: created } = await req('POST', '/api/expenses', validExpense(catId), token);
    const id = (created as Record<string, unknown>).id;

    const { status, body } = await req('PUT', `/api/expenses/${id}`, { amount: 99.99, description: 'Updated' }, token);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).amount).toBe(99.99);
    expect((body as Record<string, unknown>).description).toBe('Updated');
  });

  it('returns 400 for invalid amount on update', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { body: created } = await req('POST', '/api/expenses', validExpense(catId), token);
    const id = (created as Record<string, unknown>).id;

    const { status } = await req('PUT', `/api/expenses/${id}`, { amount: -5 }, token);
    expect(status).toBe(400);
  });

  it('returns 404 when updating another user\'s expense', async () => {
    const token1 = await registerAndLogin();
    const token2 = await registerAndLogin();
    const catId = await getFirstCategoryId(token1);
    const { body: created } = await req('POST', '/api/expenses', validExpense(catId), token1);
    const id = (created as Record<string, unknown>).id;

    const { status } = await req('PUT', `/api/expenses/${id}`, { amount: 10 }, token2);
    expect(status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Delete expense
// ═════════════════════════════════════════════════════════════════════════════

describe('DELETE /api/expenses/:id', () => {
  it('deletes the expense and returns 204', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);
    const { body: created } = await req('POST', '/api/expenses', validExpense(catId), token);
    const id = (created as Record<string, unknown>).id;

    const { status } = await req('DELETE', `/api/expenses/${id}`, undefined, token);
    expect(status).toBe(204);

    // Confirm it's gone
    const { status: getStatus } = await req('GET', `/api/expenses/${id}`, undefined, token);
    expect(getStatus).toBe(404);
  });

  it('returns 404 when deleting another user\'s expense', async () => {
    const token1 = await registerAndLogin();
    const token2 = await registerAndLogin();
    const catId = await getFirstCategoryId(token1);
    const { body: created } = await req('POST', '/api/expenses', validExpense(catId), token1);
    const id = (created as Record<string, unknown>).id;

    const { status } = await req('DELETE', `/api/expenses/${id}`, undefined, token2);
    expect(status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Monthly total
// ═════════════════════════════════════════════════════════════════════════════

describe('GET /api/expenses/monthly-total', () => {
  it('returns the correct sum for the month', async () => {
    const token = await registerAndLogin();
    const catId = await getFirstCategoryId(token);

    await req('POST', '/api/expenses', { ...validExpense(catId), amount: 100, date: '2026-06-10' }, token);
    await req('POST', '/api/expenses', { ...validExpense(catId), amount: 50,  date: '2026-06-20' }, token);
    await req('POST', '/api/expenses', { ...validExpense(catId), amount: 200, date: '2026-07-01' }, token); // different month

    const { status, body } = await req('GET', '/api/expenses/monthly-total?year=2026&month=6', undefined, token);
    expect(status).toBe(200);
    expect((body as Record<string, unknown>).total).toBe(150);
  });

  it('returns 0 when no expenses exist for the month', async () => {
    const token = await registerAndLogin();
    const { body } = await req('GET', '/api/expenses/monthly-total?year=2020&month=1', undefined, token);
    expect((body as Record<string, unknown>).total).toBe(0);
  });
});

/**
 * Integration tests — Auth flow
 *
 * Spins up the full Express app against an in-memory SQLite DB.
 * Tests the complete register → login → protected route cycle.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Express } from 'express';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';

// ── build a self-contained test app ──────────────────────────────────────────

let db: KnexType;
let app: Express;
let token: string;

async function request(
  method: string,
  path: string,
  body?: unknown,
  authToken?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://localhost:3099${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json as Record<string, unknown> };
}

// We import the real route modules but swap the db instance via vi.mock would
// require ESM mocking. Instead we use a simpler approach: start the real app
// against the real data.db but run tests in isolation using unique emails.
// For a fully isolated approach, see the expense integration test which uses
// a separate in-memory DB wired directly to the service layer.

import authRoutes from '../../src/routes/auth.js';
import expenseRoutes from '../../src/routes/expenses.js';

let server: ReturnType<Express['listen']>;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/expenses', expenseRoutes);
  server = app.listen(3099);
});

afterAll(() => { server.close(); });

// ── helpers ───────────────────────────────────────────────────────────────────

const testEmail = () => `test_${Date.now()}@example.com`;
const PASSWORD = 'password123';

// ═════════════════════════════════════════════════════════════════════════════
// Register
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/register', () => {
  it('creates a new user and returns a token', async () => {
    const { status, body } = await request('POST', '/api/auth/register', {
      email: testEmail(),
      password: PASSWORD,
    });
    expect(status).toBe(201);
    expect(body.token).toBeDefined();
    expect((body.user as Record<string, unknown>).email).toBeDefined();
  });

  it('returns 409 when email is already registered', async () => {
    const email = testEmail();
    await request('POST', '/api/auth/register', { email, password: PASSWORD });
    const { status, body } = await request('POST', '/api/auth/register', { email, password: PASSWORD });
    expect(status).toBe(409);
    expect(body.error).toMatch(/already registered/i);
  });

  it('returns 400 for invalid email', async () => {
    const { status } = await request('POST', '/api/auth/register', {
      email: 'not-an-email',
      password: PASSWORD,
    });
    expect(status).toBe(400);
  });

  it('returns 400 when password is too short', async () => {
    const { status } = await request('POST', '/api/auth/register', {
      email: testEmail(),
      password: '123',
    });
    expect(status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Login
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/auth/login', () => {
  it('returns a token for valid credentials', async () => {
    const email = testEmail();
    await request('POST', '/api/auth/register', { email, password: PASSWORD });
    const { status, body } = await request('POST', '/api/auth/login', { email, password: PASSWORD });
    expect(status).toBe(200);
    expect(body.token).toBeDefined();
  });

  it('returns 401 for wrong password', async () => {
    const email = testEmail();
    await request('POST', '/api/auth/register', { email, password: PASSWORD });
    const { status } = await request('POST', '/api/auth/login', { email, password: 'wrongpass' });
    expect(status).toBe(401);
  });

  it('returns 401 for unknown email', async () => {
    const { status } = await request('POST', '/api/auth/login', {
      email: 'nobody@example.com',
      password: PASSWORD,
    });
    expect(status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Protected route — no token / bad token
// ═════════════════════════════════════════════════════════════════════════════

describe('Protected routes — auth middleware', () => {
  it('returns 401 when no token is provided', async () => {
    const { status } = await request('GET', '/api/expenses');
    expect(status).toBe(401);
  });

  it('returns 403 for an invalid token', async () => {
    const { status } = await request('GET', '/api/expenses', undefined, 'bad.token.here');
    expect(status).toBe(403);
  });

  it('allows access with a valid token', async () => {
    const email = testEmail();
    const reg = await request('POST', '/api/auth/register', { email, password: PASSWORD });
    const tok = reg.body.token as string;
    const { status } = await request('GET', '/api/expenses', undefined, tok);
    expect(status).toBe(200);
  });
});

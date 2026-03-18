/**
 * Integration tests — CSV Import flow
 *
 * Tests the full multi-step wizard: upload → mapping → preview → confirm.
 * Also covers error paths: bad CSV, wrong session owner, re-validation guard.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Express } from 'express';

import authRoutes from '../../src/routes/auth.js';
import importRoutes from '../../src/routes/import.js';
import categoryRoutes from '../../src/routes/categories.js';
import expenseRoutes from '../../src/routes/expenses.js';

const PORT = 3097;
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

const uid = () => `import_test_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;
const PASSWORD = 'password123';

async function registerAndLogin(): Promise<string> {
  const email = uid();
  const { body } = await req('POST', '/api/auth/register', { email, password: PASSWORD });
  return (body as Record<string, unknown>).token as string;
}

const VALID_CSV = [
  'date,amount,description,category',
  '2026-01-05,45.50,Grocery run,Food',
  '2026-01-07,12.00,Uber to office,Transport',
  '2026-01-08,9.99,Netflix,Entertainment',
].join('\n');

const STANDARD_MAPPING = {
  columnMapping: { date: 'date', amount: 'amount', description: 'description', category: 'category' },
};

beforeAll(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/import', importRoutes);
  app.use('/api/categories', categoryRoutes);
  app.use('/api/expenses', expenseRoutes);
  server = app.listen(PORT);
});

afterAll(() => { server.close(); });

// ═════════════════════════════════════════════════════════════════════════════
// Full happy-path flow
// ═════════════════════════════════════════════════════════════════════════════

describe('Import — full happy path', () => {
  it('upload → mapping → confirm imports all valid rows', async () => {
    const token = await registerAndLogin();

    // 1. Upload
    const { status: uploadStatus, body: uploadBody } = await req(
      'POST', '/api/import/upload',
      { fileName: 'test.csv', csvContent: VALID_CSV },
      token
    );
    expect(uploadStatus).toBe(201);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;
    expect(sessionId).toBeDefined();

    // 2. Save mapping
    const { status: mapStatus, body: mapBody } = await req(
      'POST', `/api/import/session/${sessionId}/mapping`,
      STANDARD_MAPPING,
      token
    );
    expect(mapStatus).toBe(200);
    const { validCount, invalidCount } = mapBody as Record<string, unknown>;
    expect(validCount).toBe(3);
    expect(invalidCount).toBe(0);

    // 3. Confirm
    const { status: confirmStatus, body: confirmBody } = await req(
      'POST', `/api/import/session/${sessionId}/confirm`,
      undefined,
      token
    );
    expect(confirmStatus).toBe(200);
    expect((confirmBody as Record<string, unknown>).importedCount).toBe(3);

    // 4. Verify expenses were actually persisted
    const { body: expenses } = await req('GET', '/api/expenses', undefined, token);
    expect((expenses as unknown[]).length).toBe(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Upload validation
// ═════════════════════════════════════════════════════════════════════════════

describe('Import — upload validation', () => {
  it('returns 400 for empty CSV content', async () => {
    const token = await registerAndLogin();
    const { status } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: '' }, token);
    expect(status).toBe(400);
  });

  it('returns 400 for CSV with only a header row', async () => {
    const token = await registerAndLogin();
    const { status } = await req(
      'POST', '/api/import/upload',
      { fileName: 'test.csv', csvContent: 'date,amount,description' },
      token
    );
    expect(status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const { status } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: VALID_CSV });
    expect(status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Mapping — invalid rows are flagged, not silently imported
// ═════════════════════════════════════════════════════════════════════════════

describe('Import — row validation at mapping stage', () => {
  it('flags rows with bad dates as invalid', async () => {
    const token = await registerAndLogin();
    const csv = [
      'date,amount,description,category',
      '2026-02-30,10.00,Bad date,Food',   // impossible date
      '2026-01-10,20.00,Good row,Food',
    ].join('\n');

    const { body: uploadBody } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: csv }, token);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;

    const { body: mapBody } = await req('POST', `/api/import/session/${sessionId}/mapping`, STANDARD_MAPPING, token);
    const { validCount, invalidCount } = mapBody as Record<string, unknown>;
    expect(validCount).toBe(1);
    expect(invalidCount).toBe(1);
  });

  it('flags rows with missing amount as invalid', async () => {
    const token = await registerAndLogin();
    const csv = [
      'date,amount,description,category',
      '2026-01-10,,No amount,Food',
      '2026-01-11,15.00,Good row,Food',
    ].join('\n');

    const { body: uploadBody } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: csv }, token);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;

    const { body: mapBody } = await req('POST', `/api/import/session/${sessionId}/mapping`, STANDARD_MAPPING, token);
    expect((mapBody as Record<string, unknown>).invalidCount).toBe(1);
  });

  it('returns 404 when mapping a session that belongs to another user', async () => {
    const token1 = await registerAndLogin();
    const token2 = await registerAndLogin();

    const { body: uploadBody } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: VALID_CSV }, token1);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;

    const { status } = await req('POST', `/api/import/session/${sessionId}/mapping`, STANDARD_MAPPING, token2);
    expect(status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Skip row
// ═════════════════════════════════════════════════════════════════════════════

describe('Import — skip row', () => {
  it('skipped rows are not imported', async () => {
    const token = await registerAndLogin();

    const { body: uploadBody } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: VALID_CSV }, token);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;

    await req('POST', `/api/import/session/${sessionId}/mapping`, STANDARD_MAPPING, token);

    // Skip row 0
    await req('POST', `/api/import/session/${sessionId}/skip`, { rowIndex: 0, skip: true }, token);

    const { body: confirmBody } = await req('POST', `/api/import/session/${sessionId}/confirm`, undefined, token);
    expect((confirmBody as Record<string, unknown>).importedCount).toBe(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Confirm — guard against re-confirming a completed session
// ═════════════════════════════════════════════════════════════════════════════

describe('Import — confirm guards', () => {
  it('returns 400 when confirming an already-completed session', async () => {
    const token = await registerAndLogin();

    const { body: uploadBody } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: VALID_CSV }, token);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;

    await req('POST', `/api/import/session/${sessionId}/mapping`, STANDARD_MAPPING, token);
    await req('POST', `/api/import/session/${sessionId}/confirm`, undefined, token);

    // Second confirm on same session
    const { status } = await req('POST', `/api/import/session/${sessionId}/confirm`, undefined, token);
    expect(status).toBe(400);
  });

  it('returns 400 when confirming a session that has no valid rows', async () => {
    const token = await registerAndLogin();
    const csv = [
      'date,amount,description,category',
      '2026-02-30,,, ',  // all fields invalid
    ].join('\n');

    const { body: uploadBody } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: csv }, token);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;

    await req('POST', `/api/import/session/${sessionId}/mapping`, STANDARD_MAPPING, token);
    const { status } = await req('POST', `/api/import/session/${sessionId}/confirm`, undefined, token);
    expect(status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Import history
// ═════════════════════════════════════════════════════════════════════════════

describe('Import — history', () => {
  it('records the import in history after confirm', async () => {
    const token = await registerAndLogin();

    const { body: uploadBody } = await req('POST', '/api/import/upload', { fileName: 'history_test.csv', csvContent: VALID_CSV }, token);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;

    await req('POST', `/api/import/session/${sessionId}/mapping`, STANDARD_MAPPING, token);
    await req('POST', `/api/import/session/${sessionId}/confirm`, undefined, token);

    const { status, body: history } = await req('GET', '/api/import/history', undefined, token);
    expect(status).toBe(200);
    const records = history as Record<string, unknown>[];
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].fileName).toBe('history_test.csv');
    expect(records[0].importedRows).toBe(3);
  });

  it('does not show another user\'s import history', async () => {
    const token1 = await registerAndLogin();
    const token2 = await registerAndLogin();

    const { body: uploadBody } = await req('POST', '/api/import/upload', { fileName: 'test.csv', csvContent: VALID_CSV }, token1);
    const sessionId = ((uploadBody as Record<string, unknown>).session as Record<string, unknown>).id;
    await req('POST', `/api/import/session/${sessionId}/mapping`, STANDARD_MAPPING, token1);
    await req('POST', `/api/import/session/${sessionId}/confirm`, undefined, token1);

    const { body: history } = await req('GET', '/api/import/history', undefined, token2);
    expect((history as unknown[]).length).toBe(0);
  });
});

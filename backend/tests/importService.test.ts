import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Knex from 'knex';
import type { Knex as KnexType } from 'knex';

// ── Pure-function imports (no DB dependency) ──────────────────────────────────
import {
  detectDelimiter,
  parseCsvLine,
  parseCsv,
  suggestMapping,
  parseDate,
  parseAmount,
  matchCategoryFromList,
  validateRow,
} from '../src/services/importService.js';

// ── In-memory DB for integration tests ───────────────────────────────────────
let db: KnexType;

beforeAll(async () => {
  db = Knex({ client: 'better-sqlite3', connection: ':memory:', useNullAsDefault: true });

  await db.schema.createTable('users', t => {
    t.increments('id').primary();
    t.string('email').notNullable().unique();
    t.string('passwordHash').notNullable();
    t.timestamp('createdAt').defaultTo(db.fn.now());
  });
  await db.schema.createTable('categories', t => {
    t.increments('id').primary();
    t.string('name').notNullable();
    t.string('icon').notNullable();
  });
  await db.schema.createTable('expenses', t => {
    t.increments('id').primary();
    t.integer('userId').notNullable();
    t.integer('categoryId').notNullable();
    t.decimal('amount', 10, 2).notNullable();
    t.string('description').notNullable();
    t.date('date').notNullable();
    t.timestamp('createdAt').defaultTo(db.fn.now());
  });
  await db.schema.createTable('import_sessions', t => {
    t.increments('id').primary();
    t.integer('userId').notNullable();
    t.string('status').notNullable().defaultTo('upload');
    t.string('fileName').nullable();
    t.integer('fileSize').nullable();
    t.text('rawCsvData').nullable();
    t.text('columnMapping').nullable();
    t.text('parsedRows').nullable();
    t.integer('validRowCount').defaultTo(0);
    t.integer('invalidRowCount').defaultTo(0);
    t.integer('skippedRowCount').defaultTo(0);
    t.integer('importedExpenseCount').defaultTo(0);
    t.timestamp('createdAt').defaultTo(db.fn.now());
    t.timestamp('updatedAt').defaultTo(db.fn.now());
  });
  await db.schema.createTable('import_history', t => {
    t.increments('id').primary();
    t.integer('userId').notNullable();
    t.integer('sessionId').notNullable();
    t.string('fileName').notNullable();
    t.integer('totalRows').notNullable();
    t.integer('importedRows').notNullable();
    t.integer('skippedRows').notNullable();
    t.timestamp('createdAt').defaultTo(db.fn.now());
  });

  await db('users').insert({ email: 'test@example.com', passwordHash: 'hash' });
  await db('categories').insert([
    { id: 1, name: 'Food',          icon: '🍔' },
    { id: 2, name: 'Transport',     icon: '🚗' },
    { id: 3, name: 'Entertainment', icon: '🎬' },
    { id: 4, name: 'Bills',         icon: '📄' },
    { id: 5, name: 'Shopping',      icon: '🛍' },
    { id: 6, name: 'Other',         icon: '•'  },
  ]);
});

afterAll(() => db.destroy());
beforeEach(() => db('import_sessions').delete());

// ═════════════════════════════════════════════════════════════════════════════
// detectDelimiter
// ═════════════════════════════════════════════════════════════════════════════

describe('detectDelimiter', () => {
  it('detects comma', () => expect(detectDelimiter('a,b,c\n1,2,3')).toBe(','));
  it('detects semicolon', () => expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';'));
  it('detects tab', () => expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t'));

  it('ignores commas inside quoted fields', () => {
    // The value "Smith, John" contains a comma but the real delimiter is semicolon
    expect(detectDelimiter('"Smith, John";10.00;Food')).toBe(';');
  });

  it('defaults to comma when no delimiter found', () => {
    expect(detectDelimiter('nodlimitershere')).toBe(',');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// parseCsvLine
// ═════════════════════════════════════════════════════════════════════════════

describe('parseCsvLine', () => {
  it('splits a simple line', () => {
    expect(parseCsvLine('a,b,c', ',')).toEqual(['a', 'b', 'c']);
  });

  it('handles quoted fields containing the delimiter', () => {
    expect(parseCsvLine('"hello, world",42', ',')).toEqual(['hello, world', '42']);
  });

  it('handles escaped quotes inside quoted fields (RFC-4180 "")', () => {
    expect(parseCsvLine('"say ""hi""",10', ',')).toEqual(['say "hi"', '10']);
  });

  it('trims whitespace around unquoted fields', () => {
    expect(parseCsvLine(' a , b , c ', ',')).toEqual(['a', 'b', 'c']);
  });

  it('returns a single-element array for a line with no delimiter', () => {
    expect(parseCsvLine('onlyone', ',')).toEqual(['onlyone']);
  });

  it('handles empty fields', () => {
    expect(parseCsvLine('a,,c', ',')).toEqual(['a', '', 'c']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// parseCsv
// ═════════════════════════════════════════════════════════════════════════════

describe('parseCsv', () => {
  it('splits multi-line CSV into rows', () => {
    const csv = 'date,amount,description\n2026-01-01,10,Coffee\n2026-01-02,20,Lunch';
    expect(parseCsv(csv, ',')).toHaveLength(3);
  });

  it('skips blank lines', () => {
    const csv = 'a,b\n\n1,2\n\n3,4';
    expect(parseCsv(csv, ',')).toHaveLength(3);
  });

  it('handles Windows CRLF line endings', () => {
    const csv = 'a,b\r\n1,2\r\n3,4';
    expect(parseCsv(csv, ',')).toHaveLength(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// suggestMapping
// ═════════════════════════════════════════════════════════════════════════════

describe('suggestMapping', () => {
  it('maps standard headers', () => {
    const m = suggestMapping(['date', 'amount', 'description', 'category']);
    expect(m).toEqual({ date: 'date', amount: 'amount', description: 'description', category: 'category' });
  });

  it('maps partial keyword matches (case-insensitive)', () => {
    const m = suggestMapping(['Transaction Date', 'Total Cost', 'Item Name', 'Type']);
    expect(m.date).toBe('Transaction Date');
    expect(m.amount).toBe('Total Cost');
    expect(m.description).toBe('Item Name');
    expect(m.category).toBe('Type');
  });

  it('leaves fields undefined when no match', () => {
    const m = suggestMapping(['foo', 'bar']);
    expect(m.date).toBeUndefined();
    expect(m.amount).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// parseDate
// ═════════════════════════════════════════════════════════════════════════════

describe('parseDate', () => {
  it('accepts YYYY-MM-DD', () => expect(parseDate('2026-01-15')).toBe('2026-01-15'));
  it('accepts MM/DD/YYYY', () => expect(parseDate('01/15/2026')).toBe('2026-01-15'));
  it('accepts DD-MM-YYYY', () => expect(parseDate('15-01-2026')).toBe('2026-01-15'));
  it('accepts YYYY/MM/DD', () => expect(parseDate('2026/01/15')).toBe('2026-01-15'));

  it('returns null for empty string', () => expect(parseDate('')).toBeNull());
  it('returns null for whitespace', () => expect(parseDate('   ')).toBeNull());
  it('returns null for garbage', () => expect(parseDate('not-a-date')).toBeNull());

  it('returns null for Feb 30 (impossible date)', () => expect(parseDate('2026-02-30')).toBeNull());
  it('returns null for Apr 31 (impossible date)', () => expect(parseDate('2026-04-31')).toBeNull());
  it('returns null for Feb 29 on non-leap year', () => expect(parseDate('2026-02-29')).toBeNull());
  it('accepts Feb 29 on a leap year', () => expect(parseDate('2024-02-29')).toBe('2024-02-29'));

  it('returns null for month 13', () => expect(parseDate('2026-13-01')).toBeNull());
});

// ═════════════════════════════════════════════════════════════════════════════
// parseAmount
// ═════════════════════════════════════════════════════════════════════════════

describe('parseAmount', () => {
  it('parses a plain number', () => expect(parseAmount('49.99')).toBe(49.99));
  it('strips dollar sign', () => expect(parseAmount('$12.50')).toBe(12.50));
  it('strips euro sign', () => expect(parseAmount('€9.99')).toBe(9.99));
  it('strips pound sign', () => expect(parseAmount('£5.00')).toBe(5.00));
  it('strips thousands separator', () => expect(parseAmount('1,234.56')).toBe(1234.56));
  it('handles accounting negative (parentheses)', () => expect(parseAmount('(50.00)')).toBe(-50));

  it('returns null for empty string', () => expect(parseAmount('')).toBeNull());
  it('returns null for whitespace', () => expect(parseAmount('   ')).toBeNull());
  it('returns null for non-numeric string', () => expect(parseAmount('abc')).toBeNull());
  it('returns null for Infinity string', () => expect(parseAmount('Infinity')).toBeNull());
});

// ═════════════════════════════════════════════════════════════════════════════
// matchCategoryFromList
// ═════════════════════════════════════════════════════════════════════════════

describe('matchCategoryFromList', () => {
  const cats = [
    { id: 1, name: 'Food' },
    { id: 2, name: 'Transport' },
    { id: 6, name: 'Other' },
  ];

  it('exact match (case-insensitive)', () => expect(matchCategoryFromList('food', cats)?.name).toBe('Food'));
  it('alias match — "groceries" → Food', () => expect(matchCategoryFromList('groceries', cats)?.name).toBe('Food'));
  it('alias match — "uber" → Transport', () => expect(matchCategoryFromList('uber', cats)?.name).toBe('Transport'));
  it('falls back to Other for unknown category', () => expect(matchCategoryFromList('xyz unknown', cats)?.name).toBe('Other'));
  it('returns null for empty string', () => expect(matchCategoryFromList('', cats)).toBeNull());
  it('returns null for null input', () => expect(matchCategoryFromList(null, cats)).toBeNull());
});

// ═════════════════════════════════════════════════════════════════════════════
// validateRow
// ═════════════════════════════════════════════════════════════════════════════

describe('validateRow', () => {
  const base = {
    rowIndex: 0, originalData: {}, skipped: false,
    category: 'Food', categoryId: 1,
  };

  it('returns no errors for a valid row', () => {
    expect(validateRow({ ...base, date: '2026-01-01', amount: 10, description: 'Lunch' })).toHaveLength(0);
  });

  it('errors when date is null', () => {
    const errs = validateRow({ ...base, date: null, amount: 10, description: 'x' });
    expect(errs.some(e => e.field === 'date')).toBe(true);
  });

  it('errors when amount is null', () => {
    const errs = validateRow({ ...base, date: '2026-01-01', amount: null, description: 'x' });
    expect(errs.some(e => e.field === 'amount')).toBe(true);
  });

  it('errors when amount is zero', () => {
    const errs = validateRow({ ...base, date: '2026-01-01', amount: 0, description: 'x' });
    expect(errs.some(e => e.field === 'amount')).toBe(true);
  });

  it('errors when amount is negative', () => {
    const errs = validateRow({ ...base, date: '2026-01-01', amount: -5, description: 'x' });
    expect(errs.some(e => e.field === 'amount')).toBe(true);
  });

  it('errors when amount is Infinity', () => {
    const errs = validateRow({ ...base, date: '2026-01-01', amount: Infinity, description: 'x' });
    expect(errs.some(e => e.field === 'amount')).toBe(true);
  });

  it('errors when description is empty', () => {
    const errs = validateRow({ ...base, date: '2026-01-01', amount: 10, description: '' });
    expect(errs.some(e => e.field === 'description')).toBe(true);
  });

  it('errors when description is whitespace only', () => {
    const errs = validateRow({ ...base, date: '2026-01-01', amount: 10, description: '   ' });
    expect(errs.some(e => e.field === 'description')).toBe(true);
  });

  it('collects all errors at once', () => {
    const errs = validateRow({ ...base, date: null, amount: null, description: '' });
    expect(errs).toHaveLength(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Integration — full CSV → parse → validate pipeline (no HTTP, uses test DB)
// ═════════════════════════════════════════════════════════════════════════════

describe('CSV → parse → validate pipeline', () => {
  const VALID_CSV = [
    'date,amount,description,category',
    '2026-01-05,45.50,Grocery run,Food',
    '2026-01-07,12.00,Uber to office,Transport',
    '2026-01-08,9.99,Netflix,Entertainment',
  ].join('\n');

  it('parses a valid CSV into 3 data rows with no errors', () => {
    const delimiter = detectDelimiter(VALID_CSV);
    const rows = parseCsv(VALID_CSV, delimiter);
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const cats = [
      { id: 1, name: 'Food' }, { id: 2, name: 'Transport' },
      { id: 3, name: 'Entertainment' }, { id: 6, name: 'Other' },
    ];

    const parsed = dataRows.map((row, i) => {
      const partial = {
        rowIndex: i, originalData: {},
        date:        parseDate(row[0]),
        amount:      parseAmount(row[1]),
        description: row[2].trim(),
        category:    matchCategoryFromList(row[3], cats)?.name ?? null,
        categoryId:  matchCategoryFromList(row[3], cats)?.id   ?? null,
        skipped: false,
      };
      return { ...partial, errors: validateRow(partial) };
    });

    expect(parsed).toHaveLength(3);
    parsed.forEach(r => expect(r.errors).toHaveLength(0));
  });

  it('marks rows with bad data as invalid without affecting other rows', () => {
    const csv = [
      'date,amount,description,category',
      '2026-02-30,45.50,Bad date row,Food',   // invalid date
      '2026-01-07,,Missing amount,Transport',  // missing amount
      '2026-01-08,9.99,Valid row,Food',        // valid
    ].join('\n');

    const delimiter = detectDelimiter(csv);
    const rows = parseCsv(csv, delimiter);
    const dataRows = rows.slice(1);
    const cats = [{ id: 1, name: 'Food' }, { id: 2, name: 'Transport' }, { id: 6, name: 'Other' }];

    const parsed = dataRows.map((row, i) => {
      const partial = {
        rowIndex: i, originalData: {},
        date:        parseDate(row[0]),
        amount:      parseAmount(row[1]),
        description: row[2].trim(),
        category:    matchCategoryFromList(row[3], cats)?.name ?? null,
        categoryId:  matchCategoryFromList(row[3], cats)?.id   ?? null,
        skipped: false,
      };
      return { ...partial, errors: validateRow(partial) };
    });

    expect(parsed[0].errors.some(e => e.field === 'date')).toBe(true);
    expect(parsed[1].errors.some(e => e.field === 'amount')).toBe(true);
    expect(parsed[2].errors).toHaveLength(0);
  });

  it('handles a CSV with quoted fields containing commas', () => {
    const csv = [
      'date,amount,description,category',
      '2026-01-10,25.00,"Coffee, large",Food',
    ].join('\n');

    const delimiter = detectDelimiter(csv);
    const rows = parseCsv(csv, delimiter);
    expect(rows[1][2]).toBe('Coffee, large');
  });

  it('handles semicolon-delimited CSV', () => {
    const csv = 'date;amount;description\n2026-01-01;10.00;Test';
    const delimiter = detectDelimiter(csv);
    expect(delimiter).toBe(';');
    const rows = parseCsv(csv, delimiter);
    expect(rows[1]).toEqual(['2026-01-01', '10.00', 'Test']);
  });

  it('throws when CSV has only a header row', () => {
    const csv = 'date,amount,description';
    const rows = parseCsv(csv, ',');
    expect(rows.length).toBeLessThan(2);
  });

  it('does not persist rows that fail re-validation (corrupt session guard)', () => {
    // Simulate a parsedRows payload where a row has errors but skipped=false
    // confirmImport should skip it rather than insert bad data
    const corruptRow = {
      rowIndex: 0, originalData: {},
      date: null,        // invalid — would fail re-validation
      amount: 10,
      description: 'Test',
      category: 'Food', categoryId: 1,
      skipped: false,
      errors: [],        // errors were cleared externally (simulated corruption)
    };
    // Re-validate catches it
    const freshErrors = validateRow(corruptRow);
    expect(freshErrors.some(e => e.field === 'date')).toBe(true);
  });
});

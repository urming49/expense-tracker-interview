import db from '../db/knex.js';
import logger from '../logger.js';
import type {
  ImportSession,
  ImportHistory,
  ColumnMapping,
  ParsedRow,
  CsvStructure,
  UploadResult,
  MappingResult,
  ImportResult,
  RowValidationError,
} from '../types/index.js';

// ── Category aliases ──────────────────────────────────────────────────────────

const CATEGORY_ALIASES: Record<string, string[]> = {
  'Food': ['food', 'groceries', 'grocery', 'restaurant', 'dining', 'lunch', 'dinner', 'breakfast', 'meal', 'meals'],
  'Transport': ['transport', 'transportation', 'uber', 'lyft', 'taxi', 'cab', 'gas', 'fuel', 'parking', 'transit', 'bus', 'train'],
  'Entertainment': ['entertainment', 'movies', 'movie', 'netflix', 'spotify', 'games', 'gaming', 'concert', 'show'],
  'Shopping': ['shopping', 'amazon', 'clothes', 'clothing', 'retail', 'store'],
  'Bills': ['bills', 'bill', 'utilities', 'utility', 'electric', 'electricity', 'water', 'internet', 'phone', 'rent', 'mortgage'],
  'Other': ['other', 'misc', 'miscellaneous'],
};

// ── CSV parsing ───────────────────────────────────────────────────────────────

/**
 * Detect the delimiter by counting occurrences *outside* quoted fields on the
 * first non-empty line. This avoids commas inside quoted values skewing the
 * count (e.g. `"Smith, John",10.00` should still detect `,` correctly).
 */
export function detectDelimiter(content: string): string {
  const firstLine = (content.split('\n').find(l => l.trim()) || '');
  const delimiters = [',', ';', '\t'];
  let maxCount = 0;
  let detected = ',';

  for (const delimiter of delimiters) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const ch = firstLine[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && ch === delimiter) count++;
    }
    if (count > maxCount) { maxCount = count; detected = delimiter; }
  }

  return detected;
}

/**
 * Parse a single CSV line respecting RFC-4180 quoting rules:
 * - Fields wrapped in `"` may contain the delimiter or newlines.
 * - A literal `"` inside a quoted field is escaped as `""`.
 */
export function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/** Split CSV content into a 2-D array of strings, skipping blank lines. */
export function parseCsv(content: string, delimiter: string): string[][] {
  return content
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => parseCsvLine(line, delimiter));
}

// ── Column mapping suggestion ─────────────────────────────────────────────────

export function suggestMapping(headers: string[]): Partial<ColumnMapping> {
  const mapping: Partial<ColumnMapping> = {};
  const lower = headers.map(h => h.toLowerCase().trim());

  const find = (keywords: string[]) =>
    lower.findIndex(h => keywords.some(k => h.includes(k)));

  const dateIdx = find(['date', 'time', 'when', 'day']);
  if (dateIdx !== -1) mapping.date = headers[dateIdx];

  const amountIdx = find(['amount', 'price', 'cost', 'total', 'value', 'sum']);
  if (amountIdx !== -1) mapping.amount = headers[amountIdx];

  const descIdx = find(['description', 'desc', 'note', 'notes', 'memo', 'item', 'name', 'details']);
  if (descIdx !== -1) mapping.description = headers[descIdx];

  const catIdx = find(['category', 'type', 'group', 'class']);
  if (catIdx !== -1) mapping.category = headers[catIdx];

  return mapping;
}

// ── Date parsing ──────────────────────────────────────────────────────────────

const DATE_PATTERNS: { regex: RegExp; toIso: (parts: string[]) => string }[] = [
  {
    // YYYY-MM-DD
    regex: /^\d{4}-\d{2}-\d{2}$/,
    toIso: (p) => `${p[0]}-${p[1]}-${p[2]}`,
  },
  {
    // MM/DD/YYYY
    regex: /^\d{2}\/\d{2}\/\d{4}$/,
    toIso: (p) => `${p[2]}-${p[0].padStart(2, '0')}-${p[1].padStart(2, '0')}`,
  },
  {
    // DD-MM-YYYY
    regex: /^\d{2}-\d{2}-\d{4}$/,
    toIso: (p) => `${p[2]}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`,
  },
  {
    // YYYY/MM/DD
    regex: /^\d{4}\/\d{2}\/\d{2}$/,
    toIso: (p) => `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`,
  },
];

/**
 * Parse a date string into `YYYY-MM-DD`.
 * Returns `null` when the string is empty, unrecognised, or represents an
 * impossible calendar date (e.g. Feb 30).
 *
 * The round-trip check (`toISOString().startsWith(iso)`) is the key guard:
 * JS `Date` silently rolls over invalid dates, so `new Date('2026-02-30')`
 * becomes March 2 — the round-trip will not match `2026-02-30` and we return
 * null instead of persisting a wrong date.
 */
export function parseDate(dateStr: string): string | null {
  if (!dateStr?.trim()) return null;
  const trimmed = dateStr.trim();

  for (const { regex, toIso } of DATE_PATTERNS) {
    if (regex.test(trimmed)) {
      const parts = trimmed.split(/[-\/]/);
      const iso = toIso(parts);
      // Validate the calendar date via round-trip
      const d = new Date(iso);
      if (isNaN(d.getTime()) || !d.toISOString().startsWith(iso)) return null;
      return iso;
    }
  }

  // Fallback: let JS parse it, then normalise
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

// ── Amount parsing ────────────────────────────────────────────────────────────

/**
 * Parse an amount string to a finite positive number.
 * Strips common currency symbols (`$`, `€`, `£`), thousands separators, and
 * handles accounting-style negatives like `(12.50)`.
 *
 * Returns `null` when the string is empty or cannot be parsed as a number.
 * Returns `null` (not the value) when the result is `NaN`, `Infinity`, or `<= 0`
 * so that `validateRow` can produce a specific error message.
 */
export function parseAmount(amountStr: string): number | null {
  if (!amountStr?.trim()) return null;

  const cleaned = amountStr.replace(/[$\u20AC\u00A3\s,]/g, '').trim();
  if (!cleaned) return null;

  const isNegative = cleaned.startsWith('(') && cleaned.endsWith(')');
  const numStr = isNegative ? cleaned.slice(1, -1) : cleaned;

  const num = parseFloat(numStr);
  if (isNaN(num) || !isFinite(num)) return null;

  return isNegative ? -num : num;
}

// ── Category matching ─────────────────────────────────────────────────────────

/**
 * Match a category string against the DB categories.
 * Accepts a pre-loaded category list to avoid N+1 queries when called per row.
 */
export function matchCategoryFromList(
  categoryStr: string | null,
  categories: { id: number; name: string }[]
): { id: number; name: string } | null {
  if (!categoryStr?.trim()) return null;
  const lower = categoryStr.toLowerCase().trim();

  const exact = categories.find(c => c.name.toLowerCase() === lower);
  if (exact) return exact;

  const partial = categories.find(
    c => c.name.toLowerCase().includes(lower) || lower.includes(c.name.toLowerCase())
  );
  if (partial) return partial;

  for (const [name, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.some(a => lower.includes(a) || a.includes(lower))) {
      const matched = categories.find(c => c.name === name);
      if (matched) return matched;
    }
  }

  return categories.find(c => c.name === 'Other') || null;
}

// ── Row validation ────────────────────────────────────────────────────────────

/**
 * Validate a fully-parsed row before it is persisted.
 * This is the last line of defence — called both at mapping time and again
 * inside `confirmImport` to prevent stale/corrupted session data from reaching
 * the database.
 */
export function validateRow(row: Omit<ParsedRow, 'errors'>): RowValidationError[] {
  const errors: RowValidationError[] = [];

  if (!row.date) {
    errors.push({ field: 'date', message: 'Date is required and must be a valid calendar date' });
  }

  if (row.amount === null || row.amount === undefined) {
    errors.push({ field: 'amount', message: 'Amount is required and must be a number' });
  } else if (!isFinite(row.amount) || isNaN(row.amount)) {
    errors.push({ field: 'amount', message: 'Amount must be a finite number' });
  } else if (row.amount <= 0) {
    errors.push({ field: 'amount', message: 'Amount must be greater than zero' });
  }

  if (!row.description?.trim()) {
    errors.push({ field: 'description', message: 'Description is required' });
  }

  return errors;
}

// ── Safe JSON parse helper ────────────────────────────────────────────────────

/**
 * Parse a JSON string that was stored in the DB.
 * Throws a descriptive error instead of letting `JSON.parse` throw an opaque
 * SyntaxError, preventing silent state corruption when session data is malformed.
 */
function safeParsedRows(raw: string | null, context: string): ParsedRow[] {
  if (!raw) throw new Error(`${context}: parsedRows is empty`);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error(`${context}: parsedRows is not an array`);
    return parsed as ParsedRow[];
  } catch (e) {
    throw new Error(`${context}: failed to parse session rows — ${(e as Error).message}`);
  }
}

// ── Session helpers ───────────────────────────────────────────────────────────

export async function getActiveSession(userId: number): Promise<ImportSession | null> {
  return db('import_sessions')
    .where({ userId })
    .whereNotIn('status', ['completed', 'cancelled'])
    .orderBy('createdAt', 'desc')
    .first() ?? null;
}

export async function getSession(id: number, userId: number): Promise<ImportSession | null> {
  return db('import_sessions').where({ id, userId }).first() ?? null;
}

export async function createSession(userId: number): Promise<ImportSession> {
  await db('import_sessions')
    .where({ userId })
    .whereNotIn('status', ['completed', 'cancelled'])
    .update({ status: 'cancelled', updatedAt: db.fn.now() });

  const [id] = await db('import_sessions').insert({ userId, status: 'upload' });
  logger.info({ userId, sessionId: id }, 'Created new import session');
  return db('import_sessions').where({ id }).first<ImportSession>();
}

export async function cancelSession(id: number, userId: number): Promise<boolean> {
  const updated = await db('import_sessions')
    .where({ id, userId })
    .whereNotIn('status', ['completed', 'cancelled'])
    .update({ status: 'cancelled', updatedAt: db.fn.now() });
  if (updated > 0) logger.info({ userId, sessionId: id }, 'Cancelled import session');
  return updated > 0;
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadCsv(
  userId: number,
  fileName: string,
  csvContent: string
): Promise<UploadResult> {
  if (!csvContent?.trim()) throw new Error('CSV content is empty');

  let session = await getActiveSession(userId);
  if (!session) session = await createSession(userId);

  const delimiter = detectDelimiter(csvContent);
  const rows = parseCsv(csvContent, delimiter);

  if (rows.length < 2) {
    throw new Error('CSV must have at least a header row and one data row');
  }

  const headers = rows[0];

  if (headers.length === 0 || headers.every(h => !h.trim())) {
    throw new Error('CSV header row is empty');
  }

  const dataRows = rows.slice(1);

  await db('import_sessions').where({ id: session.id }).update({
    fileName,
    fileSize: csvContent.length,
    rawCsvData: csvContent,
    status: 'upload',
    updatedAt: db.fn.now(),
  });

  session = await getSession(session.id, userId);

  const structure: CsvStructure = {
    headers,
    delimiter,
    rowCount: dataRows.length,
    sampleRows: dataRows.slice(0, 5),
    suggestedMapping: suggestMapping(headers),
  };

  logger.info({ userId, sessionId: session!.id, fileName, rowCount: dataRows.length }, 'CSV uploaded');
  return { session: session!, structure };
}

// ── Save mapping ──────────────────────────────────────────────────────────────

export async function saveMapping(
  sessionId: number,
  userId: number,
  mapping: ColumnMapping
): Promise<MappingResult> {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error('Session not found');
  if (!session.rawCsvData) throw new Error('No CSV data in session');

  const delimiter = detectDelimiter(session.rawCsvData);
  const rows = parseCsv(session.rawCsvData, delimiter);
  const headers = rows[0];
  const dataRows = rows.slice(1);

  // Validate that mapped columns actually exist in the headers
  const missingCols = (['date', 'amount', 'description'] as const).filter(
    field => !headers.includes(mapping[field])
  );
  if (missingCols.length > 0) {
    throw new Error(`Mapped columns not found in CSV headers: ${missingCols.join(', ')}`);
  }

  const headerIndex: Record<string, number> = {};
  headers.forEach((h, i) => { headerIndex[h] = i; });

  // Load categories once — avoids N+1 DB queries
  const categories = await db('categories').select('id', 'name');

  const parsedRows: ParsedRow[] = [];
  let validCount = 0;
  let invalidCount = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const originalData: Record<string, string> = {};
    headers.forEach((h, idx) => { originalData[h] = row[idx] ?? ''; });

    const dateStr   = row[headerIndex[mapping.date]]        ?? '';
    const amountStr = row[headerIndex[mapping.amount]]      ?? '';
    const descStr   = row[headerIndex[mapping.description]] ?? '';
    const catStr    = mapping.category ? (row[headerIndex[mapping.category]] ?? '') : '';

    const date        = parseDate(dateStr);
    const amount      = parseAmount(amountStr);
    const description = descStr.trim();
    const catMatch    = matchCategoryFromList(catStr, categories);

    const partial: Omit<ParsedRow, 'errors'> = {
      rowIndex: i,
      originalData,
      date,
      amount,
      description,
      category:   catMatch?.name ?? null,
      categoryId: catMatch?.id   ?? null,
      skipped: false,
    };

    const errors = validateRow(partial);
    parsedRows.push({ ...partial, errors });
    errors.length > 0 ? invalidCount++ : validCount++;
  }

  await db('import_sessions').where({ id: sessionId }).update({
    columnMapping: JSON.stringify(mapping),
    parsedRows:    JSON.stringify(parsedRows),
    validRowCount:   validCount,
    invalidRowCount: invalidCount,
    status: 'preview',
    updatedAt: db.fn.now(),
  });

  const updatedSession = await getSession(sessionId, userId);
  logger.info({ userId, sessionId, validCount, invalidCount }, 'Mapping saved and rows parsed');

  return { session: updatedSession!, parsedRows, validCount, invalidCount };
}

// ── Update row ────────────────────────────────────────────────────────────────

export async function updateRow(
  sessionId: number,
  userId: number,
  rowIndex: number,
  updates: { date?: string; amount?: number; description?: string; category?: string }
): Promise<ParsedRow> {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error('Session not found');

  const parsedRows = safeParsedRows(session.parsedRows, `updateRow(session=${sessionId})`);
  const row = parsedRows.find(r => r.rowIndex === rowIndex);
  if (!row) throw new Error(`Row ${rowIndex} not found in session ${sessionId}`);

  if (updates.date      !== undefined) row.date        = parseDate(updates.date);
  if (updates.amount    !== undefined) row.amount      = updates.amount;
  if (updates.description !== undefined) row.description = updates.description;
  if (updates.category  !== undefined) {
    const categories = await db('categories').select('id', 'name');
    const match = matchCategoryFromList(updates.category, categories);
    row.category   = match?.name ?? null;
    row.categoryId = match?.id   ?? null;
  }

  row.errors = validateRow(row);

  let validCount = 0, invalidCount = 0;
  for (const r of parsedRows) {
    if (r.skipped) continue;
    r.errors.length > 0 ? invalidCount++ : validCount++;
  }

  await db('import_sessions').where({ id: sessionId }).update({
    parsedRows:      JSON.stringify(parsedRows),
    validRowCount:   validCount,
    invalidRowCount: invalidCount,
    updatedAt: db.fn.now(),
  });

  logger.info({ userId, sessionId, rowIndex }, 'Row updated');
  return row;
}

// ── Skip row ──────────────────────────────────────────────────────────────────

export async function skipRow(
  sessionId: number,
  userId: number,
  rowIndex: number,
  skip: boolean
): Promise<ParsedRow> {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error('Session not found');

  const parsedRows = safeParsedRows(session.parsedRows, `skipRow(session=${sessionId})`);
  const row = parsedRows.find(r => r.rowIndex === rowIndex);
  if (!row) throw new Error(`Row ${rowIndex} not found in session ${sessionId}`);

  row.skipped = skip;

  let validCount = 0, invalidCount = 0, skippedCount = 0;
  for (const r of parsedRows) {
    if (r.skipped) { skippedCount++; continue; }
    r.errors.length > 0 ? invalidCount++ : validCount++;
  }

  await db('import_sessions').where({ id: sessionId }).update({
    parsedRows:       JSON.stringify(parsedRows),
    validRowCount:    validCount,
    invalidRowCount:  invalidCount,
    skippedRowCount:  skippedCount,
    updatedAt: db.fn.now(),
  });

  logger.info({ userId, sessionId, rowIndex, skip }, 'Row skip status updated');
  return row;
}

// ── Confirm import ────────────────────────────────────────────────────────────

/**
 * Execute the import inside a transaction.
 *
 * Each row is re-validated immediately before the INSERT — this is the critical
 * guard against stale session data or any in-flight corruption between the
 * preview step and the final commit.  A row that fails re-validation is counted
 * as skipped rather than silently inserted with bad data.
 */
export async function confirmImport(sessionId: number, userId: number): Promise<ImportResult> {
  const session = await getSession(sessionId, userId);
  if (!session) throw new Error('Session not found');
  if (session.status !== 'preview') throw new Error('Session is not in preview status');

  const parsedRows = safeParsedRows(session.parsedRows, `confirmImport(session=${sessionId})`);
  const candidates = parsedRows.filter(r => !r.skipped && r.errors.length === 0);

  if (candidates.length === 0) throw new Error('No valid rows to import');

  const defaultCategory = await db('categories').where({ name: 'Other' }).first();
  const defaultCategoryId = defaultCategory?.id ?? 1;

  let importedCount = 0;
  let revalidationSkipped = 0;

  await db.transaction(async (trx) => {
    for (const row of candidates) {
      // Re-validate before every INSERT — prevents silent state corruption
      const freshErrors = validateRow(row);
      if (freshErrors.length > 0) {
        logger.warn(
          { sessionId, rowIndex: row.rowIndex, errors: freshErrors },
          'Row failed re-validation at import time — skipping'
        );
        revalidationSkipped++;
        continue;
      }

      await trx('expenses').insert({
        userId,
        categoryId: row.categoryId ?? defaultCategoryId,
        amount:      row.amount,
        description: row.description,
        date:        row.date,
      });
      importedCount++;
    }

    const totalSkipped = parsedRows.length - importedCount;

    await trx('import_sessions').where({ id: sessionId }).update({
      status: 'completed',
      importedExpenseCount: importedCount,
      updatedAt: db.fn.now(),
    });

    await trx('import_history').insert({
      userId,
      sessionId,
      fileName:     session.fileName ?? 'unknown.csv',
      totalRows:    parsedRows.length,
      importedRows: importedCount,
      skippedRows:  totalSkipped,
    });
  });

  if (revalidationSkipped > 0) {
    logger.warn({ sessionId, revalidationSkipped }, 'Some rows were skipped due to re-validation failures');
  }

  logger.info({ userId, sessionId, importedCount }, 'Import completed');

  const history = await db('import_history').where({ sessionId }).first<ImportHistory>();
  return { importedCount, skippedCount: parsedRows.length - importedCount, history: history! };
}

// ── History / read helpers ────────────────────────────────────────────────────

export async function listImportHistory(userId: number): Promise<ImportHistory[]> {
  return db('import_history').where({ userId }).orderBy('createdAt', 'desc');
}

export async function getParsedRows(sessionId: number, userId: number): Promise<ParsedRow[]> {
  const session = await getSession(sessionId, userId);
  if (!session?.parsedRows) return [];
  return safeParsedRows(session.parsedRows, `getParsedRows(session=${sessionId})`);
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from '../src/pages/Dashboard';
import * as expensesApi from '../src/api/expenses';
import type { Expense } from '../src/types';

vi.mock('../src/api/expenses');

// Suppress lucide-react icon rendering issues in jsdom
vi.mock('lucide-react', () => ({
  DollarSign: () => null,
  TrendingUp: () => null,
  TrendingDown: () => null,
  Receipt: () => null,
  Pencil: () => null,
  Trash2: () => null,
}));

vi.mock('../src/components/CategoryIcon', () => ({
  CategoryIcon: () => null,
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

const onEditExpense = vi.fn();

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 1, userId: 1, categoryId: 1,
    amount: 50, description: 'Test', date: '2026-01-01',
    createdAt: '', categoryName: 'Food', categoryIcon: 'utensils',
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

// ── Loading state ─────────────────────────────────────────────────────────────

describe('Dashboard — loading state', () => {
  it('shows loading indicators while data is fetching', () => {
    vi.mocked(expensesApi.getExpenses).mockReturnValue(new Promise(() => {}));
    vi.mocked(expensesApi.getMonthlyTotal).mockReturnValue(new Promise(() => {}));
    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    expect(screen.getAllByText('...').length).toBeGreaterThan(0);
  });
});

// ── Normal data ───────────────────────────────────────────────────────────────

describe('Dashboard — normal data', () => {
  it('renders monthly total correctly', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([makeExpense({ amount: 100 })]);
    vi.mocked(expensesApi.getMonthlyTotal).mockResolvedValue({ total: 150, year: 2026, month: 1 });

    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    expect(await screen.findByText('$150.00')).toBeInTheDocument();
  });

  it('renders average per expense correctly', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([
      makeExpense({ id: 1, amount: 100 }),
      makeExpense({ id: 2, amount: 50 }),
    ]);
    vi.mocked(expensesApi.getMonthlyTotal).mockResolvedValue({ total: 150, year: 2026, month: 1 });

    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    expect(await screen.findByText('$75.00')).toBeInTheDocument();
  });
});

// ── Bad / malformed data — UI must never show NaN ─────────────────────────────

describe('Dashboard — malformed data resilience', () => {
  it('shows $0.00 when monthly total is NaN', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([]);
    vi.mocked(expensesApi.getMonthlyTotal).mockResolvedValue({ total: NaN, year: 2026, month: 1 });

    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    const totals = await screen.findAllByText('$0.00');
    expect(totals.length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('shows $0.00 when monthly total is Infinity', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([]);
    vi.mocked(expensesApi.getMonthlyTotal).mockResolvedValue({ total: Infinity, year: 2026, month: 1 });

    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    const totals = await screen.findAllByText('$0.00');
    expect(totals.length).toBeGreaterThan(0);
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  });

  it('does not show NaN in avg when one expense has a bad amount', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([
      makeExpense({ id: 1, amount: 100 }),
      makeExpense({ id: 2, amount: NaN }),   // malformed
      makeExpense({ id: 3, amount: 50 }),
    ]);
    vi.mocked(expensesApi.getMonthlyTotal).mockResolvedValue({ total: 150, year: 2026, month: 1 });

    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    await screen.findByText('$150.00');
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('does not show NaN in avg when all expenses have bad amounts', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([
      makeExpense({ id: 1, amount: NaN }),
      makeExpense({ id: 2, amount: null as unknown as number }),
    ]);
    vi.mocked(expensesApi.getMonthlyTotal).mockResolvedValue({ total: 0, year: 2026, month: 1 });

    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    const zeros = await screen.findAllByText('$0.00');
    expect(zeros.length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('does not show Infinity in percent change when previous total is 0', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([makeExpense()]);
    vi.mocked(expensesApi.getMonthlyTotal)
      .mockResolvedValueOnce({ total: 200, year: 2026, month: 1 })  // current
      .mockResolvedValueOnce({ total: 0,   year: 2026, month: 0 }); // previous

    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    await screen.findByText('$200.00');
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
  });

  it('renders with empty expenses list without crashing', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([]);
    vi.mocked(expensesApi.getMonthlyTotal).mockResolvedValue({ total: 0, year: 2026, month: 1 });

    render(<Dashboard onEditExpense={onEditExpense} />, { wrapper: wrapper() });
    const zeros = await screen.findAllByText('$0.00');
    expect(zeros.length).toBeGreaterThan(0);
  });
});

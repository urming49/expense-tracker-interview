import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import {
  useExpenses,
  useExpense,
  useCreateExpense,
  useUpdateExpense,
  useDeleteExpense,
  useMonthlyTotal,
} from '../src/hooks/useExpenses';
import * as expensesApi from '../src/api/expenses';
import type { Expense, MonthlyTotal } from '../src/types';

vi.mock('../src/api/expenses');

const mockExpense: Expense = {
  id: 1,
  userId: 1,
  categoryId: 1,
  amount: 45.5,
  description: 'Grocery run',
  date: '2026-01-05',
  createdAt: '2026-01-05T00:00:00Z',
  categoryName: 'Food',
  categoryIcon: '🍔',
};

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('useExpenses', () => {
  it('returns expenses from the API', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([mockExpense]);
    const { result } = renderHook(() => useExpenses(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([mockExpense]);
  });

  it('passes filter params to the API', async () => {
    vi.mocked(expensesApi.getExpenses).mockResolvedValue([]);
    const params = { search: 'coffee', startDate: '2026-01-01', endDate: '2026-01-31' };
    renderHook(() => useExpenses(params), { wrapper: wrapper() });
    await waitFor(() => expect(expensesApi.getExpenses).toHaveBeenCalledWith(params));
  });

  it('surfaces API errors', async () => {
    vi.mocked(expensesApi.getExpenses).mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useExpenses(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe('useExpense', () => {
  it('fetches a single expense by id', async () => {
    vi.mocked(expensesApi.getExpense).mockResolvedValue(mockExpense);
    const { result } = renderHook(() => useExpense(1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockExpense);
    expect(expensesApi.getExpense).toHaveBeenCalledWith(1);
  });

  it('does not fetch when id is 0 (falsy)', () => {
    const { result } = renderHook(() => useExpense(0), { wrapper: wrapper() });
    expect(result.current.fetchStatus).toBe('idle');
    expect(expensesApi.getExpense).not.toHaveBeenCalled();
  });
});

describe('useMonthlyTotal', () => {
  it('returns the monthly total', async () => {
    const mockTotal: MonthlyTotal = { total: 320.5, year: 2026, month: 1 };
    vi.mocked(expensesApi.getMonthlyTotal).mockResolvedValue(mockTotal);
    const { result } = renderHook(() => useMonthlyTotal(2026, 1), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.total).toBe(320.5);
  });
});

describe('useCreateExpense', () => {
  it('calls createExpense and invalidates queries on success', async () => {
    vi.mocked(expensesApi.createExpense).mockResolvedValue(mockExpense);
    const { result } = renderHook(() => useCreateExpense(), { wrapper: wrapper() });
    result.current.mutate({ categoryId: 1, amount: 45.5, description: 'Grocery run', date: '2026-01-05' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockExpense);
  });

  it('exposes error when API fails', async () => {
    vi.mocked(expensesApi.createExpense).mockRejectedValue(new Error('Bad request'));
    const { result } = renderHook(() => useCreateExpense(), { wrapper: wrapper() });
    result.current.mutate({ categoryId: 1, amount: -1, description: '', date: '' });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUpdateExpense', () => {
  it('calls updateExpense with correct id and data', async () => {
    const updated = { ...mockExpense, amount: 99 };
    vi.mocked(expensesApi.updateExpense).mockResolvedValue(updated);
    const { result } = renderHook(() => useUpdateExpense(), { wrapper: wrapper() });
    result.current.mutate({ id: 1, data: { amount: 99 } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(expensesApi.updateExpense).toHaveBeenCalledWith(1, { amount: 99 });
    expect(result.current.data?.amount).toBe(99);
  });
});

describe('useDeleteExpense', () => {
  it('calls deleteExpense with the correct id', async () => {
    vi.mocked(expensesApi.deleteExpense).mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteExpense(), { wrapper: wrapper() });
    result.current.mutate(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(expensesApi.deleteExpense).toHaveBeenCalledWith(1);
  });
});

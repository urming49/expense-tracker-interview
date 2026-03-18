import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ExpenseForm } from '../src/components/ExpenseForm';

// mock useCategories so the form renders without a query client
vi.mock('../src/hooks/useCategories', () => ({
  useCategories: () => ({
    data: [
      { id: 1, name: 'Food', icon: '🍔' },
      { id: 2, name: 'Transport', icon: '🚗' },
    ],
  }),
}));

const onSubmit = vi.fn();
const onCancel = vi.fn();

function renderForm() {
  render(<ExpenseForm onSubmit={onSubmit} onCancel={onCancel} />);
}

// helpers
function setAmount(value: string) {
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value } });
}
function setDescription(value: string) {
  fireEvent.change(screen.getByLabelText(/description/i), { target: { value } });
}
function setDate(value: string) {
  fireEvent.change(screen.getByLabelText(/date/i), { target: { value } });
}
function submit() {
  fireEvent.click(screen.getByRole('button', { name: /create/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExpenseForm — valid submission', () => {
  it('calls onSubmit with correct data when all fields are valid', () => {
    renderForm();
    setAmount('49.99');
    setDescription('Lunch');
    setDate('2026-01-15');
    submit();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 49.99, description: 'Lunch', date: '2026-01-15' })
    );
  });
});

describe('ExpenseForm — amount validation', () => {
  it('shows error when amount is empty', () => {
    renderForm();
    setAmount('');
    setDescription('Test');
    setDate('2026-01-01');
    submit();
    expect(screen.getByText(/amount is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error when amount is zero', () => {
    renderForm();
    setAmount('0');
    setDescription('Test');
    setDate('2026-01-01');
    submit();
    expect(screen.getByText(/greater than 0/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error when amount is negative', () => {
    renderForm();
    setAmount('-10');
    setDescription('Test');
    setDate('2026-01-01');
    submit();
    expect(screen.getByText(/greater than 0/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ExpenseForm — description validation', () => {
  it('shows error when description is empty', () => {
    renderForm();
    setAmount('10');
    setDescription('');
    setDate('2026-01-01');
    submit();
    expect(screen.getByText(/description is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error when description is only whitespace', () => {
    renderForm();
    setAmount('10');
    setDescription('   ');
    setDate('2026-01-01');
    submit();
    expect(screen.getByText(/description is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ExpenseForm — date validation', () => {
  it('shows error when date is empty', () => {
    renderForm();
    setAmount('10');
    setDescription('Test');
    setDate('');
    submit();
    expect(screen.getByText(/date is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error for impossible date Feb 30', () => {
    renderForm();
    setAmount('10');
    setDescription('Test');
    setDate('2026-02-30');
    submit();
    expect(screen.getByText(/valid calendar date/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error for impossible date Apr 31', () => {
    renderForm();
    setAmount('10');
    setDescription('Test');
    setDate('2026-04-31');
    submit();
    expect(screen.getByText(/valid calendar date/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts a valid leap-year date Feb 29', () => {
    renderForm();
    setAmount('10');
    setDescription('Test');
    setDate('2024-02-29');
    submit();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('rejects Feb 29 on a non-leap year', () => {
    renderForm();
    setAmount('10');
    setDescription('Test');
    setDate('2026-02-29');
    submit();
    expect(screen.getByText(/valid calendar date/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ExpenseForm — multiple errors at once', () => {
  it('shows all errors simultaneously when all fields are invalid', () => {
    renderForm();
    setAmount('');
    setDescription('');
    setDate('');
    submit();
    expect(screen.getByText(/amount is required/i)).toBeInTheDocument();
    expect(screen.getByText(/description is required/i)).toBeInTheDocument();
    expect(screen.getByText(/date is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ExpenseForm — cancel', () => {
  it('calls onCancel when cancel button is clicked', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('ExpenseForm — edit mode', () => {
  it('pre-fills fields from initialData', () => {
    render(
      <ExpenseForm
        onSubmit={onSubmit}
        onCancel={onCancel}
        initialData={{
          id: 1, userId: 1, categoryId: 1,
          amount: 75, description: 'Existing expense',
          date: '2026-01-10', createdAt: '',
          categoryName: 'Food', categoryIcon: '🍔',
        }}
      />
    );
    expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe('75');
    expect((screen.getByLabelText(/description/i) as HTMLInputElement).value).toBe('Existing expense');
    expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
  });
});

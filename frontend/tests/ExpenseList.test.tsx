import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ExpenseList } from '../src/components/ExpenseList';
import type { Expense } from '../src/types';

vi.mock('lucide-react', () => ({
  Pencil: () => null,
  Trash2: () => null,
}));

vi.mock('../src/components/CategoryIcon', () => ({
  CategoryIcon: () => null,
}));

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 1, userId: 1, categoryId: 1,
    amount: 49.99, description: 'Lunch', date: '2026-01-10',
    createdAt: '', categoryName: 'Food', categoryIcon: 'utensils',
    ...overrides,
  };
}

const noop = () => {};

describe('ExpenseList — empty state', () => {
  it('shows empty message when no expenses', () => {
    render(<ExpenseList expenses={[]} onEdit={noop} onDelete={noop} />);
    expect(screen.getByText(/no expenses found/i)).toBeInTheDocument();
  });
});

describe('ExpenseList — normal data', () => {
  it('renders expense description and amount', () => {
    render(<ExpenseList expenses={[makeExpense()]} onEdit={noop} onDelete={noop} />);
    expect(screen.getByText('Lunch')).toBeInTheDocument();
    expect(screen.getByText('$49.99')).toBeInTheDocument();
  });

  it('renders multiple expenses', () => {
    render(
      <ExpenseList
        expenses={[makeExpense({ id: 1, description: 'Coffee' }), makeExpense({ id: 2, description: 'Taxi' })]}
        onEdit={noop}
        onDelete={noop}
      />
    );
    expect(screen.getByText('Coffee')).toBeInTheDocument();
    expect(screen.getByText('Taxi')).toBeInTheDocument();
  });
});

describe('ExpenseList — malformed amount resilience', () => {
  it('does not render NaN when amount is NaN', () => {
    render(
      <ExpenseList expenses={[makeExpense({ amount: NaN })]} onEdit={noop} onDelete={noop} />
    );
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('does not render NaN when amount is null', () => {
    render(
      <ExpenseList
        expenses={[makeExpense({ amount: null as unknown as number })]}
        onEdit={noop}
        onDelete={noop}
      />
    );
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('does not render Infinity when amount is Infinity', () => {
    render(
      <ExpenseList expenses={[makeExpense({ amount: Infinity })]} onEdit={noop} onDelete={noop} />
    );
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('renders valid expenses correctly even when mixed with bad ones', () => {
    render(
      <ExpenseList
        expenses={[
          makeExpense({ id: 1, amount: 25.00, description: 'Good' }),
          makeExpense({ id: 2, amount: NaN,   description: 'Bad'  }),
        ]}
        onEdit={noop}
        onDelete={noop}
      />
    );
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

import { Pencil, Trash2 } from 'lucide-react';
import type { Expense } from '../types';
import { CategoryIcon } from './CategoryIcon';
import { safeNum } from '../utils/numbers';

interface ExpenseListProps {
  expenses: Expense[];
  onEdit: (expense: Expense) => void;
  onDelete: (id: number) => void;
}

export function ExpenseList({ expenses, onEdit, onDelete }: ExpenseListProps) {
  if (expenses.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        No expenses found. Add your first expense!
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <ul className="divide-y divide-gray-200">
        {expenses.map((expense) => (
          <li key={expense.id} className="p-4 hover:bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  <CategoryIcon icon={expense.categoryIcon} />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{expense.description}</p>
                  <p className="text-sm text-gray-500">
                    {expense.categoryName} &middot; {formatDate(expense.date)}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <span className="text-sm font-semibold text-gray-900">
                  ${safeNum(expense.amount).toFixed(2)}
                </span>
                <div className="flex space-x-2">
                  <button
                    onClick={() => onEdit(expense)}
                    className="p-1 text-gray-400 hover:text-indigo-600"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onDelete(expense.id)}
                    className="p-1 text-gray-400 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

import { useState, useEffect } from 'react';
import { useCategories } from '../hooks/useCategories';
import type { CreateExpenseData, Expense } from '../types';

/**
 * Props for the ExpenseForm component.
 *
 * @property onSubmit   - Called with validated form data when the user submits.
 *                        Receives a `CreateExpenseData` object with all fields parsed
 *                        and ready to send to the API.
 * @property onCancel   - Called when the user clicks the Cancel button.
 * @property initialData - Optional existing expense. When provided the form
 *                         switches to edit mode: fields are pre-filled and the
 *                         submit button reads "Update" instead of "Create".
 * @property isLoading  - When true the submit button is disabled and shows
 *                        "Saving..." to prevent duplicate submissions.
 */
interface ExpenseFormProps {
  onSubmit: (data: CreateExpenseData) => void;
  onCancel: () => void;
  initialData?: Expense;
  isLoading?: boolean;
}

/**
 * ExpenseForm
 *
 * A controlled form for creating or editing an expense record.
 * Handles its own field state, client-side validation, and error display.
 *
 * ## Fields
 * | Field       | Input type | Required | Validation                                      |
 * |-------------|------------|----------|-------------------------------------------------|
 * | Category    | `<select>` | yes      | Must be a valid category id from the API        |
 * | Amount      | `number`   | yes      | Finite positive number (> 0), no Infinity / NaN |
 * | Description | `text`     | yes      | Non-empty, non-whitespace string                |
 * | Date        | `date`     | yes      | YYYY-MM-DD, must be a real calendar date        |
 *
 * ## State design
 * Amount is stored as a raw string (`amountRaw`) rather than a number so that
 * an empty input stays empty. Converting to `Number()` eagerly would turn `''`
 * into `0`, making the "required" check impossible to trigger. The conversion
 * happens only inside `validate()` and `handleSubmit()`, after the empty check
 * has already passed.
 *
 * ## Validation rules
 * - Amount
 *   - Empty string → "Amount is required"
 *   - `NaN` or `Infinity` → "Amount must be a finite number"
 *   - `<= 0` → "Amount must be greater than 0"
 * - Description
 *   - Empty or whitespace-only → "Description is required"
 * - Date
 *   - Empty → "Date is required"
 *   - Does not match `YYYY-MM-DD` → "Date must be in YYYY-MM-DD format"
 *   - Impossible calendar date (e.g. Feb 30) → "Date must be a valid calendar date"
 *     (detected via `new Date()` round-trip check)
 *
 * All errors are evaluated on every submit attempt and displayed simultaneously
 * beneath their respective inputs.
 *
 * @example — create mode
 * ```tsx
 * <ExpenseForm
 *   onSubmit={(data) => createExpense(data)}
 *   onCancel={() => setOpen(false)}
 * />
 * ```
 *
 * @example — edit mode
 * ```tsx
 * <ExpenseForm
 *   initialData={expense}
 *   onSubmit={(data) => updateExpense(expense.id, data)}
 *   onCancel={() => setOpen(false)}
 *   isLoading={isPending}
 * />
 * ```
 */

export function ExpenseForm({ onSubmit, onCancel, initialData, isLoading }: ExpenseFormProps) {
  const { data: categories } = useCategories();
  const [amountRaw, setAmountRaw] = useState<string>(
    initialData?.amount != null ? String(initialData.amount) : ''
  );
  const [formData, setFormData] = useState<Omit<CreateExpenseData, 'amount'>>({
    categoryId: initialData?.categoryId || 1,
    description: initialData?.description || '',
    date: initialData?.date || new Date().toISOString().split('T')[0],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (initialData) {
      setAmountRaw(String(initialData.amount));
      setFormData({
        categoryId: initialData.categoryId,
        description: initialData.description,
        date: initialData.date,
      });
    }
  }, [initialData]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (amountRaw.trim() === '') {
      newErrors.amount = 'Amount is required';
    } else {
      const amount = Number(amountRaw);
      if (isNaN(amount) || !isFinite(amount)) {
        newErrors.amount = 'Amount must be a finite number';
      } else if (amount <= 0) {
        newErrors.amount = 'Amount must be greater than 0';
      }
    }

    if (!formData.description.trim()) {
      newErrors.description = 'Description is required';
    }

    if (!formData.date) {
      newErrors.date = 'Date is required';
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.date)) {
      newErrors.date = 'Date must be in YYYY-MM-DD format';
    } else {
      const parsed = new Date(formData.date);
      if (isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(formData.date)) {
        newErrors.date = 'Date must be a valid calendar date';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (validate()) {
      onSubmit({ ...formData, amount: Number(amountRaw) });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="category" className="block text-sm font-medium text-gray-700">
          Category
        </label>
        <select
          id="category"
          value={formData.categoryId}
          onChange={(e) => setFormData({ ...formData, categoryId: Number(e.target.value) })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border p-2"
        >
          {categories?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="amount" className="block text-sm font-medium text-gray-700">
          Amount
        </label>
        <input
          type="number"
          id="amount"
          step="0.01"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value)}
          className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm border p-2 ${
            errors.amount ? 'border-red-500' : 'border-gray-300'
          } focus:border-indigo-500 focus:ring-indigo-500`}
          placeholder="0.00"
        />
        {errors.amount && <p className="mt-1 text-sm text-red-600">{errors.amount}</p>}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <input
          type="text"
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm border p-2 ${
            errors.description ? 'border-red-500' : 'border-gray-300'
          } focus:border-indigo-500 focus:ring-indigo-500`}
          placeholder="What was this expense for?"
        />
        {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description}</p>}
      </div>

      <div>
        <label htmlFor="date" className="block text-sm font-medium text-gray-700">
          Date
        </label>
        <input
          type="date"
          id="date"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm border p-2 ${
            errors.date ? 'border-red-500' : 'border-gray-300'
          } focus:border-indigo-500 focus:ring-indigo-500`}
        />
        {errors.date && <p className="mt-1 text-sm text-red-600">{errors.date}</p>}
      </div>

      <div className="flex justify-end space-x-3 pt-4">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md hover:bg-indigo-700 disabled:opacity-50"
        >
          {isLoading ? 'Saving...' : initialData ? 'Update' : 'Create'}
        </button>
      </div>
    </form>
  );
}

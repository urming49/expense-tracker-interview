import { useExpenses, useMonthlyTotal } from '../hooks/useExpenses';
import { ExpenseList } from '../components/ExpenseList';
import { DollarSign, TrendingUp, TrendingDown, Receipt } from 'lucide-react';
import { safeNum, safeSum, percentChange } from '../utils/numbers';

interface DashboardProps {
  onEditExpense: (expense: { id: number }) => void;
}

export function Dashboard({ onEditExpense }: DashboardProps) {
  const { data: expenses, isLoading: expensesLoading } = useExpenses();
  const { data: monthlyTotal, isLoading: totalLoading } = useMonthlyTotal();

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const { data: lastMonthTotal, isLoading: lastMonthLoading } = useMonthlyTotal(
    lastMonth.getFullYear(),
    lastMonth.getMonth() + 1
  );

  const recentExpenses = expenses?.slice(0, 5) || [];
  const totalExpenses = expenses?.length || 0;
  const monthName = new Date().toLocaleDateString('en-US', { month: 'long' });

  const currentTotal  = safeNum(monthlyTotal?.total);
  const previousTotal = safeNum(lastMonthTotal?.total);
  const difference    = currentTotal - previousTotal;
  const pct           = percentChange(currentTotal, previousTotal);

  const avgPerExpense = expenses?.length
    ? safeSum(expenses.map(e => e.amount)) / expenses.length
    : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">

        {/* Monthly spending */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <DollarSign className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    {monthName} Spending
                  </dt>
                  <dd className="text-lg font-semibold text-gray-900">
                    {totalLoading ? '...' : `$${currentTotal.toFixed(2)}`}
                  </dd>
                  {!totalLoading && !lastMonthLoading && previousTotal > 0 && (
                    <dd className={`flex items-center text-sm ${difference >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {difference >= 0
                        ? <TrendingUp className="h-4 w-4 mr-1" />
                        : <TrendingDown className="h-4 w-4 mr-1" />}
                      {Math.abs(pct).toFixed(1)}% vs last month
                    </dd>
                  )}
                </dl>
              </div>
            </div>
          </div>
        </div>

        {/* Total count */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Receipt className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Total Expenses</dt>
                  <dd className="text-lg font-semibold text-gray-900">
                    {expensesLoading ? '...' : totalExpenses}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        {/* Average per expense */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-5">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <TrendingUp className="h-6 w-6 text-gray-400" />
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">Avg per Expense</dt>
                  <dd className="text-lg font-semibold text-gray-900">
                    {expensesLoading ? '...' : `$${avgPerExpense.toFixed(2)}`}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Recent Expenses */}
      <div>
        <h2 className="text-lg font-medium text-gray-900 mb-4">Recent Expenses</h2>
        {expensesLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : (
          <ExpenseList
            expenses={recentExpenses}
            onEdit={onEditExpense}
            onDelete={() => {}}
          />
        )}
      </div>
    </div>
  );
}

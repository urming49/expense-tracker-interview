import { Router, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../logger.js';
import { authenticateToken } from '../middleware/auth.js';
import * as expenseService from '../services/expenseService.js';
import type { JwtPayload } from '../types/index.js';

const router = Router();

type AuthRequest = Request & { user: JwtPayload };

const validAmount = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .finite('Amount must be a finite number')
  .positive('Amount must be greater than 0');

const validDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((d) => {
    const parsed = new Date(d);
    return !isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d);
  }, 'Date must be a valid calendar date');

const createExpenseSchema = z.object({
  categoryId: z.number().int().positive(),
  amount: validAmount,
  description: z.string().min(1, 'Description is required').max(255),
  date: validDate,
});

const updateExpenseSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  amount: validAmount.optional(),
  description: z.string().min(1, 'Description is required').max(255).optional(),
  date: validDate.optional(),
});

router.use(authenticateToken);

router.get('/', async (req: Request, res: Response) => {
  try {
    const { user } = req as AuthRequest;
    const { limit, offset, startDate, endDate, search } = req.query;

    const expenses = await expenseService.listExpenses({
      userId: user.userId,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      search: search as string | undefined,
    });

    res.json(expenses);
  } catch (error) {
    logger.error({ err: error }, 'Failed to list expenses');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/monthly-total', async (req: Request, res: Response) => {
  try {
    const { user } = req as AuthRequest;
    const now = new Date();
    const year = Number(req.query.year) || now.getFullYear();
    const month = Number(req.query.month) || now.getMonth() + 1;

    const total = await expenseService.getMonthlyTotal(user.userId, year, month);
    res.json({ total, year, month });
  } catch (error) {
    logger.error({ err: error }, 'Failed to get monthly total');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { user } = req as AuthRequest;
    const id = Number(req.params.id);

    const expense = await expenseService.getExpense(id, user.userId);
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    res.json(expense);
  } catch (error) {
    logger.error({ err: error, expenseId: req.params.id }, 'Failed to get expense');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { user } = req as AuthRequest;
    const data = createExpenseSchema.parse(req.body);

    const expense = await expenseService.createExpense({
      userId: user.userId,
      ...data,
    });

    logger.info({ userId: user.userId, expenseId: expense.id }, 'Expense created');
    res.status(201).json(expense);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.info({ errors: error.errors }, 'Expense creation validation failed');
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    logger.error({ err: error }, 'Failed to create expense');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { user } = req as AuthRequest;
    const id = Number(req.params.id);
    const data = updateExpenseSchema.parse(req.body);

    const expense = await expenseService.updateExpense(id, user.userId, data);
    if (!expense) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    logger.info({ userId: user.userId, expenseId: id }, 'Expense updated');
    res.json(expense);
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.info({ errors: error.errors }, 'Expense update validation failed');
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }
    logger.error({ err: error, expenseId: req.params.id }, 'Failed to update expense');
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { user } = req as AuthRequest;
    const id = Number(req.params.id);

    const deleted = await expenseService.deleteExpense(id, user.userId);
    if (!deleted) {
      res.status(404).json({ error: 'Expense not found' });
      return;
    }

    logger.info({ userId: user.userId, expenseId: id }, 'Expense deleted');
    res.status(204).send();
  } catch (error) {
    logger.error({ err: error, expenseId: req.params.id }, 'Failed to delete expense');
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

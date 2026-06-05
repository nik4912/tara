import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import { merchantLikePattern } from '../services/merchantNormalizer';
import { resolveDateRange } from '../utils/dateHelpers';

// ---------------------------------------------------------------------------
// Flat input schema — no nested objects (required for Groq tool compatibility)
// ---------------------------------------------------------------------------

const QueryTransactionsInput = z.object({
  operation: z.enum([
    'total_by_category',
    'total_by_merchant',
    'top_merchants',
    'biggest_expense',
    'monthly_breakdown',
    'spending_comparison',
    'merchant_history',
    'category_list',
    'transaction_list',
  ]).describe('Analysis operation to run'),

  // Date filters
  startDate: z.string().optional().describe('Start date inclusive YYYY-MM-DD'),
  endDate: z.string().optional().describe('End date inclusive YYYY-MM-DD'),
  month: z.coerce.number().min(1).max(12).optional().describe('Month number 1-12'),
  year: z.coerce.number().optional().describe('Calendar year e.g. 2024'),

  // Content filters
  category: z.string().optional().describe('Category to filter e.g. Food, Travel, Subscriptions'),
  merchant: z.string().optional().describe('Merchant name partial match'),
  includeTransfers: z.string().optional().describe('Pass "yes" to include Transfer-category rows. Omit to exclude transfers (default).'),
  includeRefunds: z.string().optional().describe('Pass "yes" to exclude refund rows. Omit to include refunds (default).'),

  // Output controls
  limit: z.coerce.number().min(1).max(100).optional().default(10).describe('Max rows to return'),
  compareCategories: z.array(z.string()).optional().describe('For spending_comparison: list of categories e.g. ["Food","Travel"]'),
});

type Ctx = z.infer<typeof QueryTransactionsInput>;

// ---------------------------------------------------------------------------
// WHERE clause builder (uses flat context directly)
// ---------------------------------------------------------------------------

function buildWhere(ctx: Ctx, extraParts: string[] = [], alias = 't'): string {
  const parts: string[] = [...extraParts];

  const { start, end } = resolveDateRange({
    startDate: ctx.startDate,
    endDate: ctx.endDate,
    month: ctx.month,
    year: ctx.year,
  });

  if (start) parts.push(`${alias}.date >= '${start}'`);
  if (end)   parts.push(`${alias}.date <= '${end}'`);

  // Exclude transfers unless caller explicitly opts in via includeTransfers="yes"
  const wantTransfers = ctx.includeTransfers?.toLowerCase() === 'yes';
  if (!wantTransfers) {
    parts.push(`${alias}.category != 'Transfer'`);
  }

  // Exclude refunds (negative amounts) only if caller opts out via includeRefunds="no"
  const hideRefunds = ctx.includeRefunds?.toLowerCase() === 'no';
  if (hideRefunds) {
    parts.push(`${alias}.amount > 0`);
  }

  if (ctx.category) {
    const safe = ctx.category.replace(/'/g, "''");
    parts.push(`LOWER(${alias}.category) = LOWER('${safe}')`);
  }

  if (ctx.merchant) {
    const pattern = merchantLikePattern(ctx.merchant).replace(/'/g, "''");
    parts.push(`${alias}.merchant_normalized LIKE '${pattern}'`);
  }

  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const queryTransactions = createTool({
  id: 'queryTransactions',
  description: `Query and analyze financial transactions from PostgreSQL.
Use for: spending totals, top merchants, biggest expense, monthly trends, category comparisons, subscription detection, refund analysis.
Transfers are excluded by default. Refunds (negative amounts) reduce totals automatically.`,

  inputSchema: QueryTransactionsInput,

  execute: async ({ context: ctx }) => {
    const limit = ctx.limit ?? 10;

    try {
      switch (ctx.operation) {

        case 'total_by_category': {
          const where = buildWhere(ctx);
          const rows = await db.execute(sql.raw(`
            SELECT
              category,
              SUM(amount)::FLOAT AS total,
              COUNT(*)::INT      AS transaction_count,
              SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)::FLOAT AS refund_total
            FROM transactions t ${where}
            GROUP BY category ORDER BY SUM(amount) DESC
          `));
          return { operation: ctx.operation, results: rows.rows, count: rows.rows.length };
        }

        case 'total_by_merchant': {
          const where = buildWhere(ctx);
          const rows = await db.execute(sql.raw(`
            SELECT
              merchant_normalized,
              SUM(amount)::FLOAT AS total,
              COUNT(*)::INT      AS transaction_count
            FROM transactions t ${where}
            GROUP BY merchant_normalized ORDER BY SUM(amount) DESC LIMIT ${limit}
          `));
          return { operation: ctx.operation, results: rows.rows, count: rows.rows.length };
        }

        case 'top_merchants': {
          const where = buildWhere(ctx);
          const rows = await db.execute(sql.raw(`
            SELECT
              merchant_normalized,
              SUM(amount)::FLOAT AS total_spend,
              COUNT(*)::INT      AS transaction_count,
              AVG(amount)::FLOAT AS avg_transaction
            FROM transactions t ${where}
            GROUP BY merchant_normalized ORDER BY SUM(amount) DESC LIMIT ${limit}
          `));
          return { operation: ctx.operation, results: rows.rows, count: rows.rows.length };
        }

        case 'biggest_expense': {
          const where = buildWhere(ctx, ['t.amount > 0']);
          const rows = await db.execute(sql.raw(`
            SELECT id, date, merchant, category, amount::FLOAT AS amount, currency, memo
            FROM transactions t ${where}
            ORDER BY amount DESC LIMIT 1
          `));
          return { operation: ctx.operation, result: rows.rows[0] ?? null, found: rows.rows.length > 0 };
        }

        case 'monthly_breakdown': {
          const where = buildWhere(ctx);
          const rows = await db.execute(sql.raw(`
            SELECT
              EXTRACT(YEAR  FROM date::DATE)::INT AS year,
              EXTRACT(MONTH FROM date::DATE)::INT AS month,
              TO_CHAR(date::DATE, 'Month YYYY')   AS month_label,
              SUM(amount)::FLOAT                  AS total,
              COUNT(*)::INT                       AS transaction_count
            FROM transactions t ${where}
            GROUP BY year, month, month_label ORDER BY year, month
          `));
          return { operation: ctx.operation, results: rows.rows, count: rows.rows.length };
        }

        case 'spending_comparison': {
          if (!ctx.compareCategories || ctx.compareCategories.length === 0) {
            return { error: 'compareCategories is required for spending_comparison' };
          }
          const catFilter = ctx.compareCategories
            .map((c) => `LOWER('${c.replace(/'/g, "''")}')`)
            .join(', ');
          const ctxNoCategory: Ctx = { ...ctx, category: undefined };
          const where = buildWhere(ctxNoCategory, [
            `LOWER(t.category) = ANY(ARRAY[${catFilter}])`,
          ]);
          const rows = await db.execute(sql.raw(`
            SELECT
              category,
              SUM(amount)::FLOAT AS total,
              COUNT(*)::INT      AS transaction_count,
              AVG(amount)::FLOAT AS avg_transaction
            FROM transactions t ${where}
            GROUP BY category ORDER BY SUM(amount) DESC
          `));
          return { operation: ctx.operation, comparedCategories: ctx.compareCategories, results: rows.rows };
        }

        case 'merchant_history': {
          if (!ctx.merchant) return { error: 'merchant is required for merchant_history' };
          const where = buildWhere(ctx);
          const rows = await db.execute(sql.raw(`
            SELECT id, date, merchant, category, amount::FLOAT AS amount, currency, memo
            FROM transactions t ${where}
            ORDER BY date DESC LIMIT ${limit}
          `));
          return { operation: ctx.operation, results: rows.rows, count: rows.rows.length };
        }

        case 'category_list': {
          const rows = await db.execute(sql.raw(
            `SELECT DISTINCT category FROM transactions ORDER BY category`
          ));
          return { operation: ctx.operation, categories: rows.rows.map((r: Record<string, unknown>) => r.category) };
        }

        case 'transaction_list': {
          const where = buildWhere(ctx);
          const rows = await db.execute(sql.raw(`
            SELECT id, date, merchant, category, amount::FLOAT AS amount, currency, memo
            FROM transactions t ${where}
            ORDER BY date DESC, amount DESC LIMIT ${limit}
          `));
          return { operation: ctx.operation, results: rows.rows, count: rows.rows.length };
        }

        default:
          return { error: `Unknown operation: ${ctx.operation}` };
      }
    } catch (err) {
      return { error: `Query failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

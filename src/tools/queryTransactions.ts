import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import { merchantLikePattern } from '../services/merchantNormalizer';
import { resolveDateRange } from '../utils/dateHelpers';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const OperationEnum = z.enum([
  'total_by_category',   // SUM of spend grouped by category
  'total_by_merchant',   // SUM of spend grouped by (normalized) merchant
  'top_merchants',       // Top N merchants by total spend
  'biggest_expense',     // Single largest transaction
  'monthly_breakdown',   // Month-by-month spend totals
  'spending_comparison', // Compare spend across a list of categories
  'merchant_history',    // All transactions for a specific merchant
  'category_list',       // Distinct categories present in the data
  'transaction_list',    // Raw list of transactions (with filters)
]);

const FiltersInnerSchema = z.object({
  startDate: z.string().optional().describe('Start date inclusive (YYYY-MM-DD)'),
  endDate: z.string().optional().describe('End date inclusive (YYYY-MM-DD)'),
  month: z.number().min(1).max(12).optional().describe('Month number 1-12'),
  year: z.number().optional().describe('Calendar year e.g. 2024'),
  category: z.string().optional().describe('Single category to filter on'),
  merchant: z.string().optional().describe('Merchant name — partial/fuzzy match'),
  excludeTransfers: z.boolean().optional().default(true).describe('Exclude Transfer category'),
  excludeRefunds: z.boolean().optional().default(false).describe('If true exclude negative-amount rows'),
});

const FiltersSchema = FiltersInnerSchema.optional();

type FiltersInput = {
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
  category?: string;
  merchant?: string;
  excludeTransfers?: boolean;
  excludeRefunds?: boolean;
};

const QueryTransactionsInput = z.object({
  operation: OperationEnum.describe('Type of analysis to perform'),
  filters: FiltersSchema,
  limit: z.number().min(1).max(100).optional().default(10),
  compareCategories: z
    .array(z.string())
    .optional()
    .describe('For spending_comparison: list of category names to compare'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the WHERE clause fragments as an array of SQL snippets. */
function buildWhereFragments(
  filters: FiltersInput | undefined,
  tableAlias = 't'
): string[] {
  const parts: string[] = [];
  const f: FiltersInput = filters ?? {};

  const { start, end } = resolveDateRange({
    startDate: f.startDate,
    endDate: f.endDate,
    month: f.month,
    year: f.year,
  });

  if (start) parts.push(`${tableAlias}.date >= '${start}'`);
  if (end)   parts.push(`${tableAlias}.date <= '${end}'`);

  if (f.excludeTransfers !== false) {
    parts.push(`${tableAlias}.category != 'Transfer'`);
  }

  if (f.excludeRefunds) {
    parts.push(`${tableAlias}.amount > 0`);
  }

  if (f.category) {
    const safe = f.category.replace(/'/g, "''");
    parts.push(`LOWER(${tableAlias}.category) = LOWER('${safe}')`);
  }

  if (f.merchant) {
    const pattern = merchantLikePattern(f.merchant).replace(/'/g, "''");
    parts.push(`${tableAlias}.merchant_normalized LIKE '${pattern}'`);
  }

  return parts;
}

function whereClause(parts: string[]): string {
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const queryTransactions = createTool({
  id: 'queryTransactions',
  description: `Query and analyze financial transactions stored in PostgreSQL.
Use this tool for any question about spending, expenses, merchants, categories,
refunds, transfers, or time-based trends.

Operations:
- total_by_category: Sum of spend per category
- total_by_merchant: Sum of spend per merchant (normalized)
- top_merchants: Top N merchants by total spend
- biggest_expense: Single largest transaction
- monthly_breakdown: Month-by-month totals
- spending_comparison: Compare spend across categories (set compareCategories)
- merchant_history: All transactions for a specific merchant
- category_list: Distinct categories in the data
- transaction_list: Raw list with optional filters

IMPORTANT: Transfers are excluded by default. Refunds (negative amounts) reduce totals.`,

  inputSchema: QueryTransactionsInput,

  execute: async ({ context }) => {
    const { operation, filters, limit = 10, compareCategories } = context;
    const where = whereClause(buildWhereFragments(filters));

    try {
      switch (operation) {
        // ----------------------------------------------------------------
        case 'total_by_category': {
          const rows = await db.execute(sql.raw(`
            SELECT
              category,
              SUM(amount)::FLOAT           AS total,
              COUNT(*)::INT                AS transaction_count,
              SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)::FLOAT AS refund_total
            FROM transactions t
            ${where}
            GROUP BY category
            ORDER BY SUM(amount) DESC
          `));
          return {
            operation,
            results: rows.rows,
            count: rows.rows.length,
            note: 'Refunds (negative amounts) are included and reduce the total.',
          };
        }

        // ----------------------------------------------------------------
        case 'total_by_merchant': {
          const rows = await db.execute(sql.raw(`
            SELECT
              merchant_normalized,
              SUM(amount)::FLOAT  AS total,
              COUNT(*)::INT       AS transaction_count
            FROM transactions t
            ${where}
            GROUP BY merchant_normalized
            ORDER BY SUM(amount) DESC
            LIMIT ${limit}
          `));
          return { operation, results: rows.rows, count: rows.rows.length };
        }

        // ----------------------------------------------------------------
        case 'top_merchants': {
          // Only count positive spend; refunds reduce a merchant's total
          const baseWhere = whereClause([
            ...buildWhereFragments(filters),
          ]);
          const rows = await db.execute(sql.raw(`
            SELECT
              merchant_normalized,
              SUM(amount)::FLOAT  AS total_spend,
              COUNT(*)::INT       AS transaction_count,
              AVG(amount)::FLOAT  AS avg_transaction
            FROM transactions t
            ${baseWhere}
            GROUP BY merchant_normalized
            ORDER BY SUM(amount) DESC
            LIMIT ${limit}
          `));
          return { operation, results: rows.rows, count: rows.rows.length };
        }

        // ----------------------------------------------------------------
        case 'biggest_expense': {
          // Single transaction with the highest amount (excluding refunds)
          const posWhere = whereClause([
            ...buildWhereFragments(filters),
            't.amount > 0',
          ]);
          const rows = await db.execute(sql.raw(`
            SELECT
              id,
              date,
              merchant,
              merchant_normalized,
              category,
              amount::FLOAT AS amount,
              currency,
              memo
            FROM transactions t
            ${posWhere}
            ORDER BY amount DESC
            LIMIT 1
          `));
          return {
            operation,
            result: rows.rows[0] ?? null,
            found: rows.rows.length > 0,
          };
        }

        // ----------------------------------------------------------------
        case 'monthly_breakdown': {
          const rows = await db.execute(sql.raw(`
            SELECT
              EXTRACT(YEAR  FROM date::DATE)::INT AS year,
              EXTRACT(MONTH FROM date::DATE)::INT AS month,
              TO_CHAR(date::DATE, 'Month YYYY')   AS month_label,
              SUM(amount)::FLOAT                  AS total,
              COUNT(*)::INT                       AS transaction_count
            FROM transactions t
            ${where}
            GROUP BY year, month, month_label
            ORDER BY year, month
          `));
          return { operation, results: rows.rows, count: rows.rows.length };
        }

        // ----------------------------------------------------------------
        case 'spending_comparison': {
          if (!compareCategories || compareCategories.length === 0) {
            return { error: 'compareCategories must be provided for spending_comparison' };
          }
          const compWhere = whereClause([
            ...buildWhereFragments(
              filters ? { ...filters, category: undefined } : undefined
            ),
            `LOWER(t.category) = ANY(ARRAY[${compareCategories.map((c) => `LOWER('${c.replace(/'/g, "''")}')`).join(', ')}])`,
          ]);
          const rows = await db.execute(sql.raw(`
            SELECT
              category,
              SUM(amount)::FLOAT  AS total,
              COUNT(*)::INT       AS transaction_count,
              AVG(amount)::FLOAT  AS avg_transaction
            FROM transactions t
            ${compWhere}
            GROUP BY category
            ORDER BY SUM(amount) DESC
          `));
          return {
            operation,
            comparedCategories: compareCategories,
            results: rows.rows,
          };
        }

        // ----------------------------------------------------------------
        case 'merchant_history': {
          if (!filters?.merchant) {
            return { error: 'filters.merchant is required for merchant_history' };
          }
          const rows = await db.execute(sql.raw(`
            SELECT
              id,
              date,
              merchant,
              merchant_normalized,
              category,
              amount::FLOAT AS amount,
              currency,
              memo
            FROM transactions t
            ${where}
            ORDER BY date DESC
            LIMIT ${limit}
          `));
          return { operation, results: rows.rows, count: rows.rows.length };
        }

        // ----------------------------------------------------------------
        case 'category_list': {
          const rows = await db.execute(sql.raw(`
            SELECT DISTINCT category
            FROM transactions
            ORDER BY category
          `));
          return {
            operation,
            categories: rows.rows.map((r: Record<string, unknown>) => r.category),
          };
        }

        // ----------------------------------------------------------------
        case 'transaction_list': {
          const rows = await db.execute(sql.raw(`
            SELECT
              id,
              date,
              merchant,
              merchant_normalized,
              category,
              amount::FLOAT AS amount,
              currency,
              memo
            FROM transactions t
            ${where}
            ORDER BY date DESC, amount DESC
            LIMIT ${limit}
          `));
          return { operation, results: rows.rows, count: rows.rows.length };
        }

        default:
          return { error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Database query failed: ${message}` };
    }
  },
});

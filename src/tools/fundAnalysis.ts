import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const FundAnalysisInput = z.object({
  operation: z
    .enum([
      'fund_return',     // Period return for one or all funds
      'fund_ranking',    // Rank all funds by return
      'nav_history',     // NAV series for a specific fund
      'period_return',   // Return between two explicit dates
      'best_fund',       // Best performing fund
      'worst_fund',      // Worst performing fund
      'fund_list',       // All funds with latest NAV
    ])
    .describe('Analysis type'),
  fundId: z.string().optional().describe('Fund ID (e.g. fund_001)'),
  fundName: z.string().optional().describe('Fund name or partial name for lookup'),
  category: z.string().optional().describe('Filter by fund category: Equity, Debt, Hybrid'),
  startDate: z.string().optional().describe('Period start date (YYYY-MM-DD)'),
  endDate: z.string().optional().describe('Period end date (YYYY-MM-DD)'),
});

// ---------------------------------------------------------------------------
// Helper – resolve a fund_id from fundId or fundName
// ---------------------------------------------------------------------------

async function resolveFundId(
  fundId?: string,
  fundName?: string
): Promise<string | null> {
  if (fundId) return fundId;
  if (!fundName) return null;
  const safe = fundName.replace(/'/g, "''");
  const rows = await db.execute(sql.raw(`
    SELECT id FROM funds
    WHERE LOWER(name) LIKE LOWER('%${safe}%')
    LIMIT 1
  `));
  const row = rows.rows[0] as Record<string, unknown> | undefined;
  return row ? String(row.id) : null;
}

// ---------------------------------------------------------------------------
// Core formula (computed in SQL, not TypeScript)
// period_return = ((end_nav - start_nav) / start_nav) * 100
// ---------------------------------------------------------------------------

/**
 * SQL fragment that computes returns for every fund from its earliest
 * to its latest available NAV date (or between two specified dates).
 */
function fundReturnQuery(
  category?: string,
  filterFundId?: string,
  startDate?: string,
  endDate?: string
): string {
  const categoryFilter = category
    ? `AND LOWER(f.category) = LOWER('${category.replace(/'/g, "''")}')`
    : '';
  const fundFilter = filterFundId
    ? `AND f.id = '${filterFundId.replace(/'/g, "''")}'`
    : '';

  const startDateFilter = startDate ? `AND first_nav.nav_date >= '${startDate}'` : '';
  const endDateFilter   = endDate   ? `AND last_nav.nav_date  <= '${endDate}'`   : '';

  return `
    SELECT
      f.id                                   AS fund_id,
      f.name                                 AS fund_name,
      f.category,
      first_nav.nav_date                     AS start_date,
      first_nav.nav::FLOAT                   AS start_nav,
      last_nav.nav_date                      AS end_date,
      last_nav.nav::FLOAT                    AS end_nav,
      ROUND(
        ((last_nav.nav - first_nav.nav) / first_nav.nav) * 100
      , 2)::FLOAT                            AS return_percent
    FROM funds f
    JOIN LATERAL (
      SELECT nav_date, nav
      FROM fund_nav_history
      WHERE fund_id = f.id
        ${startDateFilter}
      ORDER BY nav_date ASC
      LIMIT 1
    ) first_nav ON TRUE
    JOIN LATERAL (
      SELECT nav_date, nav
      FROM fund_nav_history
      WHERE fund_id = f.id
        ${endDateFilter}
      ORDER BY nav_date DESC
      LIMIT 1
    ) last_nav ON TRUE
    WHERE 1=1
      ${categoryFilter}
      ${fundFilter}
  `;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const fundAnalysis = createTool({
  id: 'fundAnalysis',
  description: `Analyze mutual fund performance.
Use this tool for any question about fund returns, NAV history, fund rankings,
best/worst performing funds, or period returns between two dates.

Period Return formula (computed in SQL):
  return% = ((end_nav - start_nav) / start_nav) * 100

Operations:
- fund_return:   Return for one fund (or all) from first to last NAV
- fund_ranking:  All funds ranked by return (best to worst)
- nav_history:   Full NAV time series for a fund
- period_return: Return for a fund between startDate and endDate
- best_fund:     Fund with the highest return
- worst_fund:    Fund with the lowest return
- fund_list:     All funds with their latest NAV`,

  inputSchema: FundAnalysisInput,

  execute: async ({ context }) => {
    const { operation, fundId, fundName, category, startDate, endDate } = context;

    try {
      switch (operation) {
        // ----------------------------------------------------------------
        case 'fund_return': {
          const resolvedId = await resolveFundId(fundId, fundName);
          const query = fundReturnQuery(category, resolvedId ?? undefined, startDate, endDate);
          const rows = await db.execute(sql.raw(`${query} ORDER BY return_percent DESC`));
          return {
            operation,
            results: rows.rows,
            count: rows.rows.length,
            note: 'return_percent = ((end_nav - start_nav) / start_nav) * 100',
          };
        }

        // ----------------------------------------------------------------
        case 'fund_ranking': {
          const query = fundReturnQuery(category, undefined, startDate, endDate);
          const rows = await db.execute(sql.raw(`${query} ORDER BY return_percent DESC`));
          return {
            operation,
            results: rows.rows,
            count: rows.rows.length,
            ranked_by: 'return_percent descending',
          };
        }

        // ----------------------------------------------------------------
        case 'nav_history': {
          const resolvedId = await resolveFundId(fundId, fundName);
          if (!resolvedId) {
            return { error: 'Could not resolve fund. Provide fundId or fundName.' };
          }
          const dateFilter = [
            startDate ? `AND nav_date >= '${startDate}'` : '',
            endDate   ? `AND nav_date <= '${endDate}'`   : '',
          ].join(' ');
          const rows = await db.execute(sql.raw(`
            SELECT
              n.nav_date,
              n.nav::FLOAT AS nav,
              f.name        AS fund_name,
              f.category
            FROM fund_nav_history n
            JOIN funds f ON f.id = n.fund_id
            WHERE n.fund_id = '${resolvedId}'
              ${dateFilter}
            ORDER BY n.nav_date ASC
          `));
          return { operation, fund_id: resolvedId, results: rows.rows };
        }

        // ----------------------------------------------------------------
        case 'period_return': {
          const resolvedId = await resolveFundId(fundId, fundName);
          if (!resolvedId) {
            return { error: 'Could not resolve fund. Provide fundId or fundName.' };
          }
          if (!startDate || !endDate) {
            return { error: 'startDate and endDate are required for period_return' };
          }
          const query = fundReturnQuery(undefined, resolvedId, startDate, endDate);
          const rows = await db.execute(sql.raw(query));
          return { operation, result: rows.rows[0] ?? null };
        }

        // ----------------------------------------------------------------
        case 'best_fund': {
          const query = fundReturnQuery(category, undefined, startDate, endDate);
          const rows = await db.execute(sql.raw(`${query} ORDER BY return_percent DESC LIMIT 1`));
          return { operation, result: rows.rows[0] ?? null };
        }

        // ----------------------------------------------------------------
        case 'worst_fund': {
          const query = fundReturnQuery(category, undefined, startDate, endDate);
          const rows = await db.execute(sql.raw(`${query} ORDER BY return_percent ASC LIMIT 1`));
          return { operation, result: rows.rows[0] ?? null };
        }

        // ----------------------------------------------------------------
        case 'fund_list': {
          const catFilter = category
            ? `AND LOWER(f.category) = LOWER('${category.replace(/'/g, "''")}')`
            : '';
          const rows = await db.execute(sql.raw(`
            SELECT
              f.id,
              f.name,
              f.category,
              latest.nav::FLOAT   AS latest_nav,
              latest.nav_date     AS latest_nav_date
            FROM funds f
            JOIN LATERAL (
              SELECT nav, nav_date
              FROM fund_nav_history
              WHERE fund_id = f.id
              ORDER BY nav_date DESC
              LIMIT 1
            ) latest ON TRUE
            WHERE 1=1 ${catFilter}
            ORDER BY f.name
          `));
          return { operation, results: rows.rows, count: rows.rows.length };
        }

        default:
          return { error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Fund analysis failed: ${message}` };
    }
  },
});

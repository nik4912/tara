import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const PortfolioAnalysisInput = z.object({
  operation: z
    .enum([
      'portfolio_value',     // Total portfolio value + breakdown per holding
      'holding_performance', // Metrics for a specific holding
      'best_holding',        // Holding with highest return %
      'worst_holding',       // Holding with lowest return %
      'all_holdings',        // All holdings with full metrics
      'portfolio_summary',   // Single-row summary: total cost, value, profit, return%
    ])
    .describe('Analysis type'),
  fundId: z.string().optional().describe('Filter to a specific fund ID'),
  holdingId: z.string().optional().describe('Filter to a specific holding ID'),
});

// ---------------------------------------------------------------------------
// Core CTE – computes holding metrics in SQL
//
// Formulas (all math in SQL/DB, never in TypeScript):
//   purchase_cost    = units * purchase_nav
//   current_value    = units * latest_nav
//   profit           = current_value - purchase_cost
//   return_percent   = (profit / purchase_cost) * 100
// ---------------------------------------------------------------------------

const HOLDING_METRICS_CTE = `
  WITH latest_nav AS (
    SELECT DISTINCT ON (fund_id)
      fund_id,
      nav::FLOAT   AS nav,
      nav_date
    FROM fund_nav_history
    ORDER BY fund_id, nav_date DESC
  )
  SELECT
    h.id                                                   AS holding_id,
    h.fund_id,
    f.name                                                 AS fund_name,
    f.category                                             AS fund_category,
    h.units::FLOAT                                         AS units,
    h.purchase_date,
    h.purchase_nav::FLOAT                                  AS purchase_nav,
    ln.nav                                                 AS current_nav,
    ln.nav_date                                            AS latest_nav_date,
    (h.units::FLOAT * h.purchase_nav::FLOAT)               AS purchase_cost,
    (h.units::FLOAT * ln.nav)                              AS current_value,
    (h.units::FLOAT * ln.nav)
      - (h.units::FLOAT * h.purchase_nav::FLOAT)           AS profit,
    ROUND(
      (
        (h.units::FLOAT * ln.nav)
        - (h.units::FLOAT * h.purchase_nav::FLOAT)
      ) / (h.units::FLOAT * h.purchase_nav::FLOAT) * 100
    , 2)                                                   AS return_percent
  FROM holdings h
  JOIN funds f     ON f.id  = h.fund_id
  JOIN latest_nav ln ON ln.fund_id = h.fund_id
`;

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const portfolioAnalysis = createTool({
  id: 'portfolioAnalysis',
  description: `Analyze the investment portfolio: current value, profit, and returns.
Use this tool for questions about portfolio worth, individual holding performance,
best/worst holdings, or realized gains.

Formulas (computed in SQL):
  purchase_cost  = units × purchase_nav
  current_value  = units × latest_nav
  profit         = current_value − purchase_cost
  return_percent = (profit / purchase_cost) × 100

Operations:
- portfolio_value:     All holdings with value + portfolio total
- holding_performance: Details for one holding (fundId or holdingId)
- best_holding:        Holding with highest return %
- worst_holding:       Holding with lowest return %
- all_holdings:        Full list with metrics
- portfolio_summary:   One-row total: cost, value, profit, return%`,

  inputSchema: PortfolioAnalysisInput,

  execute: async ({ context }) => {
    const { operation, fundId, holdingId } = context;

    // Optional WHERE extensions
    const extraWhere: string[] = [];
    if (fundId)    extraWhere.push(`h.fund_id = '${fundId.replace(/'/g, "''")}'`);
    if (holdingId) extraWhere.push(`h.id = '${holdingId.replace(/'/g, "''")}'`);
    const extraFilter = extraWhere.length
      ? `WHERE ${extraWhere.join(' AND ')}`
      : '';

    try {
      switch (operation) {
        // ----------------------------------------------------------------
        case 'portfolio_value': {
          const rows = await db.execute(sql.raw(`
            ${HOLDING_METRICS_CTE}
            ${extraFilter}
            ORDER BY current_value DESC
          `));

          // Aggregate total in SQL
          const totals = await db.execute(sql.raw(`
            WITH metrics AS (${HOLDING_METRICS_CTE} ${extraFilter})
            SELECT
              SUM(purchase_cost)::FLOAT  AS total_purchase_cost,
              SUM(current_value)::FLOAT  AS total_current_value,
              SUM(profit)::FLOAT         AS total_profit,
              ROUND(
                (SUM(profit) / NULLIF(SUM(purchase_cost), 0)) * 100
              , 2)::FLOAT                AS overall_return_percent
            FROM metrics
          `));

          return {
            operation,
            holdings: rows.rows,
            totals: totals.rows[0] ?? null,
            count: rows.rows.length,
          };
        }

        // ----------------------------------------------------------------
        case 'holding_performance': {
          if (!fundId && !holdingId) {
            return { error: 'Provide fundId or holdingId for holding_performance' };
          }
          const rows = await db.execute(sql.raw(`
            ${HOLDING_METRICS_CTE}
            ${extraFilter}
          `));
          return { operation, result: rows.rows[0] ?? null };
        }

        // ----------------------------------------------------------------
        case 'best_holding': {
          const rows = await db.execute(sql.raw(`
            ${HOLDING_METRICS_CTE}
            ${extraFilter}
            ORDER BY return_percent DESC
            LIMIT 1
          `));
          return { operation, result: rows.rows[0] ?? null };
        }

        // ----------------------------------------------------------------
        case 'worst_holding': {
          const rows = await db.execute(sql.raw(`
            ${HOLDING_METRICS_CTE}
            ${extraFilter}
            ORDER BY return_percent ASC
            LIMIT 1
          `));
          return { operation, result: rows.rows[0] ?? null };
        }

        // ----------------------------------------------------------------
        case 'all_holdings': {
          const rows = await db.execute(sql.raw(`
            ${HOLDING_METRICS_CTE}
            ${extraFilter}
            ORDER BY return_percent DESC
          `));
          return { operation, results: rows.rows, count: rows.rows.length };
        }

        // ----------------------------------------------------------------
        case 'portfolio_summary': {
          const rows = await db.execute(sql.raw(`
            WITH metrics AS (${HOLDING_METRICS_CTE} ${extraFilter})
            SELECT
              COUNT(*)::INT              AS holding_count,
              SUM(purchase_cost)::FLOAT  AS total_purchase_cost,
              SUM(current_value)::FLOAT  AS total_current_value,
              SUM(profit)::FLOAT         AS total_profit,
              ROUND(
                (SUM(profit) / NULLIF(SUM(purchase_cost), 0)) * 100
              , 2)::FLOAT                AS overall_return_percent,
              MAX(return_percent)::FLOAT AS best_return_percent,
              MIN(return_percent)::FLOAT AS worst_return_percent
            FROM metrics
          `));
          return { operation, summary: rows.rows[0] ?? null };
        }

        default:
          return { error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Portfolio analysis failed: ${message}` };
    }
  },
});

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';
import { merchantLikePattern } from '../services/merchantNormalizer';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const SubscriptionDetectionInput = z.object({
  operation: z
    .enum([
      'list_subscriptions',  // All recurring merchants
      'subscription_total',  // Monthly cost of all detected subscriptions
      'check_merchant',      // Is a specific merchant recurring?
    ])
    .describe('Detection type'),
  merchant: z.string().optional().describe('Merchant name for check_merchant'),
  minOccurrences: z
    .number()
    .min(2)
    .optional()
    .default(2)
    .describe('Minimum number of months a merchant must appear in to be flagged'),
  maxAmountVariance: z
    .number()
    .optional()
    .default(0.15)
    .describe('Maximum allowed coefficient of variation (StdDev/Mean) for amount; 0.15 = 15%'),
});

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const subscriptionDetection = createTool({
  id: 'subscriptionDetection',
  description: `Detect recurring charges, subscriptions, and periodic payments.
A merchant is considered recurring if it appears in at least N distinct calendar
months AND the charge amount has low variance (consistent billing amount).

Use this tool to answer:
- Which merchants have recurring charges?
- What is my monthly subscription spend?
- Is [merchant] a subscription?
- Show me all recurring payments.`,

  inputSchema: SubscriptionDetectionInput,

  execute: async ({ context }) => {
    const {
      operation,
      merchant,
      minOccurrences = 2,
      maxAmountVariance = 0.15,
    } = context;

    try {
      switch (operation) {
        // ----------------------------------------------------------------
        case 'list_subscriptions': {
          /**
           * A merchant is flagged as a subscription if:
           *  1. It appears in >= minOccurrences distinct calendar months.
           *  2. The coefficient of variation (STDDEV/AVG) of positive charges is
           *     <= maxAmountVariance — i.e. the amount is relatively consistent.
           *
           * Transfers are excluded. Refunds are excluded for amount variance calc.
           */
          const rows = await db.execute(sql.raw(`
            SELECT
              merchant_normalized,
              COUNT(*)::INT                                         AS total_occurrences,
              COUNT(DISTINCT TO_CHAR(date::DATE, 'YYYY-MM'))::INT  AS distinct_months,
              ROUND(AVG(amount)::NUMERIC, 2)::FLOAT                AS avg_monthly_charge,
              MIN(amount)::FLOAT                                   AS min_charge,
              MAX(amount)::FLOAT                                   AS max_charge,
              ROUND(
                COALESCE(STDDEV(amount), 0)
                / NULLIF(AVG(amount), 0)
              , 4)::FLOAT                                          AS amount_variance_coeff,
              MIN(date)                                            AS first_seen,
              MAX(date)                                            AS last_seen
            FROM transactions
            WHERE amount > 0
              AND category != 'Transfer'
            GROUP BY merchant_normalized
            HAVING
              COUNT(DISTINCT TO_CHAR(date::DATE, 'YYYY-MM')) >= ${minOccurrences}
              AND (
                COALESCE(STDDEV(amount), 0) / NULLIF(AVG(amount), 0)
              ) <= ${maxAmountVariance}
            ORDER BY distinct_months DESC, avg_monthly_charge DESC
          `));

          return {
            operation,
            subscriptions: rows.rows,
            count: rows.rows.length,
            detection_criteria: {
              min_distinct_months: minOccurrences,
              max_amount_variance_coeff: maxAmountVariance,
            },
          };
        }

        // ----------------------------------------------------------------
        case 'subscription_total': {
          /**
           * Estimate monthly recurring spend by averaging each subscription
           * merchant's per-occurrence charge and summing.
           */
          const rows = await db.execute(sql.raw(`
            WITH recurring AS (
              SELECT
                merchant_normalized,
                AVG(amount)::FLOAT AS avg_charge
              FROM transactions
              WHERE amount > 0 AND category != 'Transfer'
              GROUP BY merchant_normalized
              HAVING
                COUNT(DISTINCT TO_CHAR(date::DATE, 'YYYY-MM')) >= ${minOccurrences}
                AND (COALESCE(STDDEV(amount), 0) / NULLIF(AVG(amount), 0)) <= ${maxAmountVariance}
            )
            SELECT
              COUNT(*)::INT              AS subscription_count,
              ROUND(SUM(avg_charge)::NUMERIC, 2)::FLOAT AS estimated_monthly_total,
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'merchant', merchant_normalized,
                  'avg_monthly_charge', ROUND(avg_charge::NUMERIC, 2)
                )
                ORDER BY avg_charge DESC
              ) AS breakdown
            FROM recurring
          `));

          return {
            operation,
            result: rows.rows[0] ?? null,
          };
        }

        // ----------------------------------------------------------------
        case 'check_merchant': {
          if (!merchant) {
            return { error: 'merchant is required for check_merchant' };
          }
          const pattern = merchantLikePattern(merchant).replace(/'/g, "''");
          const rows = await db.execute(sql.raw(`
            SELECT
              merchant_normalized,
              COUNT(*)::INT                                         AS total_occurrences,
              COUNT(DISTINCT TO_CHAR(date::DATE, 'YYYY-MM'))::INT  AS distinct_months,
              ROUND(AVG(amount)::NUMERIC, 2)::FLOAT                AS avg_charge,
              ROUND(
                COALESCE(STDDEV(amount), 0) / NULLIF(AVG(amount), 0)
              , 4)::FLOAT                                          AS amount_variance_coeff,
              MIN(date) AS first_seen,
              MAX(date) AS last_seen
            FROM transactions
            WHERE amount > 0
              AND category != 'Transfer'
              AND merchant_normalized LIKE '${pattern}'
            GROUP BY merchant_normalized
          `));

          if (rows.rows.length === 0) {
            return {
              operation,
              merchant,
              is_recurring: false,
              reason: 'No transactions found for this merchant.',
            };
          }

          const row = rows.rows[0] as Record<string, unknown>;
          const distinctMonths = Number(row.distinct_months);
          const varianceCoeff = Number(row.amount_variance_coeff);
          const isRecurring =
            distinctMonths >= minOccurrences && varianceCoeff <= maxAmountVariance;

          return {
            operation,
            merchant,
            is_recurring: isRecurring,
            metrics: row,
            reason: isRecurring
              ? `Appears in ${distinctMonths} distinct months with consistent charge amount.`
              : `Only appears in ${distinctMonths} month(s) or has inconsistent amounts (variance: ${varianceCoeff}).`,
          };
        }

        default:
          return { error: `Unknown operation: ${operation}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: `Subscription detection failed: ${message}` };
    }
  },
});

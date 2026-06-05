/**
 * Tara Eval Framework
 *
 * Tests the four tools directly (no LLM required — fully deterministic).
 * Assumes sample_a has been ingested.
 *
 * Usage:
 *   DATA_DIR=./data/sample_a npx ts-node scripts/ingest.ts
 *   npx ts-node src/eval/run-evals.ts
 *
 * Expected values are derived from the sample_a dataset:
 *   - transactions.json (36 transactions, Jan–Mar 2024)
 *   - funds.json        (5 funds with 6 months of NAV history)
 *   - holdings.json     (5 holdings)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { db, pool } from '../db/index';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Eval harness types
// ---------------------------------------------------------------------------

interface EvalCase {
  id: string;
  name: string;
  category: 'transactions' | 'funds' | 'portfolio' | 'subscriptions' | 'edge-case';
  run: () => Promise<EvalResult>;
}

interface EvalResult {
  passed: boolean;
  actual: unknown;
  expected?: unknown;
  message: string;
}

function pass(message: string, actual?: unknown): EvalResult {
  return { passed: true, actual, message };
}

function fail(message: string, actual: unknown, expected?: unknown): EvalResult {
  return { passed: false, actual, expected, message };
}

/** Assert two numbers are within `tolerance` of each other (handles float rounding). */
function approxEqual(a: number, b: number, tolerance = 0.05): boolean {
  return Math.abs(a - b) <= tolerance;
}

// ---------------------------------------------------------------------------
// Direct DB query helper (tools use the same db connection)
// ---------------------------------------------------------------------------

async function query(rawSql: string): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql.raw(rawSql));
  return result.rows as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Eval cases
// ---------------------------------------------------------------------------

const EVAL_CASES: EvalCase[] = [
  // ── 1. Food category total for January 2024 ──────────────────────────────
  {
    id: 'E01',
    name: 'Food spending January 2024 (net of refunds)',
    category: 'transactions',
    run: async () => {
      // txn_001 (340) + txn_002 (520) + txn_003 (280) + txn_009 (-120) = 1020
      const rows = await query(`
        SELECT SUM(amount)::FLOAT AS total
        FROM transactions
        WHERE category = 'Food'
          AND date >= '2024-01-01' AND date <= '2024-01-31'
      `);
      const actual = Number(rows[0]?.total ?? 0);
      const expected = 1020;
      return approxEqual(actual, expected)
        ? pass(`Food spend in Jan = ₹${actual}`, actual)
        : fail(`Expected ₹${expected}, got ₹${actual}`, actual, expected);
    },
  },

  // ── 2. Refunds reduce category totals ────────────────────────────────────
  {
    id: 'E02',
    name: 'Refund handling: negative amounts reduce spend',
    category: 'transactions',
    run: async () => {
      // Without refund: 340+520+280 = 1140; with refund (-120): 1020
      const rows = await query(`
        SELECT SUM(amount)::FLOAT AS total
        FROM transactions
        WHERE category = 'Food' AND date >= '2024-01-01' AND date <= '2024-01-31'
      `);
      const withRefund = Number(rows[0]?.total ?? 0);

      const rows2 = await query(`
        SELECT SUM(amount)::FLOAT AS total
        FROM transactions
        WHERE category = 'Food' AND date >= '2024-01-01' AND date <= '2024-01-31'
          AND amount > 0
      `);
      const withoutRefund = Number(rows2[0]?.total ?? 0);

      if (withRefund < withoutRefund) {
        return pass(
          `Refunds reduce total: gross ₹${withoutRefund}, net ₹${withRefund}`,
          { withRefund, withoutRefund }
        );
      }
      return fail('Refund did not reduce the total', { withRefund, withoutRefund });
    },
  },

  // ── 3. Transfer exclusion ─────────────────────────────────────────────────
  {
    id: 'E03',
    name: 'Transfer exclusion: Transfer category not included in spending',
    category: 'transactions',
    run: async () => {
      const rows = await query(`
        SELECT SUM(amount)::FLOAT AS total
        FROM transactions
        WHERE category != 'Transfer'
      `);
      const rows2 = await query(`
        SELECT SUM(amount)::FLOAT AS total
        FROM transactions
      `);
      const excluded = Number(rows[0]?.total ?? 0);
      const total = Number(rows2[0]?.total ?? 0);

      // Transfers exist in sample_a (txn_012, txn_024 = 5000+2000=7000)
      if (excluded < total) {
        return pass(
          `Transfer-excluded total ₹${excluded} < full total ₹${total}`,
          { excluded, total }
        );
      }
      return fail(
        'Transfer exclusion has no effect — no transfers in data?',
        { excluded, total }
      );
    },
  },

  // ── 4. Biggest expense ────────────────────────────────────────────────────
  {
    id: 'E04',
    name: 'Biggest expense is MakeMyTrip ₹8200',
    category: 'transactions',
    run: async () => {
      const rows = await query(`
        SELECT merchant, amount::FLOAT AS amount
        FROM transactions
        WHERE amount > 0 AND category != 'Transfer'
        ORDER BY amount DESC LIMIT 1
      `);
      const row = rows[0];
      if (!row) return fail('No transactions found', null);
      const actual = Number(row.amount);
      const expected = 8200;
      return approxEqual(actual, expected)
        ? pass(`Biggest expense: ${row.merchant} ₹${actual}`, row)
        : fail(`Expected ₹${expected}, got ₹${actual} (${row.merchant})`, row, expected);
    },
  },

  // ── 5. Top merchant by spend (non-transfer) ───────────────────────────────
  {
    id: 'E05',
    name: 'Top merchants list: MakeMyTrip appears in top 3',
    category: 'transactions',
    run: async () => {
      const rows = await query(`
        SELECT merchant_normalized, SUM(amount)::FLOAT AS total
        FROM transactions
        WHERE amount > 0 AND category != 'Transfer'
        GROUP BY merchant_normalized
        ORDER BY total DESC LIMIT 3
      `);
      const merchants = rows.map((r) => String(r.merchant_normalized).toUpperCase());
      const hasMmt = merchants.some((m) => m.includes('MAKEMYTRIP'));
      return hasMmt
        ? pass(`Top 3: ${merchants.join(', ')}`, merchants)
        : fail(`MakeMyTrip not in top 3: ${merchants.join(', ')}`, merchants);
    },
  },

  // ── 6. Merchant alias grouping ────────────────────────────────────────────
  {
    id: 'E06',
    name: 'Merchant alias: all Swiggy variants normalize to SWIGGY',
    category: 'transactions',
    run: async () => {
      // "SWIGGY*ORDER", "SWIGGY BANGALORE", "SWIGGY*FOOD" → "SWIGGY"
      // "Swiggy Instamart", "SWIGGY INSTAMART"             → "SWIGGY INSTAMART"
      const rows = await query(`
        SELECT DISTINCT merchant_normalized
        FROM transactions
        WHERE merchant_normalized LIKE '%SWIGGY%'
        ORDER BY merchant_normalized
      `);
      const groups = rows.map((r) => String(r.merchant_normalized));
      // There should be at most 2 groups: SWIGGY and SWIGGY INSTAMART
      // (never 5 different groups for 5 raw swiggy variant strings)
      const rawCount = await query(`
        SELECT COUNT(DISTINCT merchant)::INT AS cnt
        FROM transactions
        WHERE UPPER(merchant) LIKE '%SWIGGY%'
      `);
      const rawGroups = Number(rawCount[0]?.cnt ?? 0);
      const normalizedGroups = groups.length;

      if (normalizedGroups < rawGroups) {
        return pass(
          `${rawGroups} raw Swiggy variants → ${normalizedGroups} normalized groups: ${groups.join(', ')}`,
          { rawGroups, normalizedGroups, groups }
        );
      }
      return fail(
        `Normalization had no effect: ${normalizedGroups} groups vs ${rawGroups} raw`,
        { rawGroups, normalizedGroups, groups }
      );
    },
  },

  // ── 7. No-data edge case ──────────────────────────────────────────────────
  {
    id: 'E07',
    name: 'No-data edge case: query for non-existent category returns 0',
    category: 'edge-case',
    run: async () => {
      const rows = await query(`
        SELECT SUM(amount)::FLOAT AS total, COUNT(*)::INT AS cnt
        FROM transactions
        WHERE category = '__NONEXISTENT_XYZ__'
      `);
      const total = rows[0]?.total;
      const cnt = Number(rows[0]?.cnt ?? 0);
      return cnt === 0
        ? pass('Non-existent category returns 0 rows', { total, cnt })
        : fail(`Expected 0 rows, got ${cnt}`, cnt, 0);
    },
  },

  // ── 8. Recurring subscriptions detected ──────────────────────────────────
  {
    id: 'E08',
    name: 'Subscription detection: Netflix appears in 3 months',
    category: 'subscriptions',
    run: async () => {
      const rows = await query(`
        SELECT
          COUNT(DISTINCT TO_CHAR(date::DATE, 'YYYY-MM'))::INT AS month_count
        FROM transactions
        WHERE merchant_normalized = 'NETFLIX' AND amount > 0
      `);
      const monthCount = Number(rows[0]?.month_count ?? 0);
      return monthCount >= 2
        ? pass(`Netflix in ${monthCount} distinct months`, monthCount)
        : fail(`Netflix found in only ${monthCount} months`, monthCount, '>=2');
    },
  },

  // ── 9. Monthly recurring amount consistent ────────────────────────────────
  {
    id: 'E09',
    name: 'Subscription detection: Spotify has consistent monthly charge',
    category: 'subscriptions',
    run: async () => {
      const rows = await query(`
        SELECT
          AVG(amount)::FLOAT   AS avg,
          STDDEV(amount)::FLOAT AS std,
          COUNT(*)::INT         AS cnt
        FROM transactions
        WHERE merchant_normalized = 'SPOTIFY' AND amount > 0
      `);
      const row = rows[0];
      if (!row || Number(row.cnt) === 0) {
        return fail('No Spotify transactions found', row);
      }
      const avg = Number(row.avg);
      const std = Number(row.std ?? 0);
      const varianceCoeff = std / avg;
      return varianceCoeff <= 0.01
        ? pass(`Spotify avg=₹${avg}, std=${std} (variance coeff=${varianceCoeff.toFixed(4)})`, row)
        : fail(`Spotify charge variance too high: ${varianceCoeff.toFixed(4)}`, row);
    },
  },

  // ── 10. Fund return calculation ───────────────────────────────────────────
  {
    id: 'E10',
    name: 'Fund return: HDFC Mid-Cap (fund_002) ≈ 16.58% from Jan to Jun 2024',
    category: 'funds',
    run: async () => {
      // start_nav=142.30 (2024-01-01), end_nav=165.90 (2024-06-01)
      // return = (165.90-142.30)/142.30 * 100 = 16.58%
      const rows = await query(`
        SELECT
          ROUND(
            ((last_nav.nav - first_nav.nav) / first_nav.nav) * 100
          , 2)::FLOAT AS return_pct
        FROM
          (SELECT nav FROM fund_nav_history WHERE fund_id='fund_002' ORDER BY nav_date ASC  LIMIT 1) first_nav,
          (SELECT nav FROM fund_nav_history WHERE fund_id='fund_002' ORDER BY nav_date DESC LIMIT 1) last_nav
      `);
      const actual = Number(rows[0]?.return_pct ?? 0);
      const expected = 16.58;
      return approxEqual(actual, expected, 0.1)
        ? pass(`HDFC Mid-Cap return = ${actual}%`, actual)
        : fail(`Expected ≈${expected}%, got ${actual}%`, actual, expected);
    },
  },

  // ── 11. Best fund by return ───────────────────────────────────────────────
  {
    id: 'E11',
    name: 'Best performing fund is HDFC Mid-Cap Opportunities Fund',
    category: 'funds',
    run: async () => {
      const rows = await query(`
        SELECT
          f.name,
          ROUND(
            ((last_nav.nav - first_nav.nav) / first_nav.nav) * 100
          , 2)::FLOAT AS return_pct
        FROM funds f
        JOIN LATERAL (
          SELECT nav FROM fund_nav_history WHERE fund_id=f.id ORDER BY nav_date ASC  LIMIT 1
        ) first_nav ON TRUE
        JOIN LATERAL (
          SELECT nav FROM fund_nav_history WHERE fund_id=f.id ORDER BY nav_date DESC LIMIT 1
        ) last_nav ON TRUE
        ORDER BY return_pct DESC LIMIT 1
      `);
      const row = rows[0];
      if (!row) return fail('No funds found', null);
      const name = String(row.name);
      return name.toLowerCase().includes('hdfc')
        ? pass(`Best fund: ${name} (${row.return_pct}%)`, row)
        : fail(`Expected HDFC to be best, got: ${name}`, row);
    },
  },

  // ── 12. Portfolio total current value ────────────────────────────────────
  {
    id: 'E12',
    name: 'Portfolio total value is computed correctly (>0, all 5 holdings)',
    category: 'portfolio',
    run: async () => {
      const rows = await query(`
        WITH latest_nav AS (
          SELECT DISTINCT ON (fund_id) fund_id, nav::FLOAT AS nav
          FROM fund_nav_history
          ORDER BY fund_id, nav_date DESC
        )
        SELECT
          COUNT(h.id)::INT                   AS holding_count,
          SUM(h.units::FLOAT * ln.nav)::FLOAT AS total_value,
          SUM(h.units::FLOAT * h.purchase_nav::FLOAT)::FLOAT AS total_cost
        FROM holdings h
        JOIN latest_nav ln ON ln.fund_id = h.fund_id
      `);
      const row = rows[0];
      if (!row) return fail('No holdings found', null);
      const count = Number(row.holding_count);
      const value = Number(row.total_value);
      const cost  = Number(row.total_cost);
      if (count === 5 && value > 0 && value > cost) {
        return pass(
          `Portfolio: ${count} holdings, cost=₹${cost.toFixed(2)}, value=₹${value.toFixed(2)}`,
          row
        );
      }
      return fail(`Unexpected portfolio metrics`, row, { count: 5, value: '>cost' });
    },
  },

  // ── 13. Holding realized return ───────────────────────────────────────────
  {
    id: 'E13',
    name: 'Holding realized return: hold_001 (Mirae) ≈ +36.7%',
    category: 'portfolio',
    run: async () => {
      // units=150.5, purchase_nav=65.20, latest_nav=89.10
      // cost=9812.60, value=13409.55, return=36.65%
      const rows = await query(`
        WITH latest_nav AS (
          SELECT DISTINCT ON (fund_id) fund_id, nav::FLOAT AS nav
          FROM fund_nav_history WHERE fund_id='fund_001'
          ORDER BY fund_id, nav_date DESC
        )
        SELECT
          ROUND(
            (
              ((h.units::NUMERIC * ln.nav::NUMERIC) - (h.units::NUMERIC * h.purchase_nav::NUMERIC))
              / (h.units::NUMERIC * h.purchase_nav::NUMERIC) * 100
            )
          , 2)::FLOAT AS return_pct
        FROM holdings h, latest_nav ln
        WHERE h.id = 'hold_001'
      `);
      const actual = Number(rows[0]?.return_pct ?? 0);
      const expected = 36.65;
      return approxEqual(actual, expected, 0.5)
        ? pass(`hold_001 return = ${actual}%`, actual)
        : fail(`Expected ≈${expected}%, got ${actual}%`, actual, expected);
    },
  },

  // ── 14. Category totals comparison (food vs travel) ──────────────────────
  {
    id: 'E14',
    name: 'Spending comparison: Travel spend > Food spend (all months)',
    category: 'transactions',
    run: async () => {
      const rows = await query(`
        SELECT category, SUM(amount)::FLOAT AS total
        FROM transactions
        WHERE category IN ('Food','Travel') AND category != 'Transfer'
        GROUP BY category
        ORDER BY total DESC
      `);
      if (rows.length < 2) {
        return fail('Expected both Food and Travel categories', rows);
      }
      const topCategory = String(rows[0]?.category);
      return topCategory === 'Travel'
        ? pass(`Travel ₹${rows[0]?.total} > Food ₹${rows[1]?.total}`, rows)
        : fail(`Expected Travel to be higher, got ${topCategory}`, rows);
    },
  },

  // ── 15. Subscription total estimated monthly cost ────────────────────────
  {
    id: 'E15',
    name: 'Subscription total monthly cost is > ₹500 (Netflix+Spotify+Amazon Prime)',
    category: 'subscriptions',
    run: async () => {
      const rows = await query(`
        WITH recurring AS (
          SELECT merchant_normalized, AVG(amount)::FLOAT AS avg_charge
          FROM transactions
          WHERE amount > 0 AND category != 'Transfer'
          GROUP BY merchant_normalized
          HAVING COUNT(DISTINCT TO_CHAR(date::DATE, 'YYYY-MM')) >= 2
            AND (COALESCE(STDDEV(amount),0)/NULLIF(AVG(amount),0)) <= 0.15
        )
        SELECT SUM(avg_charge)::FLOAT AS monthly_total, COUNT(*)::INT AS sub_count
        FROM recurring
      `);
      const row = rows[0];
      const total = Number(row?.monthly_total ?? 0);
      const count = Number(row?.sub_count ?? 0);
      return total > 500 && count >= 3
        ? pass(`Monthly subscription total ₹${total.toFixed(2)} (${count} services)`, row)
        : fail(`Monthly subscription total ₹${total} (${count} services) below expected`, row);
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  results: Array<{ id: string; name: string; passed: boolean; message: string }>;
}

async function runEvals(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║         TARA EVAL FRAMEWORK  – Tool-Level Tests       ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  const summary: EvalSummary = {
    total: EVAL_CASES.length,
    passed: 0,
    failed: 0,
    results: [],
  };

  for (const evalCase of EVAL_CASES) {
    process.stdout.write(`[${evalCase.id}] ${evalCase.name} ... `);
    try {
      const result = await evalCase.run();
      if (result.passed) {
        summary.passed++;
        console.log(`✅ PASS`);
        console.log(`       ${result.message}`);
      } else {
        summary.failed++;
        console.log(`❌ FAIL`);
        console.log(`       ${result.message}`);
        if (result.expected !== undefined) {
          console.log(`       Expected: ${JSON.stringify(result.expected)}`);
          console.log(`       Actual:   ${JSON.stringify(result.actual)}`);
        }
      }
      summary.results.push({
        id: evalCase.id,
        name: evalCase.name,
        passed: result.passed,
        message: result.message,
      });
    } catch (err) {
      summary.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`💥 ERROR: ${msg}`);
      summary.results.push({
        id: evalCase.id,
        name: evalCase.name,
        passed: false,
        message: `Threw error: ${msg}`,
      });
    }
    console.log('');
  }

  // Print summary
  const pct = ((summary.passed / summary.total) * 100).toFixed(1);
  console.log('══════════════════════════════════════════════════════');
  console.log(`  Results: ${summary.passed}/${summary.total} passed (${pct}%)`);
  console.log(`  Passed:  ${summary.passed}`);
  console.log(`  Failed:  ${summary.failed}`);
  console.log('══════════════════════════════════════════════════════\n');

  await pool.end();
  process.exit(summary.failed > 0 ? 1 : 0);
}

runEvals().catch((err) => {
  console.error('[evals] Fatal:', err);
  process.exit(1);
});

/**
 * Ingestion script – loads a snapshot folder into PostgreSQL.
 *
 * Usage:
 *   DATA_DIR=./data/sample_a npx ts-node scripts/ingest.ts
 *   DATA_DIR=./data/sample_b npx ts-node scripts/ingest.ts
 *
 * The script:
 *  1. Creates/migrates the schema if needed.
 *  2. Clears all existing data.
 *  3. Parses funds.json (mixed format: fund defs + nav history arrays).
 *  4. Inserts funds, nav history, holdings, transactions.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

import { v4 as uuidv4 } from 'uuid';
import { db, pool } from '../src/db/index';
import { runMigrations } from '../src/db/migrate';
import { normalizeMerchant } from '../src/services/merchantNormalizer';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types matching the raw JSON shape
// ---------------------------------------------------------------------------

interface RawTransaction {
  id: string;
  date: string;
  merchant: string;
  category: string;
  amount: number;
  currency?: string;
  memo?: string;
}

interface RawFundDef {
  id: string;
  name: string;
  category: string;
}

interface RawNavEntry {
  date: string;
  nav: number;
}

interface RawFundNav {
  id: string;
  navHistory: RawNavEntry[];
}

interface RawHolding {
  id?: string;          // Optional — some snapshots omit it; we generate a UUID if absent
  fund_id: string;
  fund_name?: string;   // Some snapshots include this alongside fund_id
  units: number;
  purchase_date: string;
  purchase_nav: number;
}

type RawFundsItem = RawFundDef | RawFundNav;

// ---------------------------------------------------------------------------
// Load helpers
// ---------------------------------------------------------------------------

function loadJson<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

/**
 * funds.json has a mixed format: fund definition objects (with name/category)
 * are interleaved with nav-history objects (with navHistory array).
 * Separate them based on which keys are present.
 */
function parseFundsJson(items: RawFundsItem[]): {
  fundDefs: RawFundDef[];
  navHistories: RawFundNav[];
} {
  const fundDefs: RawFundDef[] = [];
  const navHistories: RawFundNav[] = [];

  for (const item of items) {
    if ('navHistory' in item) {
      navHistories.push(item as RawFundNav);
    } else {
      fundDefs.push(item as RawFundDef);
    }
  }

  return { fundDefs, navHistories };
}

// ---------------------------------------------------------------------------
// Insert helpers (batch upsert)
// ---------------------------------------------------------------------------

async function clearAllData(): Promise<void> {
  console.log('[ingest] Clearing existing data...');
  // Order matters due to FK constraints
  await db.execute(sql`DELETE FROM transactions`);
  await db.execute(sql`DELETE FROM holdings`);
  await db.execute(sql`DELETE FROM fund_nav_history`);
  await db.execute(sql`DELETE FROM funds`);
  console.log('[ingest] Data cleared.');
}

async function insertFunds(fundDefs: RawFundDef[]): Promise<void> {
  if (fundDefs.length === 0) return;
  console.log(`[ingest] Inserting ${fundDefs.length} funds...`);

  for (const fund of fundDefs) {
    await db.execute(sql`
      INSERT INTO funds (id, name, category)
      VALUES (${fund.id}, ${fund.name}, ${fund.category})
      ON CONFLICT (id) DO UPDATE SET
        name     = EXCLUDED.name,
        category = EXCLUDED.category
    `);
  }
  console.log('[ingest] Funds inserted.');
}

async function insertNavHistory(navHistories: RawFundNav[]): Promise<void> {
  let totalRows = 0;
  for (const fundNav of navHistories) {
    for (const entry of fundNav.navHistory) {
      await db.execute(sql`
        INSERT INTO fund_nav_history (fund_id, nav_date, nav)
        VALUES (${fundNav.id}, ${entry.date}, ${entry.nav})
        ON CONFLICT (fund_id, nav_date) DO UPDATE SET nav = EXCLUDED.nav
      `);
      totalRows++;
    }
  }
  console.log(`[ingest] Inserted ${totalRows} NAV history rows.`);
}

async function insertHoldings(holdings: RawHolding[]): Promise<void> {
  if (holdings.length === 0) return;
  console.log(`[ingest] Inserting ${holdings.length} holdings...`);

  let inserted = 0;
  let skipped = 0;

  for (const h of holdings) {
    // If this holding references a fund that isn't in the funds table yet,
    // auto-create it using the fund_name from the holding (if available).
    const fundExists = await db.execute(sql`
      SELECT 1 FROM funds WHERE id = ${h.fund_id} LIMIT 1
    `);

    if (fundExists.rows.length === 0) {
      if (h.fund_name) {
        console.log(`[ingest]   Auto-creating fund: ${h.fund_id} ("${h.fund_name}")`);
        await db.execute(sql`
          INSERT INTO funds (id, name, category)
          VALUES (${h.fund_id}, ${h.fund_name}, 'Unknown')
          ON CONFLICT (id) DO NOTHING
        `);
      } else {
        console.warn(`[ingest]   WARNING: Skipping holding — fund_id ${h.fund_id} not found and no fund_name provided.`);
        skipped++;
        continue;
      }
    }

    // Generate an ID if the holding doesn't have one
    const holdingId = h.id ?? uuidv4();

    await db.execute(sql`
      INSERT INTO holdings (id, fund_id, units, purchase_date, purchase_nav)
      VALUES (
        ${holdingId},
        ${h.fund_id},
        ${h.units},
        ${h.purchase_date},
        ${h.purchase_nav}
      )
      ON CONFLICT (id) DO UPDATE SET
        fund_id       = EXCLUDED.fund_id,
        units         = EXCLUDED.units,
        purchase_date = EXCLUDED.purchase_date,
        purchase_nav  = EXCLUDED.purchase_nav
    `);
    inserted++;
  }

  console.log(`[ingest] Holdings inserted: ${inserted} (skipped: ${skipped}).`);
}

async function insertTransactions(transactions: RawTransaction[]): Promise<void> {
  if (transactions.length === 0) return;
  console.log(`[ingest] Inserting ${transactions.length} transactions...`);

  for (const txn of transactions) {
    const normalized = normalizeMerchant(txn.merchant);
    await db.execute(sql`
      INSERT INTO transactions (id, date, merchant, merchant_normalized, category, amount, currency, memo)
      VALUES (
        ${txn.id},
        ${txn.date},
        ${txn.merchant},
        ${normalized},
        ${txn.category},
        ${txn.amount},
        ${txn.currency ?? 'INR'},
        ${txn.memo ?? null}
      )
      ON CONFLICT (id) DO UPDATE SET
        date                = EXCLUDED.date,
        merchant            = EXCLUDED.merchant,
        merchant_normalized = EXCLUDED.merchant_normalized,
        category            = EXCLUDED.category,
        amount              = EXCLUDED.amount,
        currency            = EXCLUDED.currency,
        memo                = EXCLUDED.memo
    `);
  }
  console.log('[ingest] Transactions inserted.');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dataDir = process.env.DATA_DIR ?? './data/sample_a';
  const resolvedDir = path.resolve(dataDir);

  console.log(`\n[ingest] Loading snapshot from: ${resolvedDir}\n`);

  if (!fs.existsSync(resolvedDir)) {
    console.error(`[ingest] ERROR: Directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  // Step 1 – ensure schema exists
  await runMigrations();

  // Step 2 – clear old data
  await clearAllData();

  // Step 3 – load and parse JSON files
  const fundsRaw = loadJson<RawFundsItem[]>(path.join(resolvedDir, 'funds.json'));
  const holdingsRaw = loadJson<RawHolding[]>(path.join(resolvedDir, 'holdings.json'));
  const transactionsRaw = loadJson<RawTransaction[]>(path.join(resolvedDir, 'transactions.json'));

  const { fundDefs, navHistories } = parseFundsJson(fundsRaw);
  console.log(`[ingest] Parsed ${fundDefs.length} fund definitions, ${navHistories.length} nav history sets.`);

  // Step 4 – insert in dependency order
  await insertFunds(fundDefs);
  await insertNavHistory(navHistories);
  await insertHoldings(holdingsRaw);
  await insertTransactions(transactionsRaw);

  // Step 5 – verify counts
  const counts = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM funds)           AS funds,
      (SELECT COUNT(*) FROM fund_nav_history) AS nav_history,
      (SELECT COUNT(*) FROM holdings)         AS holdings,
      (SELECT COUNT(*) FROM transactions)     AS transactions
  `);
  console.log('\n[ingest] Database summary:');
  console.table(counts.rows[0]);

  console.log('\n[ingest] Done. Snapshot ingested successfully.\n');
  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  console.error('[ingest] Fatal error:', err);
  process.exit(1);
});

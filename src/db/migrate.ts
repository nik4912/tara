import { sql } from 'drizzle-orm';
import { db } from './index';

/**
 * Creates all tables and indexes if they do not already exist.
 * Safe to run on every startup / before ingestion.
 */
export async function runMigrations(): Promise<void> {
  console.log('[migrate] Running schema migrations...');

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS funds (
      id          VARCHAR(50)  PRIMARY KEY,
      name        VARCHAR(255) NOT NULL,
      category    VARCHAR(100) NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fund_nav_history (
      id        SERIAL       PRIMARY KEY,
      fund_id   VARCHAR(50)  NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
      nav_date  DATE         NOT NULL,
      nav       NUMERIC(15,4) NOT NULL,
      UNIQUE (fund_id, nav_date)
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_nav_fund_date
      ON fund_nav_history(fund_id, nav_date);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS holdings (
      id            VARCHAR(50)   PRIMARY KEY,
      fund_id       VARCHAR(50)   NOT NULL REFERENCES funds(id) ON DELETE CASCADE,
      units         NUMERIC(15,4) NOT NULL,
      purchase_date DATE          NOT NULL,
      purchase_nav  NUMERIC(15,4) NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_holdings_fund_id
      ON holdings(fund_id);
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id                  VARCHAR(50)   PRIMARY KEY,
      date                DATE          NOT NULL,
      merchant            VARCHAR(255)  NOT NULL,
      merchant_normalized VARCHAR(255)  NOT NULL,
      category            VARCHAR(100)  NOT NULL,
      amount              NUMERIC(15,2) NOT NULL,
      currency            VARCHAR(10)   NOT NULL DEFAULT 'INR',
      memo                TEXT
    );
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_txn_date          ON transactions(date);
    CREATE INDEX IF NOT EXISTS idx_txn_category      ON transactions(category);
    CREATE INDEX IF NOT EXISTS idx_txn_merchant_norm ON transactions(merchant_normalized);
    CREATE INDEX IF NOT EXISTS idx_txn_amount        ON transactions(amount);
    CREATE INDEX IF NOT EXISTS idx_txn_date_category ON transactions(date, category);
  `);

  console.log('[migrate] Migrations complete.');
}

import {
  pgTable,
  varchar,
  text,
  date,
  numeric,
  serial,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Transactions table stores every financial transaction.
 * merchant_normalized holds the cleaned/canonical merchant name
 * used for grouping (e.g. "SWIGGY*ORDER" -> "SWIGGY").
 */
export const transactions = pgTable(
  'transactions',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    date: date('date').notNull(),
    merchant: varchar('merchant', { length: 255 }).notNull(),
    merchantNormalized: varchar('merchant_normalized', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(),
    /** Negative values are refunds; they reduce spend totals. */
    amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 10 }).notNull().default('INR'),
    memo: text('memo'),
  },
  (table) => ({
    dateIdx: index('idx_txn_date').on(table.date),
    categoryIdx: index('idx_txn_category').on(table.category),
    merchantNormIdx: index('idx_txn_merchant_norm').on(table.merchantNormalized),
    amountIdx: index('idx_txn_amount').on(table.amount),
    dateCategoryIdx: index('idx_txn_date_category').on(table.date, table.category),
  })
);

/**
 * Funds table stores mutual fund master data.
 */
export const funds = pgTable('funds', {
  id: varchar('id', { length: 50 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(),
});

/**
 * fund_nav_history stores the NAV for each fund on each date.
 * Used to compute period returns and current portfolio values.
 */
export const fundNavHistory = pgTable(
  'fund_nav_history',
  {
    id: serial('id').primaryKey(),
    fundId: varchar('fund_id', { length: 50 })
      .notNull()
      .references(() => funds.id, { onDelete: 'cascade' }),
    navDate: date('nav_date').notNull(),
    nav: numeric('nav', { precision: 15, scale: 4 }).notNull(),
  },
  (table) => ({
    fundDateIdx: index('idx_nav_fund_date').on(table.fundId, table.navDate),
    uniqueFundNav: uniqueIndex('uniq_fund_nav_date').on(table.fundId, table.navDate),
  })
);

/**
 * Holdings table stores the user's mutual fund holdings.
 * purchase_nav is used to compute realized return.
 */
export const holdings = pgTable(
  'holdings',
  {
    id: varchar('id', { length: 50 }).primaryKey(),
    fundId: varchar('fund_id', { length: 50 })
      .notNull()
      .references(() => funds.id, { onDelete: 'cascade' }),
    units: numeric('units', { precision: 15, scale: 4 }).notNull(),
    purchaseDate: date('purchase_date').notNull(),
    purchaseNav: numeric('purchase_nav', { precision: 15, scale: 4 }).notNull(),
  },
  (table) => ({
    holdingFundIdx: index('idx_holdings_fund_id').on(table.fundId),
  })
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Fund = typeof funds.$inferSelect;
export type NewFund = typeof funds.$inferInsert;
export type FundNavHistory = typeof fundNavHistory.$inferSelect;
export type NewFundNavHistory = typeof fundNavHistory.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;

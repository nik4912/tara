/**
 * Date utilities used throughout the tools and agent.
 * All dates are handled as ISO strings (YYYY-MM-DD) for PostgreSQL compatibility.
 */

/**
 * Return the first and last day of a given month/year as ISO date strings.
 *
 * @example
 *   monthBounds(2024, 1) → { start: "2024-01-01", end: "2024-01-31" }
 */
export function monthBounds(
  year: number,
  month: number
): { start: string; end: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // day 0 of next month = last day of current
  return {
    start: toISODate(start),
    end: toISODate(end),
  };
}

/**
 * Return the first and last day of the previous calendar month relative to today.
 */
export function lastMonthBounds(): { start: string; end: string; year: number; month: number } {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  return { ...monthBounds(year, month), year, month };
}

/**
 * Format a JS Date as YYYY-MM-DD.
 */
export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Return a human-readable month name.
 *
 * @example monthName(1) → "January"
 */
export function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString('en-US', { month: 'long' });
}

/**
 * Build a date range from optional year/month OR explicit start/end dates.
 * Precedence: explicit start/end > year+month > none (all dates).
 */
export function resolveDateRange(params: {
  startDate?: string;
  endDate?: string;
  month?: number;
  year?: number;
}): { start: string | null; end: string | null } {
  if (params.startDate || params.endDate) {
    return {
      start: params.startDate ?? null,
      end: params.endDate ?? null,
    };
  }
  if (params.month && params.year) {
    const bounds = monthBounds(params.year, params.month);
    return { start: bounds.start, end: bounds.end };
  }
  if (params.year) {
    return {
      start: `${params.year}-01-01`,
      end: `${params.year}-12-31`,
    };
  }
  return { start: null, end: null };
}

/**
 * Parse a PostgreSQL date string (YYYY-MM-DD) into a Date object.
 */
export function parseDBDate(d: string): Date {
  return new Date(d + 'T00:00:00Z');
}

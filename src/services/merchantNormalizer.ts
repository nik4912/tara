/**
 * Generic merchant normalization service.
 *
 * Strategy (no merchant names are hardcoded):
 *  1. Uppercase and trim.
 *  2. Strip everything after a `*` — these are order/reference codes
 *     e.g. "SWIGGY*ORDER" → "SWIGGY"
 *  3. Strip trailing city/location tokens using a heuristic: remove the
 *     last word(s) that look like a place name (ALL-CAPS, not a known
 *     brand extension word).
 *  4. Collapse multiple spaces.
 *  5. Remove trailing digits / punctuation.
 *
 * The result is stored in `merchant_normalized` and used for grouping
 * across all queries.
 */

/** Regex that matches common city/location suffixes appended to merchant names. */
const LOCATION_SUFFIX_RE =
  /\s+(BANGALORE|BENGALURU|MUMBAI|DELHI|NCR|CHENNAI|HYDERABAD|PUNE|KOLKATA|AHMEDABAD|JAIPUR|SURAT|LUCKNOW|INDIA|IND|ONLINE|DIGITAL|PVT|LTD|LIMITED|CO)\.?\s*$/;

/** Regex that matches trailing reference numbers and noise. */
const TRAILING_NOISE_RE = /[\s\-_#:]+\d[\d\-_]*\s*$/;

/** Strip special characters except alphanumeric and spaces. */
const SPECIAL_CHARS_RE = /[^A-Z0-9 ]/g;

/**
 * Normalize a raw merchant name into a canonical group key.
 *
 * @example
 *   normalizeMerchant("SWIGGY*ORDER")     → "SWIGGY"
 *   normalizeMerchant("SWIGGY BANGALORE") → "SWIGGY"
 *   normalizeMerchant("Swiggy Instamart") → "SWIGGY INSTAMART"
 *   normalizeMerchant("Zomato")           → "ZOMATO"
 *   normalizeMerchant("Netflix")          → "NETFLIX"
 *   normalizeMerchant("IndiGo Airlines")  → "INDIGO AIRLINES"
 */
export function normalizeMerchant(raw: string): string {
  // Step 1 – uppercase + trim
  let name = raw.toUpperCase().trim();

  // Step 2 – strip asterisk order codes: "SWIGGY*ORDER" → "SWIGGY"
  name = name.replace(/\*.*$/, '').trim();

  // Step 3 – strip location / legal suffixes iteratively
  //          Runs up to 3 times to catch multi-suffix cases like
  //          "MERCHANT MUMBAI INDIA"
  for (let i = 0; i < 3; i++) {
    const before = name;
    name = name.replace(LOCATION_SUFFIX_RE, '').trim();
    if (name === before) break;
  }

  // Step 4 – remove trailing noise numbers (reference ids etc.)
  name = name.replace(TRAILING_NOISE_RE, '').trim();

  // Step 5 – collapse multiple spaces
  name = name.replace(/\s+/g, ' ').trim();

  return name || raw.toUpperCase().trim(); // never return empty string
}

/**
 * Return true if two merchant names resolve to the same normalized group.
 * Useful for tests and subscription detection.
 */
export function isSameMerchant(a: string, b: string): boolean {
  return normalizeMerchant(a) === normalizeMerchant(b);
}

/**
 * Normalize the user-supplied merchant filter for SQL LIKE matching.
 * Returns the normalized string as a LIKE pattern: "%SWIGGY%"
 */
export function merchantLikePattern(input: string): string {
  const normalized = normalizeMerchant(input);
  return `%${normalized}%`;
}

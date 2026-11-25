import type { CategorizationRule } from "../types"

/**
 * Built-in merchant name mapping: regex → clean display name.
 * Patterns are tested case-insensitively against the raw description.
 */
const MERCHANT_MAP: [RegExp, string][] = [
  // Amazon variants
  [/^AMZN\s?MKTP/i, "Amazon"],
  [/^AMZN\b/i, "Amazon"],
  [/^AMAZON\.COM/i, "Amazon"],
  [/^AMAZON\s?PRIME/i, "Amazon Prime"],
  [/^AMAZON\s?WEB\s?SERVICES/i, "AWS"],
  [/^PRIME VIDEO/i, "Prime Video"],

  // Square / Cash App
  [/^SQ\s?\*/i, ""],  // strip "SQ *" prefix, keep merchant
  [/^SQUARE\s?\*/i, ""],

  // PayPal
  [/^PAYPAL\s?\*/i, "PayPal"],
  [/^PP\s?\*/i, "PayPal"],

  // Ride-sharing & delivery
  [/^UBER\s+EATS/i, "Uber Eats"],
  [/^UBER\s+TRIP/i, "Uber"],
  [/^UBER\b/i, "Uber"],
  [/^LYFT\s?\*/i, "Lyft"],
  [/^DOORDASH/i, "DoorDash"],
  [/^GRUBHUB/i, "Grubhub"],
  [/^INSTACART/i, "Instacart"],
  [/^POSTMATES/i, "Postmates"],

  // Subscriptions & streaming
  [/^NETFLIX/i, "Netflix"],
  [/^HULU/i, "Hulu"],
  [/^SPOTIFY/i, "Spotify"],
  [/^APPLE\.COM\/BILL/i, "Apple"],
  [/^APPLE\s?MUSIC/i, "Apple Music"],
  [/^GOOGLE\s?\*YOUTUBE/i, "YouTube Premium"],
  [/^GOOGLE\s?\*GOOGLE\s?STORAGE/i, "Google One"],
  [/^GOOGLE\s?\*GOOGLE\s?ONE/i, "Google One"],
  [/^GOOGLE\s?\*/i, "Google"],
  [/^DISNEY\s?PLUS/i, "Disney+"],
  [/^HBO\s?MAX/i, "HBO Max"],
  [/^PARAMOUNT\s?PLUS/i, "Paramount+"],
  [/^PEACOCK/i, "Peacock"],
  [/^CRUNCHYROLL/i, "Crunchyroll"],

  // Telecoms & internet
  [/^VZWRLSS/i, "Verizon"],
  [/^VERIZON/i, "Verizon"],
  [/^T-MOBILE/i, "T-Mobile"],
  [/^AT&T/i, "AT&T"],
  [/^COMCAST/i, "Comcast/Xfinity"],
  [/^XFINITY/i, "Comcast/Xfinity"],
  [/^SPECTRUM/i, "Spectrum"],

  // Food & coffee
  [/^STARBUCKS/i, "Starbucks"],
  [/^TST\s?\*/i, ""],  // Toast POS prefix, strip
  [/^DUNKIN/i, "Dunkin'"],
  [/^CHIPOTLE/i, "Chipotle"],
  [/^MCDONALD/i, "McDonald's"],
  [/^CHICK-FIL-A/i, "Chick-fil-A"],
  [/^PANERA/i, "Panera Bread"],
  [/^DOMINO/i, "Domino's"],
  [/^SUBWAY\b/i, "Subway"],
  [/^WENDYS/i, "Wendy's"],
  [/^BURGER\s?KING/i, "Burger King"],
  [/^TACO\s?BELL/i, "Taco Bell"],
  [/^PANDA\s?EXPRESS/i, "Panda Express"],

  // Retail
  [/^WAL-?MART/i, "Walmart"],
  [/^WM\s?SUPERCENTER/i, "Walmart"],
  [/^TARGET\b/i, "Target"],
  [/^COSTCO/i, "Costco"],
  [/^SAMS\s?CLUB/i, "Sam's Club"],
  [/^WHOLE\s?FOODS/i, "Whole Foods"],
  [/^TRADER\s?JOE/i, "Trader Joe's"],
  [/^ALDI\b/i, "Aldi"],
  [/^KROGER/i, "Kroger"],
  [/^SAFEWAY/i, "Safeway"],
  [/^CVS/i, "CVS"],
  [/^WALGREENS/i, "Walgreens"],
  [/^HOME\s?DEPOT/i, "Home Depot"],
  [/^LOWES/i, "Lowe's"],
  [/^IKEA/i, "IKEA"],
  [/^BEST\s?BUY/i, "Best Buy"],

  // Gas
  [/^SHELL\s?OIL/i, "Shell"],
  [/^CHEVRON/i, "Chevron"],
  [/^EXXONMOBIL/i, "ExxonMobil"],
  [/^BP\s/i, "BP"],

  // Finance / payments
  [/^VENMO/i, "Venmo"],
  [/^ZELLE/i, "Zelle"],
  [/^CASH\s?APP/i, "Cash App"],
  [/^STRIPE/i, "Stripe"],

  // Travel
  [/^AIRBNB/i, "Airbnb"],
  [/^BOOKING\.COM/i, "Booking.com"],
  [/^EXPEDIA/i, "Expedia"],
  [/^UNITED\s?AIR/i, "United Airlines"],
  [/^DELTA\s?AIR/i, "Delta Air Lines"],
  [/^SOUTHWEST\s?AIR/i, "Southwest Airlines"],
  [/^AMERICAN\s?AIR/i, "American Airlines"],
  [/^JETBLUE/i, "JetBlue"],
  [/^SPIRIT\s?AIR/i, "Spirit Airlines"],
  [/^FRONTIER\s?AIR/i, "Frontier Airlines"],
  [/^HILTON/i, "Hilton"],
  [/^MARRIOTT/i, "Marriott"],
  [/^HYATT/i, "Hyatt"],
  [/^HERTZ/i, "Hertz"],
  [/^ENTERPRISE\s?RENT/i, "Enterprise"],

  // Gyms & fitness
  [/^PLANET\s?FITNESS/i, "Planet Fitness"],
  [/^ANYTIME\s?FITNESS/i, "Anytime Fitness"],
  [/^ORANGETHEORY/i, "Orangetheory"],
  [/^PELOTON/i, "Peloton"],

  // Insurance
  [/^GEICO/i, "GEICO"],
  [/^STATE\s?FARM/i, "State Farm"],
  [/^PROGRESSIVE/i, "Progressive"],
  [/^ALLSTATE/i, "Allstate"],

  // Pharmacies & health
  [/^RITE\s?AID/i, "Rite Aid"],

  // Streaming & digital
  [/^APPLE\s?TV/i, "Apple TV+"],
  [/^YOUTUBE\s?TV/i, "YouTube TV"],
  [/^AUDIBLE/i, "Audible"],
  [/^OPENAI/i, "OpenAI"],
  [/^CHATGPT/i, "ChatGPT"],
]

/**
 * Patterns that strip trailing noise: transaction IDs, reference numbers,
 * city/state/zip codes, random digits.
 */
const TRAILING_PATTERNS: RegExp[] = [
  /\s+REF\s*#?\s*\S+$/i,         // REF #... (before generic # pattern)
  /\s+TXN\s*#?\s*\S+$/i,         // TXN #... (before generic # pattern)
  /\s+#\S+$/,                     // # followed by ID
  /\s+\d{3}-\d{3}-\d{4}$/,       // phone numbers
  /\s+[A-Z]{2}\s+\d{5}(-\d{4})?$/, // state + zip
  /\s+\d{5}(-\d{4})?$/,          // trailing zip code
  /\s+\d{4,}$/,                   // trailing 4+ digits
  /\s+PURCHASE\s*$/i,            // trailing "PURCHASE"
  /\s+POS\s*$/i,                  // trailing "POS"
  /\s+DEBIT\s*$/i,               // trailing "DEBIT"
  /\s+CREDIT\s*$/i,              // trailing "CREDIT"
]

/**
 * Title-case a string (capitalize first letter of each word).
 * Used as a fallback for ALL-CAPS descriptions.
 */
function titleCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase())
}

/**
 * Normalize a merchant name using only built-in rules.
 * Returns the cleaned merchant name.
 */
export function normalizeMerchant(raw: string): string {
  if (!raw || !raw.trim()) return raw

  let desc = raw.trim()

  // Try merchant map first
  for (const [regex, replacement] of MERCHANT_MAP) {
    if (regex.test(desc)) {
      if (replacement === "") {
        // Strip prefix only (SQ *, TST *, etc.)
        desc = desc.replace(regex, "").trim()
        break
      }
      return replacement
    }
  }

  // Strip trailing noise
  for (const pattern of TRAILING_PATTERNS) {
    desc = desc.replace(pattern, "")
  }

  desc = desc.trim()

  // Title-case if the whole string is uppercase (and longer than 3 chars to avoid acronyms)
  if (desc.length > 3 && desc === desc.toUpperCase() && /[A-Z]/.test(desc)) {
    desc = titleCase(desc)
  }

  return desc
}

/**
 * Match a raw description against the user's categorization rules.
 * Active rules only, case-insensitive substring, first match wins.
 * Returns the matched rule's categoryId, or null when nothing matches.
 */
export function matchCategorizationRule(
  rules: CategorizationRule[],
  description: string,
): string | null {
  const lowerDesc = description.toLowerCase()
  for (const rule of rules) {
    if (!rule.isActive) continue
    if (lowerDesc.includes(rule.pattern.toLowerCase())) return rule.categoryId
  }
  return null
}

/**
 * Normalize a description using built-in rules + user-defined categorization rules
 * that have a `displayAs` value.
 */
export function normalizeDescription(
  raw: string,
  userRules?: CategorizationRule[],
): string {
  if (!raw || !raw.trim()) return raw

  // Check user rules first (they take priority)
  if (userRules) {
    for (const rule of userRules) {
      if (!rule.isActive || !rule.displayAs) continue
      try {
        const regex = new RegExp(rule.pattern, "i")
        if (regex.test(raw)) {
          return rule.displayAs
        }
      } catch {
        // Invalid regex in user rule, skip
        if (raw.toLowerCase().includes(rule.pattern.toLowerCase())) {
          return rule.displayAs
        }
      }
    }
  }

  return normalizeMerchant(raw)
}

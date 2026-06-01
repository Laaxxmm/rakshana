import { Decimal } from "decimal.js";

type Numericish = number | string | Decimal;

function toDecimal(value: Numericish): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number") return new Decimal(value);
  return new Decimal(value.toString());
}

/**
 * Format a value using the Indian numbering system: ##,##,##,###.
 *
 *   100        → "100"
 *   1000       → "1,000"
 *   100000     → "1,00,000"
 *   12345678   → "1,23,45,678"
 *   -1234.5    → "-1,234.50"   (when paise=true)
 *
 * Returns the bare number. Use `formatINRWithSymbol` when you want the ₹.
 */
export function formatINR(
  value: Numericish,
  opts: { paise?: boolean; sign?: boolean } = {},
): string {
  const { paise = false, sign = false } = opts;
  const d = toDecimal(value);
  const negative = d.isNegative();
  const abs = d.abs();

  const [intPart, fracPart] = abs.toFixed(paise ? 2 : 0).split(".");

  // Indian grouping: keep last 3 digits as ones, then group by 2.
  const grouped = groupIndian(intPart);

  let out = grouped;
  if (paise && fracPart) out += "." + fracPart;
  if (negative) out = "-" + out;
  else if (sign && !d.isZero()) out = "+" + out;
  return out;
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  // Group `rest` from the right in twos.
  const groups: string[] = [];
  for (let i = rest.length; i > 0; i -= 2) {
    groups.unshift(rest.slice(Math.max(0, i - 2), i));
  }
  return groups.join(",") + "," + last3;
}

export function formatINRWithSymbol(value: Numericish, opts?: Parameters<typeof formatINR>[1]) {
  const formatted = formatINR(value, opts);
  return formatted.startsWith("-") ? `-₹${formatted.slice(1)}` : `₹${formatted}`;
}

// ---------------------------------------------------------------------------
// In-words conversion — Indian system (lakhs, crores)
// ---------------------------------------------------------------------------

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
  "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`;
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) {
    parts.push(rest < 100 ? twoDigits(rest) : threeDigits(rest));
  }
  return parts.join(" ");
}

/**
 * "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six only"
 * Indian system: thousand → lakh → crore.
 */
export function inrInWords(value: Numericish, opts: { withRupees?: boolean } = {}): string {
  const { withRupees = true } = opts;
  const d = toDecimal(value).round();
  if (d.isZero()) {
    return withRupees ? "Rupees Zero only" : "Zero";
  }

  const negative = d.isNegative();
  let n = Number(d.abs().toFixed(0));

  const crore = Math.floor(n / 10_000_000);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  n %= 100_000;
  const thousand = Math.floor(n / 1_000);
  n %= 1_000;
  const remainder = n;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (remainder) parts.push(threeDigits(remainder));

  const body = parts.join(" ").trim();
  const head = withRupees ? "Rupees " : "";
  const sign = negative ? "Minus " : "";
  const tail = withRupees ? " only" : "";
  return `${sign}${head}${body}${tail}`;
}

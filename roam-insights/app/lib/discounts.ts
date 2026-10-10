/*
 * The discount sums, shared by the Discounts page (to preview a price) and
 * the server (to set it). Prices are worked out in cents, so no sum is done
 * on fractions.
 */
export const DISCOUNT_KINDS = ["percent", "amount"] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

export function isDiscountKind(value: unknown): value is DiscountKind {
  return value === "percent" || value === "amount";
}

export const toCents = (price: string | number) => Math.round(Number(price) * 100);
export const fromCents = (cents: number) => (cents / 100).toFixed(2);

// Why a discount cannot be used at all, or null if it can.
export function discountError(kind: DiscountKind, value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return "Enter a discount above zero.";
  if (kind === "percent" && value >= 100) return "A percentage discount must be below 100.";
  return null;
}

/*
 * The price after the discount, in cents, or null if the discount would leave
 * nothing to pay. A percentage is rounded to a whole unit of the currency, so
 * 15% off 279.00 is 237.00 and not 237.15.
 */
export function discountedCents(originalCents: number, kind: DiscountKind, value: number): number | null {
  const result =
    kind === "percent" ? Math.round((originalCents * (1 - value / 100)) / 100) * 100 : originalCents - toCents(value);
  return result > 0 && result < originalCents ? result : null;
}

// How much lower a sale price is than the price before it, as a whole percentage.
export function percentOff(originalCents: number, saleCents: number) {
  return originalCents > 0 ? Math.round((1 - saleCents / originalCents) * 100) : 0;
}

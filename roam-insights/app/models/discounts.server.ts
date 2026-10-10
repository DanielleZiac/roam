import { and, eq, inArray, lte } from "drizzle-orm";

import db from "../db.server";
import { products, timedDiscounts } from "../db/schema";
import { discountedCents, discountError, fromCents, percentOff, toCents, type DiscountKind } from "../lib/discounts";
import { unauthenticated } from "../shopify.server";
import { logActivity } from "./activity.server";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

/*
 * A discount here is a sale price on the product itself: the variant's price
 * is lowered and the price before it is kept in Shopify's "compare at" price.
 * Every shopper sees and pays the lower price. There is no code to enter and
 * nothing to do at checkout, and taking the discount off puts the kept price
 * back.
 */

const VARIANT_FIELDS = `
  id
  title
  price
  compareAtPrice
`;

const CATALOG_QUERY = `#graphql
  query RoamCatalogPrices($cursor: String) {
    shop {
      currencyCode
    }
    products(first: 50, after: $cursor, query: "status:active", sortKey: TITLE) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        productType
        variants(first: 100) {
          nodes {
            ${VARIANT_FIELDS}
          }
        }
      }
    }
  }
`;

type ShopifyVariant = { id: string; title: string; price: string; compareAtPrice: string | null };
type ShopifyProduct = { id: string; title: string; productType: string; variants: { nodes: ShopifyVariant[] } };

export type CatalogVariant = {
  id: string;
  title: string;
  priceCents: number;
  // The price before the discount. The same as priceCents when there is none.
  originalCents: number;
};

export type CatalogProduct = {
  id: string;
  title: string;
  productType: string;
  variants: CatalogVariant[];
  onSale: boolean;
  // The largest discount among the variants, as a whole percentage.
  percentOff: number;
};

function readVariant(variant: ShopifyVariant): CatalogVariant {
  const priceCents = toCents(variant.price);
  const compareCents = variant.compareAtPrice === null ? 0 : toCents(variant.compareAtPrice);
  return { id: variant.id, title: variant.title, priceCents, originalCents: Math.max(priceCents, compareCents) };
}

function readProduct(node: ShopifyProduct): CatalogProduct {
  const variants = node.variants.nodes.map(readVariant);
  const discounts = variants.map((variant) => percentOff(variant.originalCents, variant.priceCents));
  return {
    id: node.id,
    title: node.title,
    productType: node.productType,
    variants,
    onSale: variants.some((variant) => variant.priceCents < variant.originalCents),
    percentOff: Math.max(0, ...discounts),
  };
}

// Every active product with its prices, read from Shopify so the page never shows a stale price.
export async function listCatalog(graphql: AdminGraphql) {
  const catalog: CatalogProduct[] = [];
  let currencyCode = "PHP";
  let cursor: string | null = null;

  do {
    const response: Response = await graphql(CATALOG_QUERY, { variables: { cursor } });
    const body = (await response.json()) as {
      data: {
        shop: { currencyCode: string };
        products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProduct[] };
      };
    };
    currencyCode = body.data.shop.currencyCode;
    catalog.push(...body.data.products.nodes.map(readProduct));
    cursor = body.data.products.pageInfo.hasNextPage ? body.data.products.pageInfo.endCursor : null;
  } while (cursor);

  return { currencyCode, products: catalog };
}

const PRODUCTS_BY_ID = `#graphql
  query RoamProductPrices($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        productType
        variants(first: 100) {
          nodes {
            ${VARIANT_FIELDS}
          }
        }
      }
    }
  }
`;

const UPDATE_VARIANTS = `#graphql
  mutation RoamSetVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      userErrors {
        field
        message
      }
    }
  }
`;

export type DiscountChange = { kind: DiscountKind; value: number } | { kind: "remove" };
export type DiscountResult =
  | { ok: true; message: string; skipped: string[]; changedIds: string[] }
  | { ok: false; error: string };

type ChangeOptions = {
  // "system" when the app starts or ends a timed discount by itself.
  actor?: "merchant" | "system";
  // The timed discount this change belongs to, which keeps its hold on the products.
  timedDiscountId?: number;
};

// A shop only has a few dozen products, so the ids are sent in one request.
const MAX_PRODUCTS = 250;

/*
 * Puts a discount on the chosen products, or takes it off.
 *
 *   1. Reads the products' current prices from Shopify, not from the page,
 *      so a price changed elsewhere in the meantime is not overwritten.
 *   2. Works out each variant's new price from the price before any discount.
 *      Discounting a product twice replaces the first discount; it does not
 *      stack on top of it.
 *   3. Writes the prices to Shopify.
 *   4. Adds an activity log entry with the before and after prices.
 *   5. Takes the changed products out of any other timed discount that is
 *      running, so that discount's end does not undo this change later.
 *
 * A product the discount cannot apply to (a fixed amount that is not below
 * its price, say) is skipped and named in the result; the rest still change.
 */
export async function changeDiscounts(
  graphql: AdminGraphql,
  shop: string,
  productIds: string[],
  change: DiscountChange,
  options: ChangeOptions = {},
): Promise<DiscountResult> {
  const ids = [...new Set(productIds)].slice(0, MAX_PRODUCTS);
  if (ids.length === 0) return { ok: false, error: "Select at least one product." };
  if (change.kind !== "remove") {
    const error = discountError(change.kind, change.value);
    if (error) return { ok: false, error };
  }

  const response = await graphql(PRODUCTS_BY_ID, { variables: { ids } });
  const body = (await response.json()) as { data?: { nodes: (ShopifyProduct | null)[] } };
  const found = (body.data?.nodes ?? []).filter((node): node is ShopifyProduct => Boolean(node?.variants));
  if (found.length === 0) return { ok: false, error: "Those products were not found in the store." };

  const known = new Map(
    (await db.select().from(products).where(eq(products.shop, shop))).map((row) => [row.shopifyProductId, row.id]),
  );

  const changedIds: string[] = [];
  const skipped: string[] = [];

  for (const node of found) {
    const before = readProduct(node);
    const after: CatalogVariant[] = [];

    for (const variant of before.variants) {
      const priceCents =
        change.kind === "remove"
          ? variant.originalCents
          : discountedCents(variant.originalCents, change.kind, change.value);
      if (priceCents !== null) after.push({ ...variant, priceCents });
    }

    // One variant the discount does not fit stops the whole product, so its variants never disagree.
    const fits = after.length === before.variants.length;
    const differs = after.some((variant, index) => variant.priceCents !== before.variants[index].priceCents);
    if (!fits) {
      skipped.push(`${before.title} (the discount is not below its price)`);
      continue;
    }
    if (!differs) {
      skipped.push(`${before.title} (${change.kind === "remove" ? "has no discount" : "already has this discount"})`);
      continue;
    }

    const update = await graphql(UPDATE_VARIANTS, {
      variables: {
        productId: before.id,
        variants: after.map((variant) => ({
          id: variant.id,
          price: fromCents(variant.priceCents),
          compareAtPrice: variant.priceCents < variant.originalCents ? fromCents(variant.originalCents) : null,
        })),
      },
    });
    const result = (await update.json()) as {
      data?: { productVariantsBulkUpdate: { userErrors: { message: string }[] } };
    };
    const errors = result.data?.productVariantsBulkUpdate.userErrors ?? [];
    if (!result.data || errors.length > 0) {
      skipped.push(`${before.title} (${errors.map((error) => error.message).join("; ") || "Shopify did not accept the change"})`);
      continue;
    }

    changedIds.push(before.id);
    const prices = (variants: CatalogVariant[]) =>
      variants.map((variant) => ({ variant: variant.title, price: fromCents(variant.priceCents) }));
    await logActivity({
      shop,
      actor: options.actor ?? "merchant",
      action: change.kind === "remove" ? "product.discount_removed" : "product.discounted",
      summary:
        change.kind === "remove"
          ? `${before.title}: discount removed`
          : `${before.title}: ${change.kind === "percent" ? `${change.value}%` : fromCents(toCents(change.value))} off`,
      productId: known.get(before.id) ?? null,
      details: { before: prices(before.variants), after: prices(after) },
    });
  }

  if (changedIds.length === 0) {
    return { ok: false, error: `Nothing was changed. Skipped: ${skipped.join("; ")}.` };
  }
  await releaseProducts(shop, changedIds, options.timedDiscountId);

  const noun = changedIds.length === 1 ? "1 product" : `${changedIds.length} products`;
  return {
    ok: true,
    message:
      change.kind === "remove"
        ? `Discount removed from ${noun}. The storefront shows the full price again.`
        : `Discount applied to ${noun}. The storefront now shows the lower price.`,
    skipped,
    changedIds,
  };
}

// --- Timed discounts ------------------------------------------------------------

type TimedDiscount = typeof timedDiscounts.$inferSelect;
type Status = TimedDiscount["status"];

const describe = (kind: DiscountKind, value: number) =>
  kind === "percent" ? `${value}% off` : `${fromCents(toCents(value))} off`;

// Moves a timed discount from one status to the next. False if something else got there first,
// which is how the page and the timer avoid both acting on the same discount.
async function claim(id: number, from: Status, to: Status) {
  const [result] = await db
    .update(timedDiscounts)
    .set({ status: to })
    .where(and(eq(timedDiscounts.id, id), eq(timedDiscounts.status, from)));
  return result.affectedRows === 1;
}

// Takes products out of the running timed discounts, except the one named.
async function releaseProducts(shop: string, productIds: string[], exceptId?: number) {
  const running = await db
    .select()
    .from(timedDiscounts)
    .where(and(eq(timedDiscounts.shop, shop), eq(timedDiscounts.status, "active")));

  for (const discount of running) {
    if (discount.id === exceptId) continue;
    const kept = discount.productIds.filter((id) => !productIds.includes(id));
    if (kept.length === discount.productIds.length) continue;
    await db
      .update(timedDiscounts)
      .set({ productIds: kept, ...(kept.length === 0 ? { status: "finished" as const } : {}) })
      .where(eq(timedDiscounts.id, discount.id));
  }
}

export type DiscountPeriod = { startsAt: Date | null; endsAt: Date | null };

/*
 * Puts a discount on products for a period.
 *
 * With no start, or a start that has passed, the prices change now. With a
 * start in the future nothing changes yet: the discount is written down and
 * runDueDiscounts puts it on when the time comes. With an end, the same
 * function takes it off again. With neither, this is a plain discount that
 * stays until the merchant removes it.
 */
export async function applyDiscount(
  graphql: AdminGraphql,
  shop: string,
  productIds: string[],
  change: { kind: DiscountKind; value: number },
  period: DiscountPeriod,
): Promise<DiscountResult> {
  const now = new Date();
  const { endsAt } = period;
  const startsAt = period.startsAt && period.startsAt > now ? period.startsAt : null;

  if (endsAt && endsAt <= now) return { ok: false, error: "The end must be in the future." };
  if (endsAt && startsAt && endsAt <= startsAt) return { ok: false, error: "The end must be after the start." };

  if (!startsAt) {
    const result = await changeDiscounts(graphql, shop, productIds, change);
    if (!result.ok || !endsAt) return result;

    const [inserted] = await db
      .insert(timedDiscounts)
      .values({ shop, ...change, value: String(change.value), productIds: result.changedIds, startsAt: now, endsAt, status: "active" });
    // The products now belong to this discount, not to one that was already running on them.
    await releaseProducts(shop, result.changedIds, inserted.insertId);
    await logActivity({
      shop,
      actor: "merchant",
      action: "discount.started",
      summary: `Started ${describe(change.kind, change.value)} on ${result.changedIds.length} products, with an end set`,
      details: { endsAt: endsAt.toISOString(), productIds: result.changedIds },
    });
    return { ...result, message: `${result.message} The full price comes back when the discount ends.` };
  }

  const ids = [...new Set(productIds)].slice(0, MAX_PRODUCTS);
  if (ids.length === 0) return { ok: false, error: "Select at least one product." };
  const error = discountError(change.kind, change.value);
  if (error) return { ok: false, error };

  await db
    .insert(timedDiscounts)
    .values({ shop, ...change, value: String(change.value), productIds: ids, startsAt, endsAt, status: "scheduled" });

  const noun = ids.length === 1 ? "1 product" : `${ids.length} products`;
  await logActivity({
    shop,
    actor: "merchant",
    action: "discount.scheduled",
    summary: `Scheduled ${describe(change.kind, change.value)} for ${noun}`,
    details: { startsAt: startsAt.toISOString(), endsAt: endsAt?.toISOString() ?? null, productIds: ids },
  });
  return {
    ok: true,
    message: `Discount scheduled for ${noun}. Prices stay as they are until it starts.`,
    skipped: [],
    changedIds: [],
  };
}

// The timed discounts that are waiting to start or waiting to end, soonest first.
export function listTimedDiscounts(shop: string) {
  return db
    .select()
    .from(timedDiscounts)
    .where(and(eq(timedDiscounts.shop, shop), inArray(timedDiscounts.status, ["scheduled", "active"])))
    .orderBy(timedDiscounts.startsAt);
}

/*
 * Starts the timed discounts whose start has come and ends the ones whose end
 * has come. Called once a minute by the server's timer and each time the
 * Discounts page loads, so anything missed while the server was off is caught
 * up as soon as it is back.
 */
export async function runDueDiscounts(graphql: AdminGraphql, shop: string) {
  const now = new Date();

  for (const discount of await listTimedDiscounts(shop)) {
    const value = Number(discount.value);
    const label = describe(discount.kind, value);

    if (discount.status === "scheduled" && discount.startsAt <= now) {
      // The whole period went by while the server was off: do not start a discount that is already over.
      if (discount.endsAt && discount.endsAt <= now) {
        if (await claim(discount.id, "scheduled", "finished")) {
          await logActivity({
            shop,
            actor: "system",
            action: "discount.missed",
            summary: `Did not run ${label}: its period passed while the app was not running`,
          });
        }
        continue;
      }
      if (!(await claim(discount.id, "scheduled", "active"))) continue;

      const result = await changeDiscounts(
        graphql,
        shop,
        discount.productIds,
        { kind: discount.kind, value },
        { actor: "system", timedDiscountId: discount.id },
      );
      await db
        .update(timedDiscounts)
        .set({
          productIds: result.ok ? result.changedIds : [],
          // With no end, or nothing changed, there is nothing left to take off later.
          ...(!result.ok || !discount.endsAt ? { status: "finished" as const } : {}),
        })
        .where(eq(timedDiscounts.id, discount.id));
      await logActivity({
        shop,
        actor: "system",
        action: "discount.started",
        summary: result.ok
          ? `Started ${label} on ${result.changedIds.length} products`
          : `Could not start ${label}. ${result.error}`,
      });
    } else if (discount.status === "active" && discount.endsAt && discount.endsAt <= now) {
      if (!(await claim(discount.id, "active", "finished"))) continue;
      const result = await changeDiscounts(graphql, shop, discount.productIds, { kind: "remove" }, { actor: "system" });
      await logActivity({
        shop,
        actor: "system",
        action: "discount.ended",
        summary: result.ok
          ? `Ended ${label} on ${result.changedIds.length} products`
          : `Ended ${label}: no prices needed changing`,
      });
    }
  }
}

// The timer's entry point: every shop with something due, using the app's own access to that shop.
export async function runAllDueDiscounts() {
  const now = new Date();
  const waiting = await db
    .select({ shop: timedDiscounts.shop, status: timedDiscounts.status, endsAt: timedDiscounts.endsAt })
    .from(timedDiscounts)
    .where(and(inArray(timedDiscounts.status, ["scheduled", "active"]), lte(timedDiscounts.startsAt, now)));
  const due = waiting.filter((row) => row.status === "scheduled" || (row.endsAt && row.endsAt <= now));

  for (const shop of new Set(due.map((row) => row.shop))) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      await runDueDiscounts(admin.graphql, shop);
    } catch (error) {
      console.error(`Timed discounts for ${shop} could not be run`, error);
    }
  }
}

/*
 * Stops a timed discount. One that has not started is cancelled and no price
 * changes. One that is running ends now: its products go back to full price.
 */
export async function stopTimedDiscount(graphql: AdminGraphql, shop: string, id: number): Promise<DiscountResult> {
  const [discount] = await db
    .select()
    .from(timedDiscounts)
    .where(and(eq(timedDiscounts.shop, shop), eq(timedDiscounts.id, id)));
  if (!discount) return { ok: false, error: "That discount was not found." };
  const label = describe(discount.kind, Number(discount.value));

  if (discount.status === "scheduled" && (await claim(id, "scheduled", "cancelled"))) {
    await logActivity({ shop, actor: "merchant", action: "discount.cancelled", summary: `Cancelled scheduled ${label}` });
    return { ok: true, message: "Scheduled discount cancelled. No prices were changed.", skipped: [], changedIds: [] };
  }
  if (discount.status === "active" && (await claim(id, "active", "finished"))) {
    return changeDiscounts(graphql, shop, discount.productIds, { kind: "remove" });
  }
  return { ok: false, error: "That discount has already finished." };
}

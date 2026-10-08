import { and, count, countDistinct, desc, eq, gte, inArray } from "drizzle-orm";

import db from "../db.server";
import { alerts, eventNeeds, eventPicks, products, suggestionEvents, type AlertMetric } from "../db/schema";
import { NEEDS, needLabel } from "../lib/needs";
import { logActivity } from "./activity.server";

/*
 * The rules, in one place. All of them look at the last WINDOW_DAYS days.
 *
 * Unmet need: shoppers keep choosing a need that the catalog barely covers.
 *   Raised when a need was chosen at least MIN_SELECTIONS times and either
 *   no product is tagged for it, or at most THIN_COVERAGE products are and
 *   the need appears in at least MIN_SHARE of all quiz results.
 *
 * Low conversion: a product is suggested often but almost never added to a cart.
 *   Raised when it was suggested at least MIN_SUGGESTED times and fewer than
 *   LOW_RATE of those suggestions were added to a cart.
 */
export const ALERT_RULES = {
  WINDOW_DAYS: 30,
  MIN_SELECTIONS: 5,
  THIN_COVERAGE: 2,
  MIN_SHARE: 0.15,
  MIN_SUGGESTED: 8,
  LOW_RATE: 0.05,
} as const;

export function windowStart() {
  return new Date(Date.now() - ALERT_RULES.WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

type Wanted = {
  type: "unmet_need" | "low_conversion";
  severity: "low" | "medium" | "high";
  needTag: string | null;
  productId: number | null;
  message: string;
  metric: AlertMetric;
};

const keyOf = (alert: { type: string; needTag: string | null; productId: number | null }) =>
  `${alert.type}:${alert.needTag ?? alert.productId}`;

const percent = (value: number) => `${Math.round(value * 100)}%`;

/*
 * Works out which alerts should exist right now, then makes the table match:
 * new conditions are raised, existing ones get fresh numbers, and alerts whose
 * condition has cleared are resolved. Every raise and resolve is logged.
 * Safe to run as often as you like.
 */
export async function evaluateAlerts(shop: string) {
  const since = windowStart();
  const inWindow = and(eq(suggestionEvents.shop, shop), gte(suggestionEvents.createdAt, since));

  const [[{ total }], needRows, pickRows, catalog, active] = await Promise.all([
    db.select({ total: count() }).from(suggestionEvents).where(inWindow),
    db
      .select({ needTag: eventNeeds.needTag, selections: countDistinct(eventNeeds.eventId) })
      .from(eventNeeds)
      .innerJoin(suggestionEvents, eq(eventNeeds.eventId, suggestionEvents.id))
      .where(inWindow)
      .groupBy(eventNeeds.needTag),
    db
      .select({
        productId: eventPicks.productId,
        suggested: count(),
        addedToCart: count(eventPicks.addedToCartAt),
      })
      .from(eventPicks)
      .innerJoin(suggestionEvents, eq(eventPicks.eventId, suggestionEvents.id))
      .where(inWindow)
      .groupBy(eventPicks.productId),
    db.select().from(products).where(eq(products.shop, shop)),
    db
      .select()
      .from(alerts)
      .where(and(eq(alerts.shop, shop), inArray(alerts.status, ["open", "acknowledged"]))),
  ]);

  const wanted = new Map<string, Wanted>();
  const selectionsByTag = new Map(needRows.map((row) => [row.needTag, row.selections]));

  for (const need of NEEDS.filter((entry) => entry.kind === "need")) {
    const selections = selectionsByTag.get(need.tag) ?? 0;
    const matchingProducts = catalog.filter((product) => product.needTags.includes(need.tag)).length;
    const share = total > 0 ? selections / total : 0;

    const noCoverage = matchingProducts === 0;
    const thinCoverage = matchingProducts <= ALERT_RULES.THIN_COVERAGE && share >= ALERT_RULES.MIN_SHARE;
    if (selections < ALERT_RULES.MIN_SELECTIONS || !(noCoverage || thinCoverage)) continue;

    const entry: Wanted = {
      type: "unmet_need",
      severity: matchingProducts <= 1 ? "high" : "medium",
      needTag: need.tag,
      productId: null,
      message: `${need.label}: chosen in ${selections} quiz results (${percent(share)}), but only ${matchingProducts} ${
        matchingProducts === 1 ? "product is" : "products are"
      } tagged for it.`,
      metric: { selections, matchingProducts, sharePercent: Math.round(share * 100) },
    };
    wanted.set(keyOf(entry), entry);
  }

  const titleById = new Map(catalog.map((product) => [product.id, product.title]));
  for (const row of pickRows) {
    if (row.productId === null || !titleById.has(row.productId)) continue;
    const rate = row.suggested > 0 ? row.addedToCart / row.suggested : 0;
    if (row.suggested < ALERT_RULES.MIN_SUGGESTED || rate >= ALERT_RULES.LOW_RATE) continue;

    const entry: Wanted = {
      type: "low_conversion",
      severity: "medium",
      needTag: null,
      productId: row.productId,
      message: `${titleById.get(row.productId)}: suggested ${row.suggested} times, added to a cart ${
        row.addedToCart === 1 ? "once" : `${row.addedToCart} times`}.`,
      metric: { suggested: row.suggested, addedToCart: row.addedToCart, ratePercent: Math.round(rate * 100) },
    };
    wanted.set(keyOf(entry), entry);
  }

  const activeByKey = new Map(active.map((alert) => [keyOf(alert), alert]));
  let raised = 0;
  let resolved = 0;

  for (const [key, entry] of wanted) {
    const existing = activeByKey.get(key);
    if (existing) {
      await db
        .update(alerts)
        .set({ message: entry.message, metric: entry.metric, severity: entry.severity })
        .where(eq(alerts.id, existing.id));
      continue;
    }
    const [created] = await db.insert(alerts).values({ shop, ...entry }).$returningId();
    await logActivity({
      shop,
      actor: "system",
      action: "alert.raised",
      summary: entry.message,
      alertId: created.id,
      productId: entry.productId,
      details: { type: entry.type, metric: entry.metric },
    });
    raised += 1;
  }

  for (const alert of active) {
    if (wanted.has(keyOf(alert))) continue;
    await db.update(alerts).set({ status: "resolved", resolvedAt: new Date() }).where(eq(alerts.id, alert.id));
    await logActivity({
      shop,
      actor: "system",
      action: "alert.resolved",
      summary: `Cleared: ${alert.needTag ? needLabel(alert.needTag) : titleById.get(alert.productId ?? 0) ?? "product"} no longer meets the alert condition`,
      alertId: alert.id,
      productId: alert.productId,
    });
    resolved += 1;
  }

  return { raised, resolved };
}

export function listAlerts(shop: string) {
  return db.select().from(alerts).where(eq(alerts.shop, shop)).orderBy(desc(alerts.createdAt), desc(alerts.id));
}

// The merchant marks an alert as seen. It stays listed until its condition clears.
export async function acknowledgeAlert(shop: string, id: number) {
  const [alert] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.shop, shop), eq(alerts.id, id)));
  if (!alert || alert.status !== "open") return false;

  await db.update(alerts).set({ status: "acknowledged" }).where(eq(alerts.id, id));
  await logActivity({
    shop,
    actor: "merchant",
    action: "alert.acknowledged",
    summary: `Acknowledged: ${alert.message}`,
    alertId: id,
    productId: alert.productId,
  });
  return true;
}

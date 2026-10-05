import { and, count, countDistinct, eq, gte } from "drizzle-orm";

import db from "../db.server";
import { eventNeeds, eventPicks, products, suggestionEvents } from "../db/schema";
import { NEEDS } from "../lib/needs";
import { ALERT_RULES, windowStart } from "./alerts.server";

// How much the shop-wide average counts when ranking. See rankProducts.
const PRIOR_WEIGHT = 5;

export type RankedProduct = {
  id: number;
  title: string;
  suggested: number;
  addedToCart: number;
  ratePercent: number;
  score: number;
};

/*
 * Ranks products by how well being suggested turns into an add to cart.
 *
 * A raw rate would put a product suggested once and added once (100%) above
 * one suggested 50 times and added 20 times (40%), which is misleading. So each
 * product's rate is pulled toward the shop-wide average, as if it had
 * PRIOR_WEIGHT extra suggestions that performed exactly averagely:
 *
 *   score = (addedToCart + average * PRIOR_WEIGHT) / (suggested + PRIOR_WEIGHT)
 *
 * With little data a product sits near the average. As evidence builds up, its
 * own numbers take over.
 */
export function rankProducts(rows: { id: number; title: string; suggested: number; addedToCart: number }[]): RankedProduct[] {
  const totalSuggested = rows.reduce((sum, row) => sum + row.suggested, 0);
  const totalAdded = rows.reduce((sum, row) => sum + row.addedToCart, 0);
  const average = totalSuggested > 0 ? totalAdded / totalSuggested : 0;

  return rows
    .filter((row) => row.suggested > 0)
    .map((row) => ({
      ...row,
      ratePercent: Math.round((row.addedToCart / row.suggested) * 100),
      score: (row.addedToCart + average * PRIOR_WEIGHT) / (row.suggested + PRIOR_WEIGHT),
    }))
    .sort((a, b) => b.score - a.score || b.suggested - a.suggested);
}

// Everything the dashboard shows, for the same window the alert rules use.
export async function getDashboard(shop: string) {
  const since = windowStart();
  const inWindow = and(eq(suggestionEvents.shop, shop), gte(suggestionEvents.createdAt, since));

  const [[{ events }], needRows, pickRows, catalog] = await Promise.all([
    db.select({ events: count() }).from(suggestionEvents).where(inWindow),
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
  ]);

  const selectionsByTag = new Map(needRows.map((row) => [row.needTag, row.selections]));
  const needs = NEEDS.map((need) => {
    const selections = selectionsByTag.get(need.tag) ?? 0;
    return {
      tag: need.tag,
      label: need.label,
      kind: need.kind,
      selections,
      sharePercent: events > 0 ? Math.round((selections / events) * 100) : 0,
      matchingProducts: catalog.filter((product) => product.needTags.includes(need.tag)).length,
    };
  }).sort((a, b) => b.selections - a.selections);

  const statsById = new Map(pickRows.filter((row) => row.productId !== null).map((row) => [row.productId as number, row]));
  const ranking = rankProducts(
    catalog.map((product) => ({
      id: product.id,
      title: product.title,
      suggested: statsById.get(product.id)?.suggested ?? 0,
      addedToCart: statsById.get(product.id)?.addedToCart ?? 0,
    })),
  );

  const suggested = pickRows.reduce((sum, row) => sum + row.suggested, 0);
  const addedToCart = pickRows.reduce((sum, row) => sum + row.addedToCart, 0);

  return {
    windowDays: ALERT_RULES.WINDOW_DAYS,
    events,
    productCount: catalog.length,
    untaggedProducts: catalog.filter((product) => product.needTags.length === 0).length,
    suggested,
    addedToCart,
    cartRatePercent: suggested > 0 ? Math.round((addedToCart / suggested) * 100) : 0,
    needs,
    ranking,
  };
}

import { and, count, countDistinct, eq, gte, sql } from "drizzle-orm";

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
  verdict: "strong" | "average" | "weak" | "too_early";
};

// A product needs this many suggestions before it is judged strong or weak.
const MIN_SUGGESTIONS_TO_JUDGE = 8;

/*
 * Compares how often shoppers ask for a need with how much of the catalog
 * serves it. If 27% of shoppers choose a need but only 13% of products are
 * tagged for it, demand is about twice the supply: the store is short.
 */
export function coverageVerdict(demandPercent: number, stockPercent: number, matchingProducts: number) {
  if (demandPercent === 0) return "no_demand" as const;
  if (matchingProducts === 0) return "none" as const;
  const ratio = demandPercent / Math.max(stockPercent, 1);
  if (ratio >= 1.5) return "short" as const;
  if (ratio <= 0.6) return "plenty" as const;
  return "balanced" as const;
}

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
    .map((row) => {
      const rate = row.addedToCart / row.suggested;
      let verdict: RankedProduct["verdict"] = "average";
      if (row.suggested < MIN_SUGGESTIONS_TO_JUDGE) verdict = "too_early";
      else if (rate >= average * 1.3) verdict = "strong";
      else if (rate <= average * 0.5) verdict = "weak";
      return {
        ...row,
        ratePercent: Math.round(rate * 100),
        score: (row.addedToCart + average * PRIOR_WEIGHT) / (row.suggested + PRIOR_WEIGHT),
        verdict,
      };
    })
    .sort((a, b) => b.score - a.score || b.suggested - a.suggested);
}

// Everything the dashboard shows, for the same window the alert rules use.
export async function getDashboard(shop: string) {
  const since = windowStart();
  const inWindow = and(eq(suggestionEvents.shop, shop), gte(suggestionEvents.createdAt, since));

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const dayOf = sql<string>`DATE_FORMAT(${suggestionEvents.createdAt}, '%Y-%m-%d')`;

  const [[{ events }], [{ thisWeek }], [{ lastTwoWeeks }], dayRows, needRows, pickRows, catalog] = await Promise.all([
    db.select({ events: count() }).from(suggestionEvents).where(inWindow),
    db
      .select({ thisWeek: count() })
      .from(suggestionEvents)
      .where(and(eq(suggestionEvents.shop, shop), gte(suggestionEvents.createdAt, weekAgo))),
    db
      .select({ lastTwoWeeks: count() })
      .from(suggestionEvents)
      .where(and(eq(suggestionEvents.shop, shop), gte(suggestionEvents.createdAt, twoWeeksAgo))),
    db.select({ day: dayOf, results: count() }).from(suggestionEvents).where(inWindow).groupBy(dayOf),
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
    const matchingProducts = catalog.filter((product) => product.needTags.includes(need.tag)).length;
    const sharePercent = events > 0 ? Math.round((selections / events) * 100) : 0;
    const stockPercent = catalog.length > 0 ? Math.round((matchingProducts / catalog.length) * 100) : 0;
    return {
      tag: need.tag,
      label: need.label,
      kind: need.kind,
      selections,
      sharePercent,
      matchingProducts,
      stockPercent,
      verdict: coverageVerdict(sharePercent, stockPercent, matchingProducts),
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

  const lastWeek = lastTwoWeeks - thisWeek;

  // One entry per day in the window, including days with no results.
  const resultsByDay = new Map(dayRows.map((row) => [row.day, row.results]));
  const daily = Array.from({ length: ALERT_RULES.WINDOW_DAYS }, (_, index) => {
    const date = new Date(Date.now() - (ALERT_RULES.WINDOW_DAYS - 1 - index) * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    return { day: key, results: resultsByDay.get(key) ?? 0 };
  });

  return {
    windowDays: ALERT_RULES.WINDOW_DAYS,
    events,
    thisWeek,
    lastWeek,
    daily,
    productCount: catalog.length,
    untaggedProducts: catalog.filter((product) => product.needTags.length === 0).length,
    suggested,
    addedToCart,
    cartRatePercent: suggested > 0 ? Math.round((addedToCart / suggested) * 100) : 0,
    needs,
    ranking,
  };
}

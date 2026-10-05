import { and, eq, inArray } from "drizzle-orm";

import db from "../db.server";
import { eventNeeds, eventPicks, products, suggestionEvents } from "../db/schema";
import { isNeedTag } from "../lib/needs";

const MAX_NEEDS = 11;
const MAX_PICKS = 4;

export type SuggestionPayload = { needs: string[]; picks: string[] };

/*
 * Checks a payload sent by the storefront. It arrives from the public
 * internet, so nothing in it is trusted: unknown need tags are dropped,
 * lists are capped, and product handles must look like handles.
 * Returns null if nothing usable is left.
 */
export function parseSuggestionPayload(input: unknown): SuggestionPayload | null {
  if (!input || typeof input !== "object") return null;
  const { needs, picks } = input as { needs?: unknown; picks?: unknown };
  if (!Array.isArray(needs) || !Array.isArray(picks)) return null;

  const cleanNeeds = [...new Set(needs.filter(isNeedTag))].slice(0, MAX_NEEDS);
  const cleanPicks = [
    ...new Set(picks.filter((pick): pick is string => typeof pick === "string" && /^[a-z0-9-]{1,255}$/.test(pick))),
  ].slice(0, MAX_PICKS);

  if (cleanNeeds.length === 0) return null;
  return { needs: cleanNeeds, picks: cleanPicks };
}

/*
 * Saves one finished "Tell us about you" result: the event, the need tags
 * chosen and the products suggested. All three are written in one transaction,
 * so an event is never saved without its needs and picks.
 */
export async function recordSuggestionEvent(shop: string, payload: SuggestionPayload) {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(suggestionEvents)
      .values({ shop, pickCount: payload.picks.length })
      .$returningId();

    await tx.insert(eventNeeds).values(payload.needs.map((needTag) => ({ eventId: event.id, needTag })));

    if (payload.picks.length > 0) {
      const known = await tx
        .select({ id: products.id, handle: products.handle })
        .from(products)
        .where(and(eq(products.shop, shop), inArray(products.handle, payload.picks)));
      const idByHandle = new Map(known.map((product) => [product.handle, product.id]));

      await tx.insert(eventPicks).values(
        payload.picks.map((productHandle, index) => ({
          eventId: event.id,
          productId: idByHandle.get(productHandle) ?? null,
          productHandle,
          position: index + 1,
        })),
      );
    }

    return event.id;
  });
}

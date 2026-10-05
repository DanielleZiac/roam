import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { parseSuggestionPayload, recordSuggestionEvent } from "../models/events.server";

/*
 * Receives "Tell us about you" results from the storefront.
 *
 * The theme posts to /apps/roam/events on the shop's own domain. Shopify
 * forwards that here through the app proxy and signs the request, and
 * authenticate.public.appProxy rejects anything without a valid signature.
 * So this endpoint cannot be called directly from outside Shopify.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return Response.json({ ok: false, error: "missing_shop" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const payload = parseSuggestionPayload(body);
  if (!payload) return Response.json({ ok: false, error: "invalid_payload" }, { status: 422 });

  const eventId = await recordSuggestionEvent(shop, payload);
  return Response.json({ ok: true, eventId });
};

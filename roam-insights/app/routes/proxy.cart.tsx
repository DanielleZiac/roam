import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { recordCartAdd } from "../models/events.server";

/*
 * The storefront reports here when a shopper adds a suggested product to their
 * cart, so the app can tell which suggestions actually lead somewhere.
 * Reached through the app proxy at /apps/roam/cart, like the events endpoint.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return Response.json({ ok: false, error: "missing_shop" }, { status: 400 });

  let body: { eventId?: unknown; handle?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const eventId = Number(body.eventId);
  const handle = body.handle;
  if (!Number.isInteger(eventId) || eventId < 1 || typeof handle !== "string" || !/^[a-z0-9-]{1,255}$/.test(handle)) {
    return Response.json({ ok: false, error: "invalid_payload" }, { status: 422 });
  }

  const recorded = await recordCartAdd(shop, eventId, handle);
  return Response.json({ ok: true, recorded });
};

import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { createReview, parseReviewInput } from "../models/reviews.server";

/*
 * Receives a review written on a product page. Reached through the app proxy
 * at /apps/roam/reviews, so the request is signed by Shopify. The review is
 * saved as pending and only appears on the store once the merchant approves it.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const shop = new URL(request.url).searchParams.get("shop");
  if (!shop) return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 400 });
  }

  const parsed = parseReviewInput(body);
  if (!parsed.ok) return Response.json(parsed, { status: 422 });

  const saved = await createReview(shop, parsed.review);
  if (!saved) return Response.json({ ok: false, error: "We could not find that product." }, { status: 404 });

  return Response.json({ ok: true });
};

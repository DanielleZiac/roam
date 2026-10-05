import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { logActivity } from "../models/activity.server";
import {
  createReview,
  findProductByHandle,
  getAutoPublish,
  hasBought,
  hasReviewed,
  parseReviewInput,
  publishProductReviews,
} from "../models/reviews.server";

/*
 * Receives a review written on a product page. Reached through the app proxy
 * at /apps/roam/reviews, so the request is signed by Shopify.
 *
 * Buyers only. Shopify adds logged_in_customer_id to the signed request when
 * the shopper is signed in. The app then checks that customer's orders for the
 * product, and allows one review per customer per product.
 *
 * By default the review is saved as pending and appears once the merchant
 * approves it. If the shop has turned approval off, it is published at once.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.public.appProxy(request);
  const generic = { ok: false, error: "Something went wrong. Please try again." };

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const customerId = url.searchParams.get("logged_in_customer_id") ?? "";
  if (!shop || !admin) return Response.json(generic, { status: 400 });

  if (!/^\d{1,32}$/.test(customerId)) {
    return Response.json({ ok: false, error: "Sign in to write a review." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(generic, { status: 400 });
  }

  const parsed = parseReviewInput(body);
  if (!parsed.ok) return Response.json(parsed, { status: 422 });

  const product = await findProductByHandle(shop, parsed.review.handle);
  if (!product) return Response.json({ ok: false, error: "We could not find that product." }, { status: 404 });

  if (await hasReviewed(product.id, customerId)) {
    return Response.json({ ok: false, error: "You have already reviewed this product." }, { status: 409 });
  }

  if (!(await hasBought(admin.graphql, customerId, product.shopifyProductId))) {
    return Response.json(
      { ok: false, error: "Only customers who have bought this product can review it." },
      { status: 403 },
    );
  }

  const publishNow = await getAutoPublish(shop);
  const created = await createReview(shop, product.id, customerId, parsed.review, publishNow ? "approved" : "pending");

  if (publishNow) {
    await publishProductReviews(admin.graphql, shop, product.id);
    await logActivity({
      shop,
      actor: "system",
      action: "review.auto_published",
      summary: `Published a ${parsed.review.rating}-star review by ${parsed.review.authorName} without approval, as set`,
      productId: product.id,
      details: { reviewId: created.id, photos: parsed.review.photos.length },
    });
  }

  return Response.json({ ok: true, published: publishNow });
};

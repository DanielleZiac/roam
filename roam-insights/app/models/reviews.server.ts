import { and, desc, eq } from "drizzle-orm";

import db from "../db.server";
import { products, reviews } from "../db/schema";
import { logActivity } from "./activity.server";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

const MAX_PUBLISHED = 20;

export type ReviewInput = { handle: string; rating: number; authorName: string; body: string };

/*
 * Checks a review sent from the storefront. It comes from the public internet,
 * so nothing is trusted: the rating must be a whole number from 1 to 5, text is
 * trimmed and capped, and HTML tags are removed. Returns an error message
 * the shopper can read, or the cleaned review.
 */
export function parseReviewInput(input: unknown): { ok: true; review: ReviewInput } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Something went wrong. Please try again." };
  const data = input as Record<string, unknown>;

  // A hidden field real shoppers never fill in. Automated spam usually does.
  if (typeof data.website === "string" && data.website.trim() !== "") {
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const handle = typeof data.handle === "string" ? data.handle : "";
  if (!/^[a-z0-9-]{1,255}$/.test(handle)) return { ok: false, error: "Something went wrong. Please try again." };

  const rating = Number(data.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: "Choose a rating from 1 to 5." };

  const clean = (value: unknown) =>
    typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";
  const body = clean(data.body).slice(0, 1000);
  if (body.length < 10) return { ok: false, error: "Write at least a short sentence about the product." };

  const authorName = clean(data.name).slice(0, 60) || "Anonymous";
  return { ok: true, review: { handle, rating, authorName, body } };
}

// Saves a review as pending. It is not shown on the store until approved.
export async function createReview(shop: string, input: ReviewInput) {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.shop, shop), eq(products.handle, input.handle)));
  if (!product) return false;

  await db.insert(reviews).values({
    shop,
    productId: product.id,
    rating: input.rating,
    authorName: input.authorName,
    body: input.body,
  });
  return true;
}

export function listReviews(shop: string) {
  return db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      authorName: reviews.authorName,
      body: reviews.body,
      status: reviews.status,
      createdAt: reviews.createdAt,
      productId: reviews.productId,
      productTitle: products.title,
    })
    .from(reviews)
    .innerJoin(products, eq(reviews.productId, products.id))
    .where(eq(reviews.shop, shop))
    .orderBy(desc(reviews.createdAt), desc(reviews.id));
}

const SET_METAFIELDS = `#graphql
  mutation RoamPublishReviews($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors {
        field
        message
      }
    }
  }
`;

/*
 * Publishes a product's approved reviews to the store by writing them to the
 * product's metafields: the average, the count and the latest reviews. The
 * theme reads these directly, so reviews show even when the app is not running.
 */
export async function publishProductReviews(graphql: AdminGraphql, shop: string, productId: number) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.shop, shop), eq(products.id, productId)));
  if (!product) return "Product not found";

  const approved = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.status, "approved")))
    .orderBy(desc(reviews.createdAt));

  const count = approved.length;
  const average = count > 0 ? approved.reduce((sum, review) => sum + review.rating, 0) / count : 0;
  const published = approved.slice(0, MAX_PUBLISHED).map((review) => ({
    name: review.authorName,
    rating: review.rating,
    body: review.body,
    date: review.createdAt.toISOString().slice(0, 10),
  }));

  const metafields = [
    { key: "rating", type: "number_decimal", value: average.toFixed(1) },
    { key: "rating_count", type: "number_integer", value: String(count) },
    { key: "reviews", type: "json", value: JSON.stringify(published) },
  ].map((metafield) => ({ ...metafield, ownerId: product.shopifyProductId, namespace: "roam" }));

  const response = await graphql(SET_METAFIELDS, { variables: { metafields } });
  const body = (await response.json()) as { data?: { metafieldsSet: { userErrors: { message: string }[] } } };
  const errors = body.data?.metafieldsSet.userErrors ?? [];
  if (!body.data || errors.length > 0) return errors.map((error) => error.message).join("; ") || "Shopify did not accept it";
  return null;
}

// Publishes every product's approved reviews. Used after loading sample data.
export async function publishAllReviews(graphql: AdminGraphql, shop: string) {
  const rows = await db.selectDistinct({ productId: reviews.productId }).from(reviews).where(eq(reviews.shop, shop));
  for (const row of rows) await publishProductReviews(graphql, shop, row.productId);
  return rows.length;
}

/*
 * The merchant approves or rejects a review. The product's published reviews
 * are refreshed straight away, and the decision goes in the activity log.
 */
export async function moderateReview(
  graphql: AdminGraphql,
  shop: string,
  id: number,
  decision: "approved" | "rejected",
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const [review] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.shop, shop), eq(reviews.id, id)));
  if (!review) return { ok: false, error: "Review not found" };
  if (review.status === decision) return { ok: true, message: "No change." };

  await db.update(reviews).set({ status: decision, moderatedAt: new Date() }).where(eq(reviews.id, id));

  const error = await publishProductReviews(graphql, shop, review.productId);
  if (error) {
    // Put it back, so the app never shows a decision the store did not receive.
    await db.update(reviews).set({ status: review.status, moderatedAt: review.moderatedAt }).where(eq(reviews.id, id));
    return { ok: false, error };
  }

  const [product] = await db.select({ title: products.title }).from(products).where(eq(products.id, review.productId));
  await logActivity({
    shop,
    actor: "merchant",
    action: decision === "approved" ? "review.approved" : "review.rejected",
    summary: `${decision === "approved" ? "Approved" : "Rejected"} a ${review.rating}-star review of ${product?.title ?? "a product"} by ${review.authorName}`,
    productId: review.productId,
    details: { reviewId: id, rating: review.rating, previousStatus: review.status },
  });

  return { ok: true, message: decision === "approved" ? "Review approved and published." : "Review rejected." };
}

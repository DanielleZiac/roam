import { and, desc, eq, inArray } from "drizzle-orm";

import db from "../db.server";
import { products, reviewPhotos, reviews, shopSettings } from "../db/schema";
import { logActivity } from "./activity.server";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

const MAX_PUBLISHED = 20;
const MAX_PHOTOS = 3;
// About 600 KB per photo once decoded. The storefront shrinks photos before sending them.
const MAX_PHOTO_CHARS = 800_000;

export type ReviewPhotoInput = { mimeType: string; data: string };
export type ReviewInput = {
  handle: string;
  rating: number;
  authorName: string;
  body: string;
  photos: ReviewPhotoInput[];
};

// A file's first bytes say what it really is, whatever it claims to be.
function sniffImage(base64: string): string | null {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64.slice(0, 32), "base64");
  } catch {
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function parsePhotos(input: unknown): ReviewPhotoInput[] | null {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > MAX_PHOTOS) return null;

  const photos: ReviewPhotoInput[] = [];
  for (const item of input) {
    if (typeof item !== "string" || item.length > MAX_PHOTO_CHARS) return null;
    const match = item.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return null;
    const mimeType = sniffImage(match[1]);
    if (!mimeType) return null;
    photos.push({ mimeType, data: match[1] });
  }
  return photos;
}

/*
 * Checks a review sent from the storefront. It comes from the public internet,
 * so nothing is trusted: the rating must be a whole number from 1 to 5, text
 * is trimmed, capped and stripped of HTML, and each photo
 * must really be a JPEG, PNG or WebP of a sensible size. Returns an error
 * message the shopper can read, or the cleaned review.
 */
export function parseReviewInput(input: unknown): { ok: true; review: ReviewInput } | { ok: false; error: string } {
  const generic = { ok: false as const, error: "Something went wrong. Please try again." };
  if (!input || typeof input !== "object") return generic;
  const data = input as Record<string, unknown>;

  // A hidden field real shoppers never fill in. Automated spam usually does.
  if (typeof data.website === "string" && data.website.trim() !== "") return generic;

  const handle = typeof data.handle === "string" ? data.handle : "";
  if (!/^[a-z0-9-]{1,255}$/.test(handle)) return generic;

  const rating = Number(data.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: "Choose a star rating." };

  const clean = (value: unknown) =>
    typeof value === "string" ? value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";

  // There is no name box. The storefront sends the signed-in customer's first name and last initial.
  const authorName = clean(data.name).slice(0, 60) || "Verified buyer";

  const body = clean(data.body).slice(0, 1000);
  if (body.length < 10) return { ok: false, error: "Write at least a short sentence about the product." };

  const photos = parsePhotos(data.photos);
  if (!photos) return { ok: false, error: `Add up to ${MAX_PHOTOS} photos, as JPEG, PNG or WebP.` };

  return { ok: true, review: { handle, rating, authorName, body, photos } };
}

// --- Settings -------------------------------------------------------------------

export async function getAutoPublish(shop: string) {
  const [row] = await db.select().from(shopSettings).where(eq(shopSettings.shop, shop));
  return row?.autoPublishReviews ?? false;
}

export async function setAutoPublish(shop: string, value: boolean) {
  await db
    .insert(shopSettings)
    .values({ shop, autoPublishReviews: value })
    .onDuplicateKeyUpdate({ set: { autoPublishReviews: value } });
  await logActivity({
    shop,
    actor: "merchant",
    action: "settings.reviews",
    summary: value
      ? "Reviews now appear on the store straight away"
      : "Reviews now wait for approval before they appear",
    details: { autoPublishReviews: value },
  });
}

// --- Creating and reading ---------------------------------------------------------

const CUSTOMER_ORDERS = `#graphql
  query RoamCustomerOrders($query: String!) {
    orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        cancelledAt
        lineItems(first: 50) {
          nodes {
            product {
              id
            }
          }
        }
      }
    }
  }
`;

/*
 * Buyers only: asks Shopify whether this customer has an order, not cancelled,
 * that contains this product. The customer id comes from Shopify's signed app
 * proxy request, so a shopper cannot claim to be someone else.
 */
export async function hasBought(graphql: AdminGraphql, customerId: string, shopifyProductId: string) {
  const response = await graphql(CUSTOMER_ORDERS, { variables: { query: `customer_id:${customerId}` } });
  const body = (await response.json()) as {
    data?: {
      orders: { nodes: { cancelledAt: string | null; lineItems: { nodes: { product: { id: string } | null }[] } }[] };
    };
  };
  const orders = body.data?.orders.nodes ?? [];
  return orders.some(
    (order) => !order.cancelledAt && order.lineItems.nodes.some((line) => line.product?.id === shopifyProductId),
  );
}

export async function findProductByHandle(shop: string, handle: string) {
  const [product] = await db
    .select({ id: products.id, shopifyProductId: products.shopifyProductId })
    .from(products)
    .where(and(eq(products.shop, shop), eq(products.handle, handle)));
  return product ?? null;
}

export async function hasReviewed(productId: number, customerId: string) {
  const [existing] = await db
    .select({ id: reviews.id })
    .from(reviews)
    .where(and(eq(reviews.productId, productId), eq(reviews.customerId, customerId)));
  return Boolean(existing);
}

/*
 * Saves a verified buyer's review and its photos. It is pending unless the
 * shop publishes reviews automatically.
 */
export async function createReview(
  shop: string,
  productId: number,
  customerId: string,
  input: ReviewInput,
  status: "pending" | "approved",
) {
  return db.transaction(async (tx) => {
    const [review] = await tx
      .insert(reviews)
      .values({
        shop,
        productId,
        customerId,
        verifiedBuyer: true,
        rating: input.rating,
        authorName: input.authorName,
        body: input.body,
        status,
        moderatedAt: status === "approved" ? new Date() : null,
      })
      .$returningId();

    if (input.photos.length > 0) {
      await tx.insert(reviewPhotos).values(input.photos.map((photo) => ({ reviewId: review.id, ...photo })));
    }
    return { id: review.id, productId };
  });
}

export async function listReviews(shop: string) {
  const rows = await db
    .select({
      id: reviews.id,
      rating: reviews.rating,
      authorName: reviews.authorName,
      body: reviews.body,
      status: reviews.status,
      verifiedBuyer: reviews.verifiedBuyer,
      createdAt: reviews.createdAt,
      productId: reviews.productId,
      productTitle: products.title,
    })
    .from(reviews)
    .innerJoin(products, eq(reviews.productId, products.id))
    .where(eq(reviews.shop, shop))
    .orderBy(desc(reviews.createdAt), desc(reviews.id));

  // Photos are loaded for pending reviews only, so the merchant can check them before approving.
  const pendingIds = rows.filter((row) => row.status === "pending").map((row) => row.id);
  const photos =
    pendingIds.length > 0 ? await db.select().from(reviewPhotos).where(inArray(reviewPhotos.reviewId, pendingIds)) : [];

  return rows.map((row) => ({
    ...row,
    photos: photos
      .filter((photo) => photo.reviewId === row.id)
      .map((photo) => `data:${photo.mimeType};base64,${photo.data}`),
  }));
}

// One photo, for the storefront. Only photos on approved reviews of this shop are served.
export async function getPublishedPhoto(shop: string, photoId: number) {
  const [photo] = await db
    .select({ mimeType: reviewPhotos.mimeType, data: reviewPhotos.data })
    .from(reviewPhotos)
    .innerJoin(reviews, eq(reviewPhotos.reviewId, reviews.id))
    .where(and(eq(reviewPhotos.id, photoId), eq(reviews.shop, shop), eq(reviews.status, "approved")));
  return photo ?? null;
}

// --- Publishing -------------------------------------------------------------------

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
 * theme reads these directly, so the text of reviews shows even when the app
 * is not running. Photos are listed by id and loaded through the app proxy.
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

  const latest = approved.slice(0, MAX_PUBLISHED);
  const photoRows =
    latest.length > 0
      ? await db
          .select({ id: reviewPhotos.id, reviewId: reviewPhotos.reviewId })
          .from(reviewPhotos)
          .where(
            inArray(
              reviewPhotos.reviewId,
              latest.map((review) => review.id),
            ),
          )
      : [];

  const count = approved.length;
  const average = count > 0 ? approved.reduce((sum, review) => sum + review.rating, 0) / count : 0;
  const published = latest.map((review) => ({
    name: review.authorName,
    rating: review.rating,
    body: review.body,
    verified: review.verifiedBuyer,
    date: review.createdAt.toISOString().slice(0, 10),
    photos: photoRows.filter((photo) => photo.reviewId === review.id).map((photo) => photo.id),
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
 * The merchant approves, rejects or takes down a review. The product's
 * published reviews are refreshed straight away, and the decision is logged.
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
  const verb = decision === "approved" ? "Approved" : review.status === "approved" ? "Took down" : "Rejected";
  await logActivity({
    shop,
    actor: "merchant",
    action: decision === "approved" ? "review.approved" : "review.rejected",
    summary: `${verb} a ${review.rating}-star review of ${product?.title ?? "a product"} by ${review.authorName}`,
    productId: review.productId,
    details: { reviewId: id, rating: review.rating, previousStatus: review.status },
  });

  return {
    ok: true,
    message: decision === "approved" ? "Review approved and published." : `${verb} the review.`,
  };
}

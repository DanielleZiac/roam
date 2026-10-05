import { and, count, eq } from "drizzle-orm";

import db from "../db.server";
import { eventPicks, products, suggestionEvents, type KeyFact } from "../db/schema";
import { isNeedTag, needLabel } from "../lib/needs";
import { logActivity } from "./activity.server";

type AdminGraphql = (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;

const PRODUCTS_QUERY = `#graphql
  query RoamProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        handle
        title
        productType
        tags
        descriptionHtml
      }
    }
  }
`;

type ShopifyProduct = {
  id: string;
  handle: string;
  title: string;
  productType: string;
  tags: string[];
  descriptionHtml: string;
};

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Product descriptions are one summary paragraph followed by a bullet list.
// The paragraph becomes the summary and each bullet becomes a key fact.
export function parseDescription(html: string): { summary: string | null; keyFacts: KeyFact[] } {
  const paragraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
  const bullets = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((match) => stripTags(match[1]));

  const keyFacts = bullets.filter(Boolean).map((bullet) => {
    const colon = bullet.indexOf(":");
    if (colon > 0 && colon < 40) {
      return { label: bullet.slice(0, colon).trim(), value: bullet.slice(colon + 1).trim() };
    }
    return { label: "", value: bullet };
  });

  return { summary: paragraph ? stripTags(paragraph[1]) : null, keyFacts };
}

const ADD_TAGS = `#graphql
  mutation RoamAddProductTags($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors {
        message
      }
    }
  }
`;

const REMOVE_TAGS = `#graphql
  mutation RoamRemoveProductTags($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors {
        message
      }
    }
  }
`;

/*
 * Keeps a product's Shopify tags in step with its need tags. The storefront's
 * catalog filters work on Shopify tags, so without this a need removed in the
 * app would still show up under that filter. Only tags from the need
 * vocabulary are touched: category tags and anything else are left alone.
 */
async function syncShopifyTags(graphql: AdminGraphql, shopifyProductId: string, add: string[], remove: string[]) {
  if (add.length > 0) await graphql(ADD_TAGS, { variables: { id: shopifyProductId, tags: add } });
  if (remove.length > 0) await graphql(REMOVE_TAGS, { variables: { id: shopifyProductId, tags: remove } });
}

/*
 * Copies the store's products into the app's own table.
 *
 * New products start with need tags taken from their Shopify tags and key
 * facts parsed from the description. Products the app already knows keep
 * their need tags and key facts, because the merchant may have edited them
 * here: only the title, handle and type are refreshed. For those products the
 * app is the source of truth, so their Shopify tags are corrected to match.
 */
export async function syncProducts(graphql: AdminGraphql, shop: string) {
  let cursor: string | null = null;
  let synced = 0;

  const known = new Map((await listProducts(shop)).map((product) => [product.shopifyProductId, product]));

  do {
    const response: Response = await graphql(PRODUCTS_QUERY, { variables: { cursor } });
    const body = (await response.json()) as {
      data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProduct[] } };
    };
    const page = body.data.products;

    for (const node of page.nodes) {
      const { summary, keyFacts } = parseDescription(node.descriptionHtml);
      await db
        .insert(products)
        .values({
          shop,
          shopifyProductId: node.id,
          handle: node.handle,
          title: node.title,
          productType: node.productType,
          needTags: node.tags.filter(isNeedTag),
          keyFacts,
          summary,
        })
        .onDuplicateKeyUpdate({
          set: { handle: node.handle, title: node.title, productType: node.productType },
        });

      const existing = known.get(node.id);
      if (existing) {
        const shopifyNeeds = node.tags.filter(isNeedTag) as string[];
        await syncShopifyTags(
          graphql,
          node.id,
          existing.needTags.filter((tag) => !shopifyNeeds.includes(tag)),
          shopifyNeeds.filter((tag) => !existing.needTags.includes(tag)),
        );
      }
      synced += 1;
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return synced;
}

export function listProducts(shop: string) {
  return db.select().from(products).where(eq(products.shop, shop)).orderBy(products.title);
}

export async function getProduct(shop: string, id: number) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.shop, shop), eq(products.id, id)));
  return product ?? null;
}

// How often each product was suggested by the storefront quiz, and how often
// that suggestion was added to a cart.
export async function productSuggestionStats(shop: string) {
  const rows = await db
    .select({
      productId: eventPicks.productId,
      suggested: count(),
      addedToCart: count(eventPicks.addedToCartAt),
    })
    .from(eventPicks)
    .innerJoin(suggestionEvents, eq(eventPicks.eventId, suggestionEvents.id))
    .where(eq(suggestionEvents.shop, shop))
    .groupBy(eventPicks.productId);

  return new Map(rows.filter((row) => row.productId !== null).map((row) => [row.productId as number, row]));
}

// Key facts are edited as text, one per line, written "Label: value".
export function keyFactsToText(keyFacts: KeyFact[]) {
  return keyFacts.map((fact) => (fact.label ? `${fact.label}: ${fact.value}` : fact.value)).join("\n");
}

export function textToKeyFacts(text: string): KeyFact[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((line) => {
      const colon = line.indexOf(":");
      if (colon > 0 && colon < 40) {
        return { label: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim().slice(0, 200) };
      }
      return { label: "", value: line.slice(0, 200) };
    });
}

const SET_METAFIELDS = `#graphql
  mutation RoamSetProductMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export type MatchingInput = { needTags: string[]; keyFactsText: string; summary: string };

/*
 * The create/update workflow. Saves a product's need tags, key facts and summary:
 *
 *   1. Validates the input against the need vocabulary.
 *   2. Works out what actually changed.
 *   3. Writes the new values to the product's metafields in Shopify (namespace
 *      "roam"), which is what the storefront quiz and product page read, and
 *      updates the product's Shopify tags, which the catalog filters read.
 *   4. Updates the app's own row.
 *   5. Adds an activity log entry holding the before and after values.
 *
 * Shopify is written first, so the app's table never claims a change the
 * storefront did not get. Returns what changed, or an error message.
 */
export async function updateProductMatching(
  graphql: AdminGraphql,
  shop: string,
  id: number,
  input: MatchingInput,
): Promise<{ ok: true; changed: string[] } | { ok: false; error: string }> {
  const product = await getProduct(shop, id);
  if (!product) return { ok: false, error: "Product not found" };

  const needTags = [...new Set(input.needTags.filter(isNeedTag))];
  const keyFacts = textToKeyFacts(input.keyFactsText);
  const summary = input.summary.trim().slice(0, 500) || null;

  const added = needTags.filter((tag) => !product.needTags.includes(tag));
  const removed = product.needTags.filter((tag) => !(needTags as string[]).includes(tag));
  const factsChanged = JSON.stringify(keyFacts) !== JSON.stringify(product.keyFacts);
  const summaryChanged = summary !== (product.summary ?? null);

  const changed: string[] = [];
  if (added.length > 0) changed.push(`added ${added.map(needLabel).join(", ")}`);
  if (removed.length > 0) changed.push(`removed ${removed.map(needLabel).join(", ")}`);
  if (factsChanged) changed.push("updated key facts");
  if (summaryChanged) changed.push("updated summary");
  if (changed.length === 0) return { ok: true, changed };

  const metafields = [
    { key: "need_tags", type: "list.single_line_text_field", value: JSON.stringify(needTags) },
    { key: "key_facts", type: "json", value: JSON.stringify(keyFacts) },
    // Shopify does not accept an empty text metafield, so a cleared summary is stored as a single space.
    { key: "summary", type: "multi_line_text_field", value: summary ?? " " },
  ].map((metafield) => ({ ...metafield, ownerId: product.shopifyProductId, namespace: "roam" }));

  const response = await graphql(SET_METAFIELDS, { variables: { metafields } });
  const body = (await response.json()) as {
    data?: { metafieldsSet: { userErrors: { message: string }[] } };
  };
  const errors = body.data?.metafieldsSet.userErrors ?? [];
  if (!body.data || errors.length > 0) {
    return { ok: false, error: errors.map((error) => error.message).join("; ") || "Shopify did not accept the change" };
  }

  await syncShopifyTags(graphql, product.shopifyProductId, added, removed);

  await db.update(products).set({ needTags, keyFacts, summary }).where(eq(products.id, id));

  await logActivity({
    shop,
    actor: "merchant",
    action: "product.matching_updated",
    summary: `${product.title}: ${changed.join("; ")}`,
    productId: id,
    details: {
      before: { needTags: product.needTags, keyFacts: product.keyFacts, summary: product.summary },
      after: { needTags, keyFacts, summary },
    },
  });

  return { ok: true, changed };
}

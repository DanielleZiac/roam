import { eq } from "drizzle-orm";

import db from "../db.server";
import { products, type KeyFact } from "../db/schema";
import { isNeedTag } from "../lib/needs";

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

/*
 * Copies the store's products into the app's own table.
 *
 * New products start with need tags taken from their Shopify tags and key
 * facts parsed from the description. Products the app already knows keep
 * their need tags and key facts, because the merchant may have edited them
 * here: only the title, handle and type are refreshed.
 */
export async function syncProducts(graphql: AdminGraphql, shop: string) {
  let cursor: string | null = null;
  let synced = 0;

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
      synced += 1;
    }

    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  return synced;
}

export function listProducts(shop: string) {
  return db.select().from(products).where(eq(products.shop, shop)).orderBy(products.title);
}

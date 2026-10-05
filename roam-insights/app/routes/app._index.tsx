import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { count, eq } from "drizzle-orm";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { products, suggestionEvents } from "../db/schema";
import { syncProducts } from "../models/products.server";
import { ensureQuizPage } from "../models/storefront.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  let [{ value: productCount }] = await db.select({ value: count() }).from(products).where(eq(products.shop, shop));

  // First visit: bring the store's products in, so the app has something to work with.
  if (productCount === 0) {
    productCount = await syncProducts(admin.graphql, shop);
  }

  const [{ value: eventCount }] = await db
    .select({ value: count() })
    .from(suggestionEvents)
    .where(eq(suggestionEvents.shop, shop));

  // The storefront quiz needs its page. Create it if the store does not have one yet.
  const quizPage = await ensureQuizPage(admin.graphql, shop);

  return { shop, productCount, eventCount, quizPage };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const synced = await syncProducts(admin.graphql, session.shop);
  return { synced };
};

export default function Index() {
  const { shop, productCount, eventCount, quizPage } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const syncing = fetcher.state !== "idle";

  return (
    <s-page heading="Roam Insights">
      <s-section heading="Overview">
        <s-paragraph>
          Connected to <s-text type="strong">{shop}</s-text>.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>{productCount} products tracked</s-list-item>
          <s-list-item>{eventCount} storefront suggestion events recorded</s-list-item>
          <s-list-item>
            Storefront quiz page:{" "}
            {quizPage === "exists" ? "ready" : quizPage === "created" ? "created just now" : `not ready (${quizPage})`}
          </s-list-item>
        </s-unordered-list>
        <s-stack direction="inline" gap="base">
          <s-button variant="primary" href="/app/products">
            Edit products
          </s-button>
          <s-button href="/app/activity">View activity</s-button>
          <s-button onClick={() => fetcher.submit({}, { method: "post" })} {...(syncing ? { loading: true } : {})}>
            Sync products from Shopify
          </s-button>
        </s-stack>
        {fetcher.data ? <s-paragraph>Synced {fetcher.data.synced} products.</s-paragraph> : null}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

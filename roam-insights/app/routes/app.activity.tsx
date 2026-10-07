import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { listActivity } from "../models/activity.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const entries = await listActivity(session.shop);

  return {
    entries: entries.map((entry) => ({
      id: entry.id,
      actor: entry.actor,
      action: entry.action,
      summary: entry.summary,
      productId: entry.productId,
      productTitle: entry.productTitle,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
};

const ACTION_LABELS: Record<string, string> = {
  "product.matching_updated": "Product edited",
  "product.removed": "Product removed",
  "storefront.page_created": "Page created",
  "review.approved": "Review approved",
  "review.rejected": "Review rejected",
  "review.auto_published": "Review published",
  "settings.reviews": "Setting changed",
  "alert.raised": "Alert raised",
  "alert.acknowledged": "Alert acknowledged",
  "alert.resolved": "Alert resolved",
};

export default function Activity() {
  const { entries } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Activity">
      <s-section heading="History">
        <s-paragraph>Every change made in this app, newest first.</s-paragraph>

        {entries.length === 0 ? (
          <s-paragraph>Nothing has happened yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">What happened</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>By</s-table-header>
              <s-table-header>When</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {entries.map((entry) => (
                <s-table-row key={entry.id}>
                  <s-table-cell>
                    {entry.productId ? (
                      <s-link href={`/app/products/${entry.productId}`}>{entry.summary}</s-link>
                    ) : (
                      entry.summary
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge>{ACTION_LABELS[entry.action] ?? entry.action}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{entry.actor === "merchant" ? "You" : "Roam Insights"}</s-table-cell>
                  <s-table-cell>{new Date(entry.createdAt).toLocaleString()}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

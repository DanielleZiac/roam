import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { listReviews, moderateReview, publishAllReviews } from "../models/reviews.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rows = await listReviews(session.shop);

  return {
    reviews: rows.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = (await request.json()) as { intent?: string; id?: number };

  if (body.intent === "publish_all") {
    const count = await publishAllReviews(admin.graphql, session.shop);
    return { ok: true as const, message: `Published reviews for ${count} products.` };
  }
  if ((body.intent === "approved" || body.intent === "rejected") && typeof body.id === "number") {
    return moderateReview(admin.graphql, session.shop, body.id, body.intent);
  }
  return { ok: false as const, error: "Unknown action" };
};

const stars = (rating: number) => `${"★".repeat(rating)}${"☆".repeat(5 - rating)}`;
const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function Reviews() {
  const { reviews } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const send = (body: { intent: string; id?: number }) =>
    fetcher.submit(body, { method: "post", encType: "application/json" });

  const pending = reviews.filter((review) => review.status === "pending");
  const decided = reviews.filter((review) => review.status !== "pending");
  const result = fetcher.data;

  return (
    <s-page heading="Reviews">
      {result && !busy ? (
        result.ok ? (
          <s-banner tone="success">{result.message}</s-banner>
        ) : (
          <s-banner tone="critical" heading="That did not work">
            {result.error}
          </s-banner>
        )
      ) : null}

      <s-section heading={pending.length > 0 ? `Waiting for your decision (${pending.length})` : "Waiting for your decision"}>
        <s-paragraph>
          Shoppers write reviews on product pages. Nothing appears on your store until you approve it here.
        </s-paragraph>
        {pending.length === 0 ? (
          <s-paragraph>No reviews are waiting.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {pending.map((review) => (
              <s-box key={review.id} padding="base" border="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-stack direction="inline" gap="small-200">
                    <s-text type="strong">
                      <span aria-hidden="true">{stars(review.rating)}</span> {review.rating} out of 5
                    </s-text>
                    <s-link href={`/app/products/${review.productId}`}>{review.productTitle}</s-link>
                  </s-stack>
                  <s-paragraph>{review.body}</s-paragraph>
                  <s-text color="subdued">
                    {review.authorName}, {when(review.createdAt)}
                  </s-text>
                  <s-stack direction="inline" gap="small-200">
                    <s-button variant="primary" onClick={() => send({ intent: "approved", id: review.id })}>
                      Approve and publish
                    </s-button>
                    <s-button onClick={() => send({ intent: "rejected", id: review.id })}>Reject</s-button>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Already decided">
        {decided.length === 0 ? (
          <s-paragraph>No reviews have been approved or rejected yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Review</s-table-header>
              <s-table-header>Product</s-table-header>
              <s-table-header>Rating</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Change</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {decided.map((review) => (
                <s-table-row key={review.id}>
                  <s-table-cell>
                    {review.body.length > 90 ? `${review.body.slice(0, 90)}…` : review.body} ({review.authorName})
                  </s-table-cell>
                  <s-table-cell>{review.productTitle}</s-table-cell>
                  <s-table-cell>{review.rating} of 5</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={review.status === "approved" ? "success" : "neutral"}>
                      {review.status === "approved" ? "On your store" : "Rejected"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-button
                      variant="tertiary"
                      onClick={() => send({ intent: review.status === "approved" ? "rejected" : "approved", id: review.id })}
                    >
                      {review.status === "approved" ? "Take down" : "Approve"}
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Publishing">
        <s-stack direction="block" gap="small-200">
          <s-paragraph>
            Approving a review publishes it to that product straight away. Use this button if reviews were added to
            the database another way, such as sample data.
          </s-paragraph>
          <s-button onClick={() => send({ intent: "publish_all" })} {...(busy ? { loading: true } : {})}>
            Publish all approved reviews
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

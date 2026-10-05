import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  getAutoPublish,
  listReviews,
  moderateReview,
  publishAllReviews,
  setAutoPublish,
} from "../models/reviews.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [rows, autoPublish] = await Promise.all([listReviews(session.shop), getAutoPublish(session.shop)]);

  return {
    autoPublish,
    reviews: rows.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = (await request.json()) as { intent?: string; id?: number; value?: boolean };

  if (body.intent === "auto_publish" && typeof body.value === "boolean") {
    await setAutoPublish(session.shop, body.value);
    return {
      ok: true as const,
      message: body.value
        ? "New reviews will now appear on your store straight away."
        : "New reviews will now wait for your approval.",
    };
  }

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
  const { reviews, autoPublish } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const send = (body: { intent: string; id?: number; value?: boolean }) =>
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
          Only signed-in customers who bought a product can review it.{" "}
          {autoPublish
            ? "Their reviews appear on your store as soon as they are sent. You can still take any review down below."
            : "Nothing appears on your store until you approve it here."}
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
                    {review.verifiedBuyer ? <s-badge tone="success">Verified buyer</s-badge> : null}
                  </s-stack>
                  <s-paragraph>{review.body}</s-paragraph>
                  {review.photos.length > 0 ? (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {review.photos.map((photo, index) => (
                        <img
                          key={index}
                          src={photo}
                          alt={`Photo ${index + 1} attached to this review`}
                          style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 8, border: "1px solid #e3e3e3" }}
                        />
                      ))}
                    </div>
                  ) : null}
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

      <s-section slot="aside" heading="Approval">
        <s-stack direction="block" gap="small-200">
          <s-paragraph>
            <s-text type="strong">{autoPublish ? "Off." : "On."}</s-text>{" "}
            {autoPublish
              ? "Reviews and their photos go live without you seeing them first."
              : "You read each review and its photos before shoppers can see them."}
          </s-paragraph>
          <s-paragraph>
            Checking first keeps spam, abuse and unsuitable photos off your store. Turning it off is faster, but
            anything a shopper sends will show until you take it down.
          </s-paragraph>
          <s-button onClick={() => send({ intent: "auto_publish", value: !autoPublish })}>
            {autoPublish ? "Check reviews before they appear" : "Let reviews appear straight away"}
          </s-button>
        </s-stack>
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

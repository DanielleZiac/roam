import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { count, eq } from "drizzle-orm";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { products } from "../db/schema";
import { acknowledgeAlert, ALERT_RULES, evaluateAlerts, listAlerts } from "../models/alerts.server";
import { getDashboard } from "../models/insights.server";
import { syncProducts } from "../models/products.server";
import { ensureQuizPage } from "../models/storefront.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // First visit: bring the store's products in, so the app has something to work with.
  const [{ value: productCount }] = await db.select({ value: count() }).from(products).where(eq(products.shop, shop));
  if (productCount === 0) await syncProducts(admin.graphql, shop);

  // The storefront quiz needs its page, and the alerts should reflect the latest data.
  const quizPage = await ensureQuizPage(admin.graphql, shop);
  await evaluateAlerts(shop);

  const [dashboard, allAlerts] = await Promise.all([getDashboard(shop), listAlerts(shop)]);

  return {
    shop,
    quizPage,
    dashboard,
    rules: ALERT_RULES,
    alerts: allAlerts
      .filter((alert) => alert.status !== "resolved")
      .map((alert) => ({
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        status: alert.status,
        message: alert.message,
        productId: alert.productId,
      })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = (await request.json()) as { intent?: string; alertId?: number };

  if (body.intent === "acknowledge" && typeof body.alertId === "number") {
    await acknowledgeAlert(session.shop, body.alertId);
    return { message: "Alert acknowledged." };
  }

  const synced = await syncProducts(admin.graphql, session.shop);
  return { message: `Synced ${synced} products.` };
};

export default function Index() {
  const { shop, quizPage, dashboard, alerts, rules } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const send = (body: { intent: string; alertId?: number }) =>
    fetcher.submit(body, { method: "post", encType: "application/json" });

  const topNeeds = dashboard.needs.filter((need) => need.selections > 0);
  const ranking = dashboard.ranking.slice(0, 8);

  return (
    <s-page heading="Roam Insights">
      <s-button slot="primary-action" variant="primary" href="/app/products">
        Edit products
      </s-button>

      {fetcher.data && !busy ? <s-banner tone="success">{fetcher.data.message}</s-banner> : null}
      {quizPage !== "exists" && quizPage !== "created" ? (
        <s-banner tone="warning" heading="The storefront quiz page is not ready">
          {quizPage}
        </s-banner>
      ) : null}

      <s-section heading={`Last ${dashboard.windowDays} days`}>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">Quiz results</s-text>
              <s-heading>{dashboard.events}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">Products suggested</s-text>
              <s-heading>{dashboard.suggested}</s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">Suggestions added to cart</s-text>
              <s-heading>
                {dashboard.addedToCart} ({dashboard.cartRatePercent}%)
              </s-heading>
            </s-stack>
          </s-box>
          <s-box padding="base" border="base" borderRadius="base">
            <s-stack direction="block" gap="small-200">
              <s-text color="subdued">Open alerts</s-text>
              <s-heading>{alerts.length}</s-heading>
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      <s-section heading="Alerts">
        {alerts.length === 0 ? (
          <s-paragraph>
            Nothing needs attention. Alerts appear when shoppers keep choosing a need few products cover, or when a
            product is suggested often but rarely added to a cart.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {alerts.map((alert) => (
              <s-banner
                key={alert.id}
                tone={alert.severity === "high" ? "critical" : "warning"}
                heading={alert.type === "unmet_need" ? "Unmet need" : "Suggested but not chosen"}
              >
                <s-stack direction="block" gap="small-200">
                  <s-paragraph>{alert.message}</s-paragraph>
                  <s-stack direction="inline" gap="small-200">
                    {alert.status === "open" ? (
                      <s-button onClick={() => send({ intent: "acknowledge", alertId: alert.id })}>Acknowledge</s-button>
                    ) : (
                      <s-badge>Acknowledged</s-badge>
                    )}
                    <s-button href={alert.productId ? `/app/products/${alert.productId}` : "/app/products"}>
                      {alert.productId ? "Open product" : "Review product tags"}
                    </s-button>
                  </s-stack>
                </s-stack>
              </s-banner>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="What shoppers ask for">
        {topNeeds.length === 0 ? (
          <s-paragraph>No quiz results yet. They appear here as shoppers use Tell us about you.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Need or goal</s-table-header>
              <s-table-header format="numeric">Quiz results</s-table-header>
              <s-table-header format="numeric">Share</s-table-header>
              <s-table-header format="numeric">Products tagged</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {topNeeds.map((need) => (
                <s-table-row key={need.tag}>
                  <s-table-cell>
                    {need.label} {need.kind === "goal" ? <s-badge>Goal</s-badge> : null}
                  </s-table-cell>
                  <s-table-cell>{need.selections}</s-table-cell>
                  <s-table-cell>{need.sharePercent}%</s-table-cell>
                  <s-table-cell>{need.matchingProducts}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="Suggestions that convert">
        <s-paragraph>
          Products ranked by how often a suggestion ends up in a cart. Rates are steadied toward the shop average, so a
          product with only a few suggestions cannot top the list by luck.
        </s-paragraph>
        {ranking.length === 0 ? (
          <s-paragraph>No suggestions yet.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header format="numeric">Rank</s-table-header>
              <s-table-header listSlot="primary">Product</s-table-header>
              <s-table-header format="numeric">Suggested</s-table-header>
              <s-table-header format="numeric">Added to cart</s-table-header>
              <s-table-header format="numeric">Rate</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {ranking.map((product, index) => (
                <s-table-row key={product.id}>
                  <s-table-cell>{index + 1}</s-table-cell>
                  <s-table-cell>
                    <s-link href={`/app/products/${product.id}`}>{product.title}</s-link>
                  </s-table-cell>
                  <s-table-cell>{product.suggested}</s-table-cell>
                  <s-table-cell>{product.addedToCart}</s-table-cell>
                  <s-table-cell>{product.ratePercent}%</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Store">
        <s-stack direction="block" gap="small-200">
          <s-paragraph>
            Connected to <s-text type="strong">{shop}</s-text>
          </s-paragraph>
          <s-paragraph>
            {dashboard.productCount} products tracked
            {dashboard.untaggedProducts > 0 ? `, ${dashboard.untaggedProducts} without need tags` : ""}
          </s-paragraph>
          <s-button onClick={() => send({ intent: "sync" })} {...(busy ? { loading: true } : {})}>
            Sync products from Shopify
          </s-button>
          <s-button href="/app/activity">View activity</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How alerts work">
        <s-unordered-list>
          <s-list-item>
            Unmet need: chosen at least {rules.MIN_SELECTIONS} times with no product tagged, or with{" "}
            {rules.THIN_COVERAGE} or fewer tagged while it appears in {Math.round(rules.MIN_SHARE * 100)}% or more of
            results.
          </s-list-item>
          <s-list-item>
            Suggested but not chosen: suggested at least {rules.MIN_SUGGESTED} times and added to a cart less than{" "}
            {Math.round(rules.LOW_RATE * 100)}% of the time.
          </s-list-item>
          <s-list-item>Alerts clear themselves once the numbers no longer meet the rule.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

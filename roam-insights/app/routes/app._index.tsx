import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { count, eq } from "drizzle-orm";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { products } from "../db/schema";
import { acknowledgeAlert, evaluateAlerts, listAlerts } from "../models/alerts.server";
import { getDashboard } from "../models/insights.server";
import { syncProducts } from "../models/products.server";
import { ensureQuizPage } from "../models/storefront.server";
import { CHART_COLORS, ColumnChart, Legend, PairedBars, RateBars, StatTile } from "../components/charts";

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
    return { message: "Marked as seen." };
  }

  const synced = await syncProducts(admin.graphql, session.shop);
  return { message: `Synced ${synced} products.` };
};

// Turns a percentage into words a person would say: "about 1 in 4".
function oneIn(percent: number) {
  if (percent <= 0) return "none";
  if (percent >= 90) return "almost all";
  if (percent >= 45 && percent <= 55) return "about half";
  return `about 1 in ${Math.max(2, Math.round(100 / percent))}`;
}

const COVERAGE = {
  none: { label: "Nothing in stock", tone: "critical" },
  short: { label: "Short on products", tone: "warning" },
  balanced: { label: "About right", tone: "success" },
  plenty: { label: "Well covered", tone: "info" },
  no_demand: { label: "Not asked for yet", tone: "neutral" },
} as const;

const PERFORMANCE = {
  strong: { label: "Shoppers want this", tone: "success" },
  average: { label: "Doing fine", tone: "neutral" },
  weak: { label: "Rarely chosen", tone: "warning" },
  too_early: { label: "Too early to say", tone: "neutral" },
} as const;

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" });

export default function Index() {
  const { shop, quizPage, dashboard, alerts } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const send = (body: { intent: string; alertId?: number }) =>
    fetcher.submit(body, { method: "post", encType: "application/json" });

  const needs = dashboard.needs.filter((need) => need.kind === "need");
  const goals = dashboard.needs.filter((need) => need.kind === "goal" && need.selections > 0);
  const topNeed = needs.find((need) => need.selections > 0);
  const shortNeeds = needs.filter((need) => need.verdict === "short" || need.verdict === "none");
  const judged = dashboard.ranking.filter((product) => product.verdict !== "too_early");
  const best = judged[0];
  const worst = judged.length > 1 ? judged[judged.length - 1] : undefined;
  const hasData = dashboard.events > 0;
  const untagged = dashboard.untaggedProducts;
  const todo = alerts.length + (untagged > 0 ? 1 : 0);

  const change = dashboard.thisWeek - dashboard.lastWeek;
  const trendNote =
    dashboard.lastWeek === 0
      ? `${dashboard.thisWeek} in the past week`
      : change === 0
        ? `${dashboard.thisWeek} this week, same as last week`
        : `${dashboard.thisWeek} this week, ${Math.abs(change)} ${change > 0 ? "more" : "fewer"} than last week`;

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

      {!hasData ? (
        <s-section heading="Waiting for your first shoppers">
          <s-paragraph>
            Nobody has used the Tell us about you quiz yet. Once shoppers do, this page shows what they are looking for,
            where your catalog falls short, and which suggestions work.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          <s-section heading={`Last ${dashboard.windowDays} days`}>
            <s-stack direction="block" gap="base">
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap="base">
                <StatTile label="Shoppers who took the quiz" value={String(dashboard.events)} note={trendNote} />
                <StatTile
                  label="Most common need"
                  value={topNeed ? topNeed.label : "None yet"}
                  note={topNeed ? `${oneIn(topNeed.sharePercent)} shoppers` : undefined}
                />
                <StatTile
                  label="Suggestions added to cart"
                  value={`${dashboard.cartRatePercent}%`}
                  note={`${dashboard.addedToCart} of ${dashboard.suggested} suggestions`}
                />
                <StatTile
                  label="Things to act on"
                  value={String(todo)}
                  note={todo === 0 ? "All clear" : "See What to do next"}
                />
              </s-grid>

              <s-heading>Quiz results per day</s-heading>
              <ColumnChart
                data={dashboard.daily.map((point) => ({ label: shortDate(point.day), value: point.results }))}
                description={`Column chart of quiz results per day over the last ${dashboard.windowDays} days, ${dashboard.events} in total.`}
              />
            </s-stack>
          </s-section>

          <s-section heading="What to do next">
            {todo === 0 ? (
              <s-paragraph>Nothing needs your attention right now.</s-paragraph>
            ) : (
              <s-stack direction="block" gap="base">
                {alerts.map((alert) => (
                  <s-banner
                    key={alert.id}
                    tone={alert.severity === "high" ? "critical" : "warning"}
                    heading={
                      alert.type === "unmet_need"
                        ? "Shoppers want more than you stock"
                        : "A product is suggested but not chosen"
                    }
                  >
                    <s-stack direction="block" gap="small-200">
                      <s-paragraph>{alert.message}</s-paragraph>
                      <s-paragraph>
                        <s-text type="strong">Do this: </s-text>
                        {alert.type === "unmet_need"
                          ? "add products for this need, or tag products you already sell that help with it."
                          : "check its need tags, then its price, photos and description."}
                      </s-paragraph>
                      <s-stack direction="inline" gap="small-200">
                        <s-button href={alert.productId ? `/app/products/${alert.productId}` : "/app/products"}>
                          {alert.productId ? "Open this product" : "Review product tags"}
                        </s-button>
                        {alert.status === "open" ? (
                          <s-button
                            variant="tertiary"
                            onClick={() => send({ intent: "acknowledge", alertId: alert.id })}
                          >
                            Mark as seen
                          </s-button>
                        ) : (
                          <s-badge>Seen</s-badge>
                        )}
                      </s-stack>
                    </s-stack>
                  </s-banner>
                ))}
                {untagged > 0 ? (
                  <s-banner tone="info" heading="Some products can never be suggested">
                    <s-stack direction="block" gap="small-200">
                      <s-paragraph>
                        {untagged} {untagged === 1 ? "product has" : "products have"} no need tags, so the quiz cannot
                        suggest {untagged === 1 ? "it" : "them"}.
                      </s-paragraph>
                      <s-button href="/app/products">Add need tags</s-button>
                    </s-stack>
                  </s-banner>
                ) : null}
              </s-stack>
            )}
          </s-section>

          <s-section heading="Do you stock what shoppers ask for?">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {shortNeeds.length > 0 ? (
                  <>
                    <s-text type="strong">
                      You are short on products for {shortNeeds.map((need) => need.label).join(" and ")}.
                    </s-text>{" "}
                    Where the purple bar is much longer than the green one, more shoppers are asking than your catalog
                    serves.
                  </>
                ) : (
                  "Your catalog is in step with what shoppers ask for. The purple and green bars are close for every need."
                )}
              </s-paragraph>
              <Legend
                items={[
                  { label: "Shoppers asking for it", color: CHART_COLORS.demand },
                  { label: "Share of your products", color: CHART_COLORS.stock },
                ]}
              />
              <PairedBars
                firstLabel="Shoppers asking"
                secondLabel="Share of your products"
                rows={needs.map((need) => ({
                  key: need.tag,
                  label: need.label,
                  first: need.sharePercent,
                  second: need.stockPercent,
                  firstText: `${need.sharePercent}% (${need.selections})`,
                  secondText: `${need.stockPercent}% (${need.matchingProducts})`,
                  aside: <s-badge tone={COVERAGE[need.verdict].tone}>{COVERAGE[need.verdict].label}</s-badge>,
                }))}
              />
              {goals.length > 0 ? (
                <s-paragraph>
                  <s-text type="strong">What they want gear for: </s-text>
                  {goals.map((goal) => `${goal.label} ${goal.sharePercent}%`).join(", ")}.
                </s-paragraph>
              ) : null}
            </s-stack>
          </s-section>

          <s-section heading="Which suggestions do shoppers act on?">
            <s-stack direction="block" gap="base">
              <s-paragraph>
                {best && worst && best.id !== worst.id ? (
                  <>
                    <s-text type="strong">{best.title} does best</s-text> and {worst.title} is shown often but rarely
                    chosen.{" "}
                  </>
                ) : null}
                Each bar is how often a suggested product was added to a cart. The dark line marks your average of{" "}
                {dashboard.cartRatePercent}%.
              </s-paragraph>
              <RateBars
                average={dashboard.cartRatePercent}
                rows={dashboard.ranking.map((product) => ({
                  key: String(product.id),
                  label: <s-link href={`/app/products/${product.id}`}>{product.title}</s-link>,
                  percent: product.ratePercent,
                  text: `${product.ratePercent}% (${product.addedToCart}/${product.suggested})`,
                  weak: product.verdict === "weak",
                  aside: (
                    <s-badge tone={PERFORMANCE[product.verdict].tone}>{PERFORMANCE[product.verdict].label}</s-badge>
                  ),
                }))}
              />
            </s-stack>
          </s-section>
        </>
      )}

      <s-section slot="aside" heading="Your store">
        <s-stack direction="block" gap="small-200">
          <s-paragraph>
            Connected to <s-text type="strong">{shop}</s-text>
          </s-paragraph>
          <s-paragraph>{dashboard.productCount} products tracked</s-paragraph>
          <s-button onClick={() => send({ intent: "sync" })} {...(busy ? { loading: true } : {})}>
            Sync products from Shopify
          </s-button>
          <s-button href="/app/activity">View activity</s-button>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How this works">
        <s-unordered-list>
          <s-list-item>Shoppers answer a short quiz on your store and get product suggestions.</s-list-item>
          <s-list-item>
            The app records which needs were chosen and which products were shown. Nothing identifies a shopper.
          </s-list-item>
          <s-list-item>Suggestions depend on each product&apos;s need tags, which you edit under Products.</s-list-item>
          <s-list-item>Everything here covers the last {dashboard.windowDays} days.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

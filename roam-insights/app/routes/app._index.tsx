import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { and, count, eq } from "drizzle-orm";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { products, reviews } from "../db/schema";
import { acknowledgeAlert, evaluateAlerts, listAlerts } from "../models/alerts.server";
import { getDashboard, PERIODS, type Period, type RankedProduct } from "../models/insights.server";
import { countStoreProducts, syncProducts } from "../models/products.server";
import { ensureQuizPage } from "../models/storefront.server";
import {
  CHART_COLORS,
  ChartCard,
  ColumnChart,
  HalfPie,
  Legend,
  MarkerBar,
  OverlapBar,
  PieChart,
  RateBars,
  Stars,
  StatGrid,
  StatTile,
} from "../components/charts";
import { NeedIcon } from "../components/need-icon";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // Bring the store's products in on the first visit, and again whenever the
  // store has gained or lost products since the last sync.
  const [[{ value: productCount }], storeCount] = await Promise.all([
    db.select({ value: count() }).from(products).where(eq(products.shop, shop)),
    countStoreProducts(admin.graphql),
  ]);
  if (productCount === 0 || (storeCount !== null && storeCount !== productCount)) {
    await syncProducts(admin.graphql, shop);
  }

  // The storefront quiz needs its page, and the alerts should reflect the latest data.
  const quizPage = await ensureQuizPage(admin.graphql, shop);
  await evaluateAlerts(shop);

  // The period comes from the address, e.g. /app?days=90, so a reload or a shared link keeps it.
  const asked = new URL(request.url).searchParams.get("days");
  const period: Period = PERIODS.find((option) => option === asked) ?? "30";

  const [dashboard, allAlerts, [{ value: pendingReviews }]] = await Promise.all([
    getDashboard(shop, period),
    listAlerts(shop),
    db
      .select({ value: count() })
      .from(reviews)
      .where(and(eq(reviews.shop, shop), eq(reviews.status, "pending"))),
  ]);

  return {
    shop,
    quizPage,
    dashboard,
    pendingReviews,
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

// In pixels. The charts column is just wide enough for four tiles with their titles on one line.
// Change these to make the two columns wider or narrower.
const MAIN_COLUMN_WIDTH = 900;
const SIDE_COLUMN_WIDTH = 300;

// How each period reads in a heading and in the middle of a sentence.
const PERIOD_LABELS: Record<Period, { button: string; heading: string; inSentence: string }> = {
  "7": { button: "7 days", heading: "Last 7 days", inSentence: "the last 7 days" },
  "30": { button: "30 days", heading: "Last 30 days", inSentence: "the last 30 days" },
  "90": { button: "90 days", heading: "Last 90 days", inSentence: "the last 90 days" },
  all: { button: "All time", heading: "All time", inSentence: "all time" },
};

const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" });

// The columns that sort the table when their heading is clicked, in the order they appear.
const SORT_COLUMNS = [
  { key: "ratePercent", label: "Rate" },
  { key: "suggested", label: "Suggested" },
  { key: "addedToCart", label: "Added to cart" },
] as const;

type SortKey = (typeof SORT_COLUMNS)[number]["key"];

const cell = { padding: "8px 12px", borderBottom: "1px solid #ebebeb", verticalAlign: "middle" } as const;
const headCell = { ...cell, background: "#f7f7f7", fontWeight: 550, textAlign: "left" } as const;
const numberCell = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
// Header controls look like header text until they are hovered or focused.
const headControl = {
  font: "inherit",
  fontWeight: 550,
  color: "inherit",
  background: "none",
  border: 0,
  padding: 0,
  cursor: "pointer",
} as const;

/*
 * Every product the quiz has suggested. The controls live in the header row:
 * search under Product, a sort toggle on Rate, Suggested and Added to cart, and the
 * performance filter on the Performance heading.
 */
function SuggestionTable({ ranking }: { ranking: RankedProduct[] }) {
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState("all");
  const [filterFocused, setFilterFocused] = useState(false);
  // No sort means the ranking's own order: best first.
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean } | null>(null);

  // First click sorts high to low, the second low to high, the third goes back to best first.
  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current?.key !== key ? { key, descending: true } : current.descending ? { key, descending: false } : null,
    );

  const words = query.trim().toLowerCase();
  const rows = ranking.filter(
    (product) =>
      (verdict === "all" || product.verdict === verdict) &&
      (words === "" || product.title.toLowerCase().includes(words) || product.group.toLowerCase().includes(words)),
  );
  if (sort) rows.sort((a, b) => (sort.descending ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key]));
  const mostSuggested = Math.max(1, ...ranking.map((product) => product.suggested));

  return (
    <s-stack direction="block" gap="small-200">
      <Legend
        items={[
          { label: "Suggested", color: CHART_COLORS.suggested },
          { label: "Added to cart", color: CHART_COLORS.added },
        ]}
      />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: CHART_COLORS.text }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...headCell, minWidth: 220 }}>
                {/* The column keeps its name for screen readers; on screen the search box stands in for it. */}
                <span style={{ position: "absolute", left: -9999 }}>Product</span>
                {/* React 18 does not pass input events from Polaris fields to onInput, so this is a plain DOM listener. */}
                <s-search-field
                  label="Search products"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search products"
                  value={query}
                  ref={(field: HTMLElement | null) => {
                    if (field) field.oninput = (event) => setQuery((event.currentTarget as HTMLInputElement).value);
                  }}
                />
              </th>
              {SORT_COLUMNS.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}
                    style={
                      column.key === "ratePercent"
                        ? { ...headCell, width: "32%", minWidth: 200 }
                        : { ...headCell, textAlign: "right", whiteSpace: "nowrap" }
                    }
                  >
                    <button type="button" onClick={() => toggleSort(column.key)} style={headControl}>
                      {column.label} <span aria-hidden="true">{active ? (sort.descending ? "↓" : "↑") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
              <th scope="col" style={{ ...headCell, whiteSpace: "nowrap" }}>
                {/* The heading itself is the filter: an unseen select lies over it, so a click opens the options. */}
                <div
                  style={{
                    position: "relative",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    borderRadius: 4,
                    outline: filterFocused ? "2px solid #005bd3" : "none",
                    outlineOffset: 2,
                  }}
                >
                  {/* The badges in the rows show which performance is chosen, so the heading only says a filter is on. */}
                  <span>Performance{verdict === "all" ? "" : " (filtered)"}</span>
                  <span aria-hidden="true">▾</span>
                  <select
                    aria-label="Show performance"
                    value={verdict}
                    onChange={(event) => setVerdict(event.currentTarget.value)}
                    onFocus={() => setFilterFocused(true)}
                    onBlur={() => setFilterFocused(false)}
                    style={{ position: "absolute", inset: 0, width: "100%", opacity: 0, cursor: "pointer", font: "inherit" }}
                  >
                    <option value="all">All</option>
                    {Object.entries(PERFORMANCE).map(([value, { label }]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.id}>
                <td style={cell}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: "none" }}>
                      <NeedIcon group={product.group} />
                    </span>
                    <s-link href={`/app/products/${product.id}`}>{product.title}</s-link>
                  </div>
                </td>
                <td style={cell}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 40px", gap: 8, alignItems: "center" }}>
                    <OverlapBar outer={product.suggested} inner={product.addedToCart} scale={mostSuggested} />
                    <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{product.ratePercent}%</span>
                  </div>
                </td>
                <td style={numberCell}>{product.suggested}</td>
                <td style={numberCell}>{product.addedToCart}</td>
                <td style={cell}>
                  <s-badge tone={PERFORMANCE[product.verdict].tone}>{PERFORMANCE[product.verdict].label}</s-badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div role="status">
        <s-text color="subdued">
          {rows.length === 0
            ? "No products match. Try a different search or performance filter."
            : `Showing ${rows.length} of ${ranking.length} suggested products`}
        </s-text>
      </div>
    </s-stack>
  );
}

// How urgent each coverage verdict is, most urgent first, for ordering the coverage table.
const COVERAGE_ORDER = ["none", "short", "balanced", "plenty", "no_demand"];

type NeedCoverage = {
  tag: string;
  label: string;
  selections: number;
  sharePercent: number;
  stockPercent: number;
  verdict: keyof typeof COVERAGE;
};

/*
 * One row per need: the bar is the share of shoppers asking for it and the dark
 * marker is the share of the catalog that serves it. Needs the store is short
 * on come first.
 */
function CoverageTable({ needs }: { needs: NeedCoverage[] }) {
  const rows = [...needs].sort(
    (a, b) =>
      COVERAGE_ORDER.indexOf(a.verdict) - COVERAGE_ORDER.indexOf(b.verdict) || b.selections - a.selections,
  );
  const scale = Math.max(10, ...needs.flatMap((need) => [need.sharePercent, need.stockPercent]));

  return (
    <s-stack direction="block" gap="small-200">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 13, color: CHART_COLORS.text }}>
        <Legend items={[{ label: "Shoppers asking for it", color: CHART_COLORS.demand }]} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 3, height: 16, borderRadius: 2, background: CHART_COLORS.text }} aria-hidden="true" />
          Share of your products
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: CHART_COLORS.text }}>
          <thead>
            <tr>
              <th scope="col" style={{ ...headCell, minWidth: 200 }}>
                Need
              </th>
              <th scope="col" style={{ ...headCell, width: "32%", minWidth: 200 }}>
                Asking compared with stock
              </th>
              <th scope="col" style={{ ...headCell, textAlign: "right", whiteSpace: "nowrap" }}>
                Shoppers asking
              </th>
              <th scope="col" style={{ ...headCell, textAlign: "right", whiteSpace: "nowrap" }}>
                Your products
              </th>
              <th scope="col" style={headCell}>
                Coverage
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((need) => (
              <tr key={need.tag}>
                <td style={cell}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ flex: "none" }}>
                      <NeedIcon group={need.tag} decorative />
                    </span>
                    {need.label}
                  </div>
                </td>
                <td style={cell}>
                  <MarkerBar value={need.sharePercent} marker={need.stockPercent} scale={scale} />
                </td>
                <td style={numberCell}>{need.sharePercent}%</td>
                <td style={numberCell}>{need.stockPercent}%</td>
                <td style={cell}>
                  <s-badge tone={COVERAGE[need.verdict].tone}>{COVERAGE[need.verdict].label}</s-badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </s-stack>
  );
}

export default function Index() {
  const { shop, quizPage, dashboard, alerts, pendingReviews } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const send = (body: { intent: string; alertId?: number }) =>
    fetcher.submit(body, { method: "post", encType: "application/json" });

  const needs = dashboard.needs.filter((need) => need.kind === "need");
  const goals = dashboard.needs.filter((need) => need.kind === "goal" && need.selections > 0);
  const shortNeeds = needs.filter((need) => need.verdict === "short" || need.verdict === "none");
  const judged = dashboard.ranking.filter((product) => product.verdict !== "too_early");
  const best = judged[0];
  const worst = judged.length > 1 ? judged[judged.length - 1] : undefined;
  const topRate = Math.max(0, ...judged.map((product) => product.ratePercent));
  // One row of the best and weakest chart: the product, its bar, and the numbers behind it.
  const performerRow = (product: (typeof judged)[number], weak: boolean) => ({
    key: String(product.id),
    label: <s-link href={`/app/products/${product.id}`}>{product.title.replace(/^Roam /, "")}</s-link>,
    percent: product.ratePercent,
    text: `${product.ratePercent}% (${product.addedToCart}/${product.suggested})`,
    weak,
    aside: null,
  });
  const hasData = dashboard.events > 0;
  const periodLabel = PERIOD_LABELS[dashboard.period];
  const untagged = dashboard.untaggedProducts;
  const todo = alerts.length + (untagged > 0 ? 1 : 0) + (pendingReviews > 0 ? 1 : 0);

  const change = dashboard.thisWeek - dashboard.lastWeek;
  const trendNote =
    dashboard.lastWeek === 0
      ? `${dashboard.thisWeek} in the past week`
      : change === 0
        ? `${dashboard.thisWeek} this week,\nsame as last week`
        : `${dashboard.thisWeek} this week,\n${Math.abs(change)} ${change > 0 ? "more" : "fewer"} than last week`;

  return (
    <s-page heading="Roam Insights" inlineSize="large">
      <s-button slot="primary-action" variant="primary" href="/app/products">
        Edit products
      </s-button>

      {fetcher.data && !busy ? <s-banner tone="success">{fetcher.data.message}</s-banner> : null}
      {quizPage !== "exists" && quizPage !== "created" ? (
        <s-banner tone="warning" heading="The storefront quiz page is not ready">
          {quizPage}
        </s-banner>
      ) : null}

      {/*
        A full-width page has no built-in side column, so the page lays out its own:
        the charts and the two help boxes side by side, centred on the screen, stacked when there is less room.
      */}
      <div style={{ containerType: "inline-size" }}>
        <style>{`
          .roam-columns, .roam-main, .roam-side { display: grid; gap: 16px; min-width: 0; grid-template-columns: minmax(0, 1fr); }
          .roam-columns { max-width: ${MAIN_COLUMN_WIDTH}px; margin: 0 auto; }
          @container (min-width: 900px) {
            .roam-columns {
              max-width: none;
              grid-template-columns: minmax(0, ${MAIN_COLUMN_WIDTH}px) ${SIDE_COLUMN_WIDTH}px;
              justify-content: center;
              align-items: start;
            }
          }
        `}</style>
        <div className="roam-columns">
          <div className="roam-main">
            {dashboard.everUsed ? (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text>Show:</s-text>
                {(Object.keys(PERIOD_LABELS) as Period[]).map((option) => (
                  <s-button
                    key={option}
                    href={`/app?days=${option}`}
                    variant={option === dashboard.period ? "primary" : "secondary"}
                    accessibilityLabel={`Show ${PERIOD_LABELS[option].inSentence}${option === dashboard.period ? ", selected" : ""}`}
                  >
                    {PERIOD_LABELS[option].button}
                  </s-button>
                ))}
              </s-stack>
            ) : null}

            {!dashboard.everUsed ? (
              <s-section heading="Waiting for your first shoppers">
                <s-paragraph>
                  Nobody has used the Tell us about you quiz yet. Once shoppers do, this page shows what they are looking for,
                  where your catalog falls short, and which suggestions work.
                </s-paragraph>
              </s-section>
            ) : !hasData ? (
              <s-section heading={`No quiz results in ${periodLabel.inSentence}`}>
                <s-paragraph>Nobody finished the quiz in this period. Choose a longer one above.</s-paragraph>
              </s-section>
            ) : (
              <>
                <s-section heading={`${periodLabel.heading} at a glance`}>
                  <s-stack direction="block" gap="base">
                    <StatGrid>
                      <StatTile label="Quiz results" value={String(dashboard.events)} note={trendNote} />
                      <StatTile
                        label="Shoppers with no match"
                        value={String(dashboard.noMatch)}
                        note={dashboard.noMatch === 0 ? "Everyone got a suggestion" : "The quiz found nothing for them"}
                      />
                      <StatTile
                        label="Average review"
                        visual={dashboard.averageRating === null ? undefined : <Stars rating={dashboard.averageRating} />}
                        value={dashboard.averageRating === null ? "None yet" : `${dashboard.averageRating.toFixed(1)} / 5`}
                        note={`${dashboard.approvedReviews} approved, ${pendingReviews} waiting`}
                      />
                      <StatTile
                        label="Suggestions added to cart"
                        visual={
                          <HalfPie
                            percent={dashboard.cartRatePercent}
                            description={`${dashboard.cartRatePercent}% of suggestions were added to a cart.`}
                          />
                        }
                        note={`${dashboard.addedToCart} of ${dashboard.suggested} suggestions`}
                      />
                    </StatGrid>

                    <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="base">
                      <PieChart
                        label="What shoppers add to cart"
                        data={dashboard.cartAddsByGroup}
                        description={`Pie chart of suggestions added to a cart by need group: ${dashboard.cartAddsByGroup
                          .map((slice) => `${slice.label} ${slice.value}`)
                          .join(", ")}.`}
                        emptyText="No suggestions have been added to a cart yet."
                      />
                      <PieChart
                        label="What shoppers want to do"
                        data={goals.map((goal) => ({ label: goal.label, value: goal.selections }))}
                        description={`Pie chart of the goals shoppers picked in the quiz: ${goals
                          .map((goal) => `${goal.label} ${goal.selections}`)
                          .join(", ")}.`}
                        emptyText="No shopper has picked a goal yet."
                      />
                    </s-grid>

                    {judged.length > 1 ? (
                      <ChartCard label="Best and weakest performers: suggestions added to cart">
                        <RateBars
                          average={dashboard.cartRatePercent}
                          max={topRate}
                          rows={judged.slice(0, 2).map((product) => performerRow(product, false))}
                        />
                        {/* The dots stand for every product ranked between the two best and the two weakest. */}
                        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0" }}>
                          <span
                            style={{ fontSize: 18, lineHeight: 1, letterSpacing: 2, color: CHART_COLORS.muted }}
                            aria-hidden="true"
                          >
                            ⋮
                          </span>
                          <s-button
                            variant="tertiary"
                            onClick={() => {
                              // Scrolls to the full table further down, and moves keyboard focus there too.
                              const table = document.getElementById("all-suggestions");
                              table?.scrollIntoView({ behavior: "smooth", block: "start" });
                              table?.focus({ preventScroll: true });
                            }}
                          >
                            See all products
                          </s-button>
                        </div>
                        <RateBars
                          average={dashboard.cartRatePercent}
                          max={topRate}
                          rows={judged.slice(Math.max(2, judged.length - 2)).map((product) => performerRow(product, true))}
                        />
                      </ChartCard>
                    ) : null}

                    <s-heading>Quiz results per day</s-heading>
                    <ColumnChart
                      data={dashboard.daily.map((point) => ({ label: shortDate(point.day), value: point.results }))}
                      description={`Column chart of quiz results per day over ${periodLabel.inSentence}, ${dashboard.events} in total.`}
                    />
                  </s-stack>
                </s-section>

                <s-section accessibilityLabel="What to do next">
                  <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-heading>What to do next</s-heading>
                    {todo > 0 ? <s-badge tone="critical">{todo}</s-badge> : null}
                  </s-stack>
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
                                : "check its need tags, price, photos and description."}
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
                      {pendingReviews > 0 ? (
                        <s-banner tone="info" heading="Reviews are waiting for you">
                          <s-stack direction="block" gap="small-200">
                            <s-paragraph>
                              {pendingReviews} {pendingReviews === 1 ? "review is" : "reviews are"} waiting. Shoppers only
                              see a review after you approve it.
                            </s-paragraph>
                            <s-button href="/app/reviews">Read and decide</s-button>
                          </s-stack>
                        </s-banner>
                      ) : null}
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
                  </s-stack>
                </s-section>

                <s-section heading="Do you stock what shoppers ask for?">
                  <s-stack direction="block" gap="base">
                    <s-paragraph>
                      {shortNeeds.length > 0 ? (
                        <>
                          <s-text type="strong">
                            You are short on products for {shortNeeds.map((need) => need.label).join(" and ")}.
                          </s-text>{" "}
                          Where a bar runs well past its dark marker, more shoppers are asking than your catalog serves.
                        </>
                      ) : (
                        "Your catalog is in step with what shoppers ask for. Every bar ends close to its dark marker."
                      )}
                    </s-paragraph>
                    <CoverageTable needs={needs} />
                  </s-stack>
                </s-section>

                <s-section heading="Which suggestions do shoppers act on?">
                  <s-stack direction="block" gap="base">
                    <div id="all-suggestions" tabIndex={-1} style={{ scrollMarginTop: 72, outline: "none" }}>
                      <s-paragraph>
                        {best && worst && best.id !== worst.id ? (
                          <>
                            <s-text type="strong">{best.title} does best</s-text> and {worst.title} is shown often but rarely
                            chosen.{" "}
                          </>
                        ) : null}
                        The rate is how often a suggested product was added to a cart. Your average is{" "}
                        {dashboard.cartRatePercent}%.
                      </s-paragraph>
                    </div>
                    <SuggestionTable ranking={dashboard.ranking} />
                  </s-stack>
                </s-section>
              </>
            )}
          </div>
          <div className="roam-side">
            <s-section heading="Your store">
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

            <s-section heading="How this works">
              <s-unordered-list>
                <s-list-item>Shoppers answer a short quiz on your store and get product suggestions.</s-list-item>
                <s-list-item>
                  The app records which needs were chosen and which products were shown. Nothing identifies a shopper.
                </s-list-item>
                <s-list-item>Suggestions depend on each product&apos;s need tags, which you edit under Products.</s-list-item>
                <s-list-item>
                    The charts and tables cover {periodLabel.inSentence}. Alerts always look at the last 30 days.
                  </s-list-item>
              </s-unordered-list>
            </s-section>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

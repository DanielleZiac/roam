import { useEffect, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { discountedCents, discountError, isDiscountKind, type DiscountKind } from "../lib/discounts";
import {
  applyDiscount,
  changeDiscounts,
  listCatalog,
  listTimedDiscounts,
  runDueDiscounts,
  stopTimedDiscount,
  type CatalogProduct,
} from "../models/discounts.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Start or end anything that is due first, so the prices below are the ones shoppers see.
  await runDueDiscounts(admin.graphql, session.shop);
  const [catalog, timed] = await Promise.all([listCatalog(admin.graphql), listTimedDiscounts(session.shop)]);

  return {
    ...catalog,
    timed: timed.map((discount) => ({
      id: discount.id,
      kind: discount.kind,
      value: Number(discount.value),
      productIds: discount.productIds,
      status: discount.status,
      startsAt: discount.startsAt.toISOString(),
      endsAt: discount.endsAt?.toISOString() ?? null,
    })),
  };
};

// A date sent by the form, or null if it was left empty or cannot be read.
function readDate(value: unknown) {
  if (typeof value !== "string" || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = (await request.json()) as {
    productIds?: unknown;
    kind?: unknown;
    value?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
    id?: unknown;
  };
  const productIds = Array.isArray(body.productIds)
    ? body.productIds.filter((id): id is string => typeof id === "string")
    : [];

  if (body.kind === "remove") return changeDiscounts(admin.graphql, session.shop, productIds, { kind: "remove" });
  if (body.kind === "stop" && typeof body.id === "number") {
    return stopTimedDiscount(admin.graphql, session.shop, body.id);
  }
  if (isDiscountKind(body.kind)) {
    return applyDiscount(
      admin.graphql,
      session.shop,
      productIds,
      { kind: body.kind, value: Number(body.value) },
      { startsAt: readDate(body.startsAt), endsAt: readDate(body.endsAt) },
    );
  }
  return { ok: false as const, error: "Unknown action" };
};

const SALE_FILTERS = [
  { value: "all", label: "All prices" },
  { value: "sale", label: "Discounted" },
  { value: "full", label: "Full price" },
] as const;

// Which products the form's discount goes to.
const SCOPES = [
  { value: "selected", label: "Products I tick" },
  { value: "category", label: "Every product in a category" },
  { value: "price", label: "Products in a price range" },
  { value: "all", label: "The whole catalog" },
] as const;
type Scope = (typeof SCOPES)[number]["value"];

const cell = { padding: "8px 12px", borderBottom: "1px solid #ebebeb", verticalAlign: "middle" } as const;
const headCell = { ...cell, background: "#f7f7f7", fontWeight: 550, textAlign: "left" } as const;
const numberCell = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const filterSelect = {
  font: "inherit",
  padding: "5px 8px",
  border: "1px solid #8a8a8a",
  borderRadius: 8,
  background: "#fff",
} as const;

const dateInput = { ...filterSelect, width: "100%", boxSizing: "border-box" } as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

// A product's lowest price, and what that variant cost before any discount.
function lowest(product: CatalogProduct) {
  return product.variants.reduce((low, variant) => (variant.priceCents < low.priceCents ? variant : low));
}

export default function Discounts() {
  const { products, currencyCode, timed } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sale, setSale] = useState<(typeof SALE_FILTERS)[number]["value"]>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope>("selected");
  const [scopeCategory, setScopeCategory] = useState("");
  const [priceFrom, setPriceFrom] = useState("");
  const [priceTo, setPriceTo] = useState("");
  const [kind, setKind] = useState<DiscountKind>("percent");
  const [amount, setAmount] = useState("");
  // Both are in the merchant's own time zone, as typed. Empty means "now" and "until I remove it".
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  // A finished change clears the selection and the form, ready for the next one. Going back to
  // ticked products means a second press cannot repeat a change to a whole category by accident.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setSelected(new Set());
      setScope("selected");
      setAmount("");
      setStartsAt("");
      setEndsAt("");
    }
  }, [fetcher.state, fetcher.data]);

  const money = (cents: number) =>
    new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).format(cents / 100);

  const categories = [...new Set(products.map((product) => product.productType).filter(Boolean))].sort();
  const words = query.trim().toLowerCase();
  const rows = products.filter(
    (product) =>
      (category === "all" || product.productType === category) &&
      (sale === "all" || product.onSale === (sale === "sale")) &&
      (words === "" || product.title.toLowerCase().includes(words) || product.productType.toLowerCase().includes(words)),
  );

  /*
   * The products the form's condition picks out. A condition is checked against the whole
   * catalog, not only the rows the search and filters show. A price range goes by the price
   * before any discount, so a product does not drop out of its range once it is on sale.
   */
  const inCategory = scopeCategory || categories[0] || "";
  const fromCents = priceFrom.trim() === "" ? 0 : Number(priceFrom) * 100;
  const toCents = priceTo.trim() === "" ? Infinity : Number(priceTo) * 100;
  const chosen = products.filter((product) => {
    if (scope === "selected") return selected.has(product.id);
    if (scope === "category") return product.productType === inCategory;
    if (scope === "price") {
      if (priceFrom.trim() === "" && priceTo.trim() === "") return false;
      const full = lowest(product).originalCents;
      return full >= fromCents && full <= toCents;
    }
    return true;
  });
  const chosenIds = new Set(chosen.map((product) => product.id));
  const ticking = scope === "selected";

  const allShownSelected = rows.length > 0 && rows.every((product) => chosenIds.has(product.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const toggleShown = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const product of rows) allShownSelected ? next.delete(product.id) : next.add(product.id);
      return next;
    });

  const value = Number(amount);
  const formError = amount.trim() === "" ? null : discountError(kind, value);
  const ready = amount.trim() !== "" && formError === null;
  const chosenOnSale = chosen.filter((product) => product.onSale).length;
  // Selected products the discount is too big for. The server skips these too.
  const tooBig = ready
    ? chosen.filter((product) =>
        product.variants.some((variant) => discountedCents(variant.originalCents, kind, value) === null),
      )
    : [];

  const starts = startsAt === "" ? null : new Date(startsAt);
  const ends = endsAt === "" ? null : new Date(endsAt);
  const later = starts !== null && starts > new Date();
  const periodError =
    ends !== null && ends <= new Date()
      ? "The end must be in the future."
      : ends !== null && starts !== null && ends <= starts
        ? "The end must be after the start."
        : null;

  const describe = (discount: { kind: DiscountKind; value: number }) =>
    discount.kind === "percent" ? `${discount.value}% off` : `${money(discount.value * 100)} off`;
  // What is planned for each product: the discount waiting to start on it, and when its running one ends.
  const upcoming = new Map<string, string>();
  const ending = new Map<string, string>();
  for (const discount of timed) {
    for (const id of discount.productIds) {
      if (discount.status === "scheduled") {
        if (!upcoming.has(id)) upcoming.set(id, `${describe(discount)} from ${when(discount.startsAt)}`);
      } else if (discount.endsAt) ending.set(id, `until ${when(discount.endsAt)}`);
    }
  }

  const send = (body: { kind: DiscountKind | "remove" | "stop"; value?: number; startsAt?: string; endsAt?: string; id?: number }) =>
    fetcher.submit({ ...body, productIds: [...chosenIds] }, { method: "post", encType: "application/json" });

  return (
    <s-page heading="Discounts">
      {result && !busy ? (
        result.ok ? (
          <s-banner tone={result.skipped.length > 0 ? "warning" : "success"} heading={result.message}>
            {result.skipped.length > 0 ? `Skipped: ${result.skipped.join("; ")}.` : null}
          </s-banner>
        ) : (
          <s-banner tone="critical" heading="Not changed">
            {result.error}
          </s-banner>
        )
      ) : null}

      <s-section heading="Catalog">
        <s-paragraph>
          Choose what to discount in the form: products you tick here, a whole category, a price range or the whole
          catalog. The lower price shows on the storefront for every shopper, with the old price crossed out.
          Shoppers do not need a code.
        </s-paragraph>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "12px 0" }}>
          <div style={{ flex: "1 1 220px" }}>
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
          </div>
          <select
            aria-label="Filter by category"
            value={category}
            onChange={(event) => setCategory(event.currentTarget.value)}
            style={filterSelect}
          >
            <option value="all">All categories</option>
            {categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by discount"
            value={sale}
            onChange={(event) => setSale(event.currentTarget.value as typeof sale)}
            style={filterSelect}
          >
            {SALE_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: "#303030" }}>
            <thead>
              <tr>
                <th scope="col" style={{ ...headCell, width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Select every product shown"
                    checked={allShownSelected}
                    disabled={rows.length === 0 || !ticking}
                    onChange={toggleShown}
                  />
                </th>
                <th scope="col" style={headCell}>
                  Product
                </th>
                <th scope="col" style={headCell}>
                  Category
                </th>
                <th scope="col" style={{ ...headCell, textAlign: "right" }}>
                  Price
                </th>
                <th scope="col" style={headCell}>
                  Discount
                </th>
                <th scope="col" style={{ ...headCell, textAlign: "right", whiteSpace: "nowrap" }}>
                  New price
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((product) => {
                const low = lowest(product);
                const from = product.variants.some((variant) => variant.priceCents !== low.priceCents) ? "From " : "";
                const isSelected = chosenIds.has(product.id);
                const preview = isSelected && ready ? discountedCents(low.originalCents, kind, value) : null;
                const checkboxId = `discount-${product.id.split("/").pop()}`;
                return (
                  <tr key={product.id} style={isSelected ? { background: "#f2f7fe" } : undefined}>
                    <td style={cell}>
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={isSelected}
                        disabled={!ticking}
                        onChange={() => toggle(product.id)}
                      />
                    </td>
                    <td style={cell}>
                      <label htmlFor={checkboxId} style={ticking ? { cursor: "pointer" } : undefined}>
                        {product.title}
                      </label>
                    </td>
                    <td style={cell}>{product.productType}</td>
                    <td style={numberCell}>
                      {from}
                      {money(low.priceCents)}
                      {low.priceCents < low.originalCents ? (
                        <>
                          {" "}
                          <s style={{ color: "#616161" }}>
                            <span style={{ position: "absolute", left: -9999 }}>Was </span>
                            {money(low.originalCents)}
                          </s>
                        </>
                      ) : null}
                    </td>
                    <td style={cell}>
                      <s-stack direction="block" gap="small-400">
                        {product.onSale ? (
                          <s-stack direction="inline" gap="small-200">
                            <s-badge tone="success">{product.percentOff}% off</s-badge>
                            {ending.has(product.id) ? <s-text color="subdued">{ending.get(product.id)}</s-text> : null}
                          </s-stack>
                        ) : null}
                        {upcoming.has(product.id) ? <s-badge tone="info">{upcoming.get(product.id)}</s-badge> : null}
                      </s-stack>
                    </td>
                    <td style={numberCell}>
                      {isSelected && ready ? (preview === null ? "Too big" : `${from}${money(preview)}`) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div role="status" style={{ marginTop: 8 }}>
          <s-text color="subdued">
            {rows.length === 0
              ? "No products match. Try a different search or filter."
              : `Showing ${rows.length} of ${products.length} products`}
          </s-text>
        </div>
      </s-section>

      <s-section slot="aside" heading="Discount">
        <s-stack direction="block" gap="base">
          {/* As with the search box, the fields report changes through plain DOM listeners. */}
          <s-select
            label="Apply to"
            value={scope}
            ref={(field: HTMLElement | null) => {
              if (field) field.onchange = (event) => setScope((event.currentTarget as HTMLSelectElement).value as Scope);
            }}
          >
            {SCOPES.map((option) => (
              <s-option key={option.value} value={option.value}>
                {option.label}
              </s-option>
            ))}
          </s-select>

          {scope === "category" ? (
            <s-select
              label="Category"
              value={inCategory}
              ref={(field: HTMLElement | null) => {
                if (field) field.onchange = (event) => setScopeCategory((event.currentTarget as HTMLSelectElement).value);
              }}
            >
              {categories.map((name) => (
                <s-option key={name} value={name}>
                  {name}
                </s-option>
              ))}
            </s-select>
          ) : null}

          {scope === "price" ? (
            <s-stack direction="block" gap="small-200">
              <s-number-field
                label={`Full price from (${currencyCode})`}
                min={0}
                value={priceFrom}
                ref={(field: HTMLElement | null) => {
                  if (field) field.oninput = (event) => setPriceFrom((event.currentTarget as HTMLInputElement).value);
                }}
              />
              <s-number-field
                label={`Full price up to (${currencyCode})`}
                details="Leave either one empty for no limit on that side."
                min={0}
                value={priceTo}
                ref={(field: HTMLElement | null) => {
                  if (field) field.oninput = (event) => setPriceTo((event.currentTarget as HTMLInputElement).value);
                }}
              />
            </s-stack>
          ) : null}

          <div role="status">
            <s-text type="strong">
              {chosen.length === 0
                ? ticking
                  ? "No products ticked"
                  : "No products match"
                : `${chosen.length} ${chosen.length === 1 ? "product" : "products"} ${ticking ? "ticked" : "will change"}`}
            </s-text>
          </div>

          <s-select
            label="Type"
            value={kind}
            ref={(field: HTMLElement | null) => {
              if (field) {
                field.onchange = (event) => {
                  const chosenKind = (event.currentTarget as HTMLSelectElement).value;
                  if (isDiscountKind(chosenKind)) setKind(chosenKind);
                };
              }
            }}
          >
            <s-option value="percent">Percentage off</s-option>
            <s-option value="amount">Fixed amount off</s-option>
          </s-select>

          <s-number-field
            label={kind === "percent" ? "Percentage" : `Amount (${currencyCode})`}
            details={
              kind === "percent"
                ? "Taken off the full price and rounded to a whole amount."
                : "Taken off the full price of each product."
            }
            min={0}
            {...(kind === "percent" ? { max: 99, suffix: "%" } : {})}
            {...(formError ? { error: formError } : {})}
            value={amount}
            ref={(field: HTMLElement | null) => {
              if (field) field.oninput = (event) => setAmount((event.currentTarget as HTMLInputElement).value);
            }}
          />

          {tooBig.length > 0 ? (
            <s-text tone="critical">
              Too big for {tooBig.length === 1 ? tooBig[0].title : `${tooBig.length} of these products`}. They will be
              skipped.
            </s-text>
          ) : null}

          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              Starts
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.currentTarget.value)}
                style={dateInput}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
              Ends
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.currentTarget.value)}
                aria-invalid={periodError !== null}
                style={dateInput}
              />
            </label>
            <div role="status">
              <s-text {...(periodError ? { tone: "critical" as const } : { color: "subdued" as const })}>
                {periodError ??
                  `Starts ${later ? when(starts.toISOString()) : "now"} and ${
                    ends ? `ends ${when(ends.toISOString())}` : "stays until you remove it"
                  }. Leave a date empty to start now or to have no end.`}
              </s-text>
            </div>
          </div>

          <s-button
            variant="primary"
            onClick={() =>
              send({ kind, value, startsAt: later ? starts.toISOString() : "", endsAt: ends ? ends.toISOString() : "" })
            }
            {...(busy ? { loading: true } : {})}
            {...(!ready || periodError || chosen.length === 0 || tooBig.length === chosen.length
              ? { disabled: true }
              : {})}
          >
            {later ? "Schedule discount" : "Apply discount"}
            {chosen.length > 1 ? ` for ${chosen.length} products` : ""}
          </s-button>
          <s-button
            onClick={() => send({ kind: "remove" })}
            {...(busy || chosenOnSale === 0 ? { disabled: true } : {})}
          >
            {chosenOnSale > 0 ? `Remove discount from ${chosenOnSale}` : "Remove discount"}
          </s-button>

          <s-text color="subdued">
            A new discount replaces the one a product already has. Every change is recorded in Activity.
          </s-text>
        </s-stack>
      </s-section>

      {timed.length > 0 ? (
        <s-section slot="aside" heading="Timed discounts">
          <s-stack direction="block" gap="base">
            {timed.map((discount) => (
              <s-box key={discount.id} padding="small" border="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-stack direction="inline" gap="small-200">
                    <s-text type="strong">{describe(discount)}</s-text>
                    <s-badge tone={discount.status === "active" ? "success" : "info"}>
                      {discount.status === "active" ? "Running" : "Scheduled"}
                    </s-badge>
                  </s-stack>
                  <s-text>
                    {discount.productIds.length} {discount.productIds.length === 1 ? "product" : "products"}.{" "}
                    {discount.status === "active" ? "Started" : "Starts"} {when(discount.startsAt)}
                    {discount.endsAt ? `, ends ${when(discount.endsAt)}` : ", no end"}.
                  </s-text>
                  <s-button
                    onClick={() => send({ kind: "stop", id: discount.id })}
                    {...(busy ? { disabled: true } : {})}
                  >
                    {discount.status === "active" ? "End now" : "Cancel"}
                  </s-button>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

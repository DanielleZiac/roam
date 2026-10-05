import { useRef } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { NEEDS } from "../lib/needs";
import { getProduct, keyFactsToText, updateProductMatching } from "../models/products.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const product = await getProduct(session.shop, Number(params.id));
  if (!product) throw new Response("Product not found", { status: 404 });

  return {
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      needTags: product.needTags,
      keyFactsText: keyFactsToText(product.keyFacts),
      summary: product.summary ?? "",
    },
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const body = (await request.json()) as { needTags?: unknown; keyFactsText?: unknown; summary?: unknown };

  return updateProductMatching(admin.graphql, session.shop, Number(params.id), {
    needTags: Array.isArray(body.needTags) ? body.needTags.filter((tag): tag is string => typeof tag === "string") : [],
    keyFactsText: typeof body.keyFactsText === "string" ? body.keyFactsText : "",
    summary: typeof body.summary === "string" ? body.summary : "",
  });
};

type Checkable = HTMLElementTagNameMap["s-checkbox"];
type Field = HTMLElementTagNameMap["s-text-area"];

export default function ProductEdit() {
  const { product } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const saving = fetcher.state !== "idle";

  // The form is read when Save is pressed, straight from the fields.
  const tagRefs = useRef(new Map<string, Checkable>());
  const factsRef = useRef<Field>(null);
  const summaryRef = useRef<Field>(null);

  function save() {
    const needTags = NEEDS.filter((need) => tagRefs.current.get(need.tag)?.checked).map((need) => need.tag);
    fetcher.submit(
      { needTags, keyFactsText: factsRef.current?.value ?? "", summary: summaryRef.current?.value ?? "" },
      { method: "post", encType: "application/json" },
    );
  }

  const result = fetcher.data;

  return (
    <s-page heading={product.title}>
      <s-link slot="breadcrumb-actions" href="/app/products">
        Products
      </s-link>
      <s-button slot="primary-action" variant="primary" onClick={save} {...(saving ? { loading: true } : {})}>
        Save
      </s-button>

      {result && !saving ? (
        result.ok ? (
          <s-banner tone="success" heading={result.changed.length > 0 ? "Saved" : "Nothing to save"}>
            {result.changed.length > 0
              ? `Changes: ${result.changed.join("; ")}. The storefront now uses these values.`
              : "No values were changed."}
          </s-banner>
        ) : (
          <s-banner tone="critical" heading="Not saved">
            {result.error}
          </s-banner>
        )
      ) : null}

      <s-section heading="Need tags">
        <s-paragraph>
          Tick every need this product helps with. The storefront quiz suggests it to shoppers who choose those needs.
        </s-paragraph>
        <s-stack direction="block" gap="base">
          {(["need", "goal"] as const).map((kind) => (
            <s-stack key={kind} direction="block" gap="small-200">
              <s-heading>{kind === "need" ? "Who it helps" : "What it is for"}</s-heading>
              {NEEDS.filter((need) => need.kind === kind).map((need) => (
                <s-checkbox
                  key={need.tag}
                  label={need.label}
                  defaultChecked={product.needTags.includes(need.tag)}
                  ref={(element: Checkable | null) => {
                    if (element) tagRefs.current.set(need.tag, element);
                  }}
                />
              ))}
            </s-stack>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Key facts">
        <s-text-area
          label="One fact per line"
          details="Write each as Label: value, for example Weight: 5.8 kg. Shown in the Key facts card on the product page."
          rows={7}
          defaultValue={product.keyFactsText}
          ref={factsRef}
        />
      </s-section>

      <s-section heading="Plain-language summary">
        <s-text-area
          label="Summary"
          details="One or two short sentences, shown under the price."
          rows={3}
          maxLength={500}
          defaultValue={product.summary}
          ref={summaryRef}
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { needLabel } from "../lib/needs";
import { listProducts, productSuggestionStats } from "../models/products.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [rows, stats] = await Promise.all([listProducts(session.shop), productSuggestionStats(session.shop)]);

  return {
    products: rows.map((product) => {
      const stat = stats.get(product.id);
      return {
        id: product.id,
        title: product.title,
        productType: product.productType,
        needTags: product.needTags,
        keyFactCount: product.keyFacts.length,
        suggested: stat?.suggested ?? 0,
        addedToCart: stat?.addedToCart ?? 0,
      };
    }),
  };
};

export default function ProductsIndex() {
  const { products } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Products">
      <s-section heading="Need tags and key facts">
        <s-paragraph>
          Need tags decide which products the storefront quiz suggests. Open a product to edit its tags, key facts and
          summary.
        </s-paragraph>

        <s-table>
          <s-table-header-row>
            <s-table-header listSlot="primary">Product</s-table-header>
            <s-table-header>Need tags</s-table-header>
            <s-table-header format="numeric">Key facts</s-table-header>
            <s-table-header format="numeric">Suggested</s-table-header>
            <s-table-header format="numeric">Added to cart</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {products.map((product) => (
              <s-table-row key={product.id}>
                <s-table-cell>
                  <s-link href={`/app/products/${product.id}`}>{product.title}</s-link>
                </s-table-cell>
                <s-table-cell>
                  {product.needTags.length === 0 ? (
                    <s-badge tone="warning">No need tags</s-badge>
                  ) : (
                    <s-stack direction="inline" gap="small-200">
                      {product.needTags.map((tag) => (
                        <s-badge key={tag}>{needLabel(tag)}</s-badge>
                      ))}
                    </s-stack>
                  )}
                </s-table-cell>
                <s-table-cell>{product.keyFactCount}</s-table-cell>
                <s-table-cell>{product.suggested}</s-table-cell>
                <s-table-cell>{product.addedToCart}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

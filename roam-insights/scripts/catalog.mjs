/*
 * Brings the store's catalog in line with the files in ../store-data:
 *
 *   1. Creates any product in products.csv that the store does not have yet.
 *   2. Uploads the photos listed in product-photos.json (files live in
 *      ../product-images) to their products, with alt text.
 *
 *   npm run catalog
 *
 * Safe to run again: products that exist are not recreated, and a product that
 * already has photos is left alone. Run it after opening the app once, so the
 * app has access to the store.
 *
 * New products are created but not shown on the storefront: the app is not
 * allowed to publish to sales channels. In the Shopify admin, open Products,
 * tick the new ones, then choose "Include in sales channels" > Online Store.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL || "mysql://roam:roam_local_dev@127.0.0.1:3306/roam_insights";
const API_VERSION = "2025-10";
const root = (path) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

const connection = await mysql.createConnection(DATABASE_URL);
const [[session]] = await connection.query("SELECT shop, accessToken FROM session WHERE isOnline = 0 LIMIT 1");
await connection.end();
if (!session) {
  console.error("No shop found. Open the app in the Shopify admin once, then run this again.");
  process.exit(1);
}

async function graphql(query, variables = {}) {
  const response = await fetch(`https://${session.shop}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors) {
    throw new Error(`Shopify said ${response.status}: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.data;
}

function check(result, what) {
  if (result.userErrors.length > 0) {
    throw new Error(`${what}: ${result.userErrors.map((error) => error.message).join("; ")}`);
  }
  return result;
}

// Reads a CSV with quoted fields into one object per row, keyed by the header row.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field || row.length > 0) rows.push([...row, field]);
  const [header, ...lines] = rows.filter((line) => line.length > 1);
  return lines.map((line) => Object.fromEntries(header.map((name, index) => [name, line[index] ?? ""])));
}

// Sends one local photo to Shopify's upload storage and returns the address Shopify can fetch it from.
async function uploadPhoto(file) {
  const bytes = await readFile(root(`product-images/${file}`));
  const { stagedUploadsCreate } = await graphql(
    `mutation RoamStagePhoto($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { message }
      }
    }`,
    { input: [{ filename: file, mimeType: "image/jpeg", resource: "IMAGE", httpMethod: "POST", fileSize: String(bytes.length) }] },
  );
  const [target] = check(stagedUploadsCreate, `Preparing ${file}`).stagedTargets;

  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), file);
  const response = await fetch(target.url, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Uploading ${file} failed with ${response.status}`);
  return target.resourceUrl;
}

const { products } = await graphql(`{
  products(first: 250) {
    nodes { id handle media(first: 1) { nodes { id } } }
  }
}`);
const store = new Map(products.nodes.map((product) => [product.handle, product]));

// 1. Products in the CSV that the store is missing.
const rows = parseCsv(await readFile(root("store-data/products.csv"), "utf8"));
for (const row of rows) {
  if (store.has(row.Handle)) continue;

  const { productCreate } = await graphql(
    `mutation RoamCreateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id handle variants(first: 1) { nodes { id } } }
        userErrors { message }
      }
    }`,
    {
      product: {
        handle: row.Handle,
        title: row.Title,
        descriptionHtml: row["Body (HTML)"],
        vendor: row.Vendor,
        productType: row.Type,
        tags: row.Tags.split(",").map((tag) => tag.trim()),
        status: row.Status.toUpperCase(),
      },
    },
  );
  const { product } = check(productCreate, `Creating ${row.Title}`);

  const { productVariantsBulkUpdate } = await graphql(
    `mutation RoamSetVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { message }
      }
    }`,
    {
      productId: product.id,
      variants: [
        {
          id: product.variants.nodes[0].id,
          price: row["Variant Price"],
          taxable: row["Variant Taxable"] === "TRUE",
          inventoryPolicy: row["Variant Inventory Policy"].toUpperCase(),
          inventoryItem: {
            sku: row["Variant SKU"],
            tracked: false,
            requiresShipping: row["Variant Requires Shipping"] === "TRUE",
            measurement: { weight: { value: Number(row["Variant Grams"]), unit: "GRAMS" } },
          },
        },
      ],
    },
  );
  check(productVariantsBulkUpdate, `Pricing ${row.Title}`);

  store.set(product.handle, { ...product, media: { nodes: [] } });
  console.log(`Created ${row.Title}`);
}

// 2. Photos for products that have none yet.
const photos = JSON.parse(await readFile(root("store-data/product-photos.json"), "utf8"));
for (const { handle, images } of photos) {
  const product = store.get(handle);
  if (!product) {
    console.warn(`Skipped ${handle}: no product with that handle.`);
    continue;
  }
  if (product.media.nodes.length > 0) continue;

  const media = [];
  for (const image of images) {
    media.push({ originalSource: await uploadPhoto(image.file), alt: image.alt, mediaContentType: "IMAGE" });
  }
  const { productUpdate } = await graphql(
    `mutation RoamAddPhotos($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
      productUpdate(product: $product, media: $media) {
        userErrors { message }
      }
    }`,
    { product: { id: product.id }, media },
  );
  check(productUpdate, `Adding photos to ${handle}`);
  console.log(`Added ${images.length} photo${images.length === 1 ? "" : "s"} to ${handle}`);
}

console.log("Catalog is up to date.");

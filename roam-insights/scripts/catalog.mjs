/*
 * Brings the store's catalog in line with the files in ../store-data:
 *
 *   1. Creates any product in products.csv that the store does not have yet,
 *      and updates the description and price of products where the CSV differs.
 *   2. Makes each product's photos match product-photos.json (files live in
 *      ../product-images), with alt text. A product whose photos already match
 *      is left alone; otherwise its photos are replaced.
 *
 *   npm run catalog
 *
 * Safe to run again. It never deletes a product: one that is in the store but
 * not in the CSV is only reported. Run it after opening the app once, so the
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

// Shopify stores HTML with its own line breaks between tags, so compare without them.
function sameHtml(a, b) {
  const tidy = (html) => html.replace(/>\s+</g, "><").trim();
  return tidy(a) === tidy(b);
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
    nodes { id handle descriptionHtml variants(first: 1) { nodes { id price } } media(first: 20) { nodes { id alt } } }
  }
}`);
const store = new Map(products.nodes.map((product) => [product.handle, product]));

// 1. Products in the CSV that the store is missing, and descriptions that changed.
const rows = parseCsv(await readFile(root("store-data/products.csv"), "utf8"));
for (const row of rows) {
  const existing = store.get(row.Handle);
  if (existing) {
    if (sameHtml(existing.descriptionHtml, row["Body (HTML)"]) === false) {
      const { productUpdate } = await graphql(
        `mutation RoamUpdateDescription($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            userErrors { message }
          }
        }`,
        { product: { id: existing.id, descriptionHtml: row["Body (HTML)"] } },
      );
      check(productUpdate, `Updating ${row.Title}`);
      console.log(`Updated the description of ${row.Title}`);
    }
    const [variant] = existing.variants.nodes;
    if (Number(variant.price) !== Number(row["Variant Price"])) {
      const { productVariantsBulkUpdate } = await graphql(
        `mutation RoamSetPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            userErrors { message }
          }
        }`,
        { productId: existing.id, variants: [{ id: variant.id, price: row["Variant Price"] }] },
      );
      check(productVariantsBulkUpdate, `Pricing ${row.Title}`);
      console.log(`Changed the price of ${row.Title} from ${Number(variant.price)} to ${row["Variant Price"]}`);
    }
    continue;
  }

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

const inCsv = new Set(rows.map((row) => row.Handle));
for (const handle of store.keys()) {
  if (!inCsv.has(handle)) console.warn(`In the store but not in products.csv: ${handle}`);
}

// 2. Photos. The alt texts, in order, tell us whether a product already has the listed photos.
const photos = JSON.parse(await readFile(root("store-data/product-photos.json"), "utf8"));
for (const { handle, images } of photos) {
  const product = store.get(handle);
  if (!product) {
    console.warn(`Skipped ${handle}: no product with that handle.`);
    continue;
  }
  const current = product.media.nodes;
  if (current.length === images.length && current.every((media, index) => media.alt === images[index].alt)) continue;

  const media = [];
  for (const image of images) {
    media.push({ originalSource: await uploadPhoto(image.file), alt: image.alt, mediaContentType: "IMAGE" });
  }

  if (current.length > 0) {
    const { productDeleteMedia } = await graphql(
      `mutation RoamRemovePhotos($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          mediaUserErrors { message }
        }
      }`,
      { productId: product.id, mediaIds: current.map((item) => item.id) },
    );
    if (productDeleteMedia.mediaUserErrors.length > 0) {
      throw new Error(`Removing old photos from ${handle}: ${productDeleteMedia.mediaUserErrors[0].message}`);
    }
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
  console.log(`Set ${images.length} photo${images.length === 1 ? "" : "s"} on ${handle}`);
}

console.log("Catalog is up to date.");

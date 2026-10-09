# Roam

Roam is an assistive technology shop for young disabled people in the Philippines: mobility, hearing, vision, speech and dexterity gear, sold like sportswear and priced in pesos.

This repository holds both parts of the take-home:

| Part | Folder | What it is |
|---|---|---|
| Storefront theme | `theme/` | A Shopify theme in Liquid, CSS and a small amount of JavaScript |
| Admin app | `roam-insights/` | **Roam Insights**, an embedded Shopify admin app (React Router on Vite, Node.js, Drizzle ORM, MySQL) |
| Catalog data | `store-data/`, `product-images/` | The product list, photo list and photos the store is built from |

The reasoning behind the store concept, the app and the schema is in [APP_DECISIONS.md](APP_DECISIONS.md).

## See it running

- **Storefront:** https://roam-igo4wyyh.myshopify.com
- **Storefront password:** `roamaround`
- **Admin app:** installed on the `roam` development store as "roam-insights". It runs from a local server, so it is shown live in the demo.

## What to look at

### Theme

- **Pages:** home, catalog and collection, product, cart, contact, and the "Find my gear" quiz.
- **Standout feature, 
 - "Tell us about you":** an optional four-question quiz at `/pages/find-my-gear`. It scores every product against the shopper's answers in the browser, shows the top four with the reason each was picked, and keeps the answers on the device.
- **Accessibility panel:** dyslexia-friendly text and "Read it to me" (the browser's own speech), remembered between visits. The base theme is built to WCAG 2.2 AA; these modes sit on top.
- **Shopping helpers:** catalog filters by category, in-place search and price sort, wishlist, quick add (each with an on-screen confirmation), photo gallery, key facts card, buyers-only reviews with photos.

### Admin app

- **Home:** a dashboard built from the quiz. The merchant picks the period: 7, 30 or 90 days, or all time.
  - **At a glance:** quiz results, shoppers with no match, average review, and the share of suggestions added to a cart.
  - **Two pie charts:** which need groups shoppers add to cart, and what shoppers want to do.
  - **Best and weakest performers:** the two products whose suggestions work best and the two that work worst.
  - **What to do next:** open alerts, reviews waiting, and products with no need tags, each with a button.
  - **Do you stock what shoppers ask for?** One row per need, comparing the share of shoppers with that need against the share of the catalog that serves it.
  - **Which suggestions do shoppers act on?** Every suggested product, with search, a performance filter and sorting by rate, times suggested or cart adds.
- **Products:** edit each product's need tags, key facts and plain-language summary. Saving writes them to product metafields that the theme reads.
- **Reviews:** approve or reject customer reviews, with an option to publish without approval.
- **Activity:** a log of every change made by the merchant or by the app itself.
- **Logic:** unmet-need alerts, low-conversion alerts, a smoothed product ranking and a coverage verdict per need. The rules are explained in [APP_DECISIONS.md](APP_DECISIONS.md).
- **What it leaves out on purpose:** sales and order reports. Shopify's own Analytics page already has them. The app shows what shoppers asked for before they bought anything.

## Run it yourself

### You need

- Node.js 22.12 or newer
- Docker Desktop
- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) 3 or newer
- A Shopify Partner account and a development store

### 1. Start the database

From the repository root. This starts MySQL 8.4 in Docker on `127.0.0.1:3306`.

```bash
docker compose up -d
```

### 2. Start the app

```bash
cd roam-insights
cp .env.example .env
npm install
shopify app dev
```

`shopify app dev` asks which app and store to use, applies the database migrations, and prints a preview link. Press `p` to open the app in the store's admin and approve the install. The first visit copies the store's products into the app and creates the quiz page.

### 3. Load the catalog

With the app opened once, from `roam-insights/`:

```bash
npm run catalog
```

This creates the 48 products from `store-data/products.csv` and uploads the photos listed in `store-data/product-photos.json`. The app is not allowed to publish to sales channels, so afterwards select the new products in the admin and choose **Include in sales channels > Online Store**.

### 4. Set up the store

These are one-time steps in the Shopify admin:

1. **Collections:** create five automated collections, one per product type: Mobility, Hands and dexterity, Deaf and hard of hearing, Nonspeaking, Blind and low vision.
2. **Home page collection:** add a few products to the built-in "Home page" collection. The home page's featured row shows them.
3. **Contact page:** create a page with the handle `contact`.
4. **Menu:** the main menu needs Home, Catalog and Contact. The "Shop by need" menu is built by the theme.
5. **Payments:** turn on the Bogus Gateway to place test orders.

### 5. Start the theme

```bash
cd theme
shopify theme dev --store <your-store-handle>
```

### 6. Add sample data (optional)

From `roam-insights/`. This fills the dashboard with invented quiz results and gives each product sample reviews. Add `-- --reset` to clear earlier results first.

```bash
npm run db:seed
```

To show the sample reviews on the storefront, open **Reviews** in the app and press **Publish all approved reviews**.

### Testing a review

Reviews are for buyers only. Sign in as a customer on the storefront's own address (not `127.0.0.1`), place a test order with the Bogus Gateway, then open that product's page and write the review.

## Database

- **Schema:** [roam-insights/app/db/schema.ts](roam-insights/app/db/schema.ts), ten tables.
- **Migrations:** [roam-insights/drizzle/](roam-insights/drizzle/), four SQL files, generated from the schema with `npm run db:generate` and applied with `npm run db:migrate`.

```
products ──< event_picks >── suggestion_events ──< event_needs
   │
   ├──< reviews ──< review_photos
   ├──< alerts
   └──< activity_log >── alerts

session          (Shopify sessions)
shop_settings    (one row per shop)
```

No table stores anything that identifies a quiz taker: a suggestion event is the need tags chosen and the products suggested.

## Sample data

Everything in the catalog is invented for this project. Roam is not a real business.

- **Products, specs and prices** are made up. Prices were set a little below comparable listings, and are estimates.
- **Quiz results** on the dashboard come from `npm run db:seed`, not from real shoppers.
- **Reviews** signed "Sample shopper" come from the same script. Real reviews can only be written by a signed-in customer who bought the product.
- **Contact details** in the footer and on the contact page are placeholders.

## Credits

- **Theme base:** Shopify's [Skeleton theme](https://github.com/Shopify/skeleton-theme).
- **App base:** Shopify's React Router app template.
- **Icons:** [Lucide](https://lucide.dev), ISC licence, in the theme and in the app.
- **Hero wheel graphic:** the wheel icon from [MingCute](https://www.mingcute.com), Apache License 2.0.
- **Shop by goal photos:** the four photos behind the goal cards are AI-generated.
- **Hero collage:** three stock photos, cut out and arranged in Figma. 
- **Fonts:** Space Grotesk and Inter, from Shopify's font library.
- **Logo:** my own wordmark arranged in Figma.

### Product photos

Of the 116 product photos, 99 are AI-generated and 17 are AI edits of stock photos. The people shown do not endorse Roam. The credit for every photo is recorded in [store-data/product-photos.json](store-data/product-photos.json).

| Photographer | Source | Used for |
|---|---|---|
| Audi Nissen | [Unsplash](https://unsplash.com/photos/u1CAj5HJzO4) | Roam Court Wheelchair |
| Elizabeth Woolner | [Unsplash](https://unsplash.com/photos/9xxNZCJZ8bA) | Roam Braille Keyboard |
| Elizabeth Woolner | [Unsplash](https://unsplash.com/photos/oRZJSFcFjNk) | Roam Finger Mouse |
| Compagnons | [Unsplash](https://unsplash.com/photos/4MoIpDcSlr4) | Roam Braille Keyboard 2000 |
| Jens Theeß | [Unsplash](https://unsplash.com/photos/ZwHkhBbhRDA) | Roam Kids Wheelchair |
| Sarah Louise Kinsella | [Unsplash](https://unsplash.com/photos/Mqmsu7T8au8) | Roam Bamboo Walking Stick |
| Pixabay | [Pexels](https://www.pexels.com/photo/40141/) | Roam Bamboo Walking Stick |
| Jonathan Borba | [Pexels](https://www.pexels.com/photo/27730420/) | Roam Release Tool |

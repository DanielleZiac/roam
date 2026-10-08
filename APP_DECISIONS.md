# App decisions

This document explains what I built for the take-home and why: the store concept, the app idea, the architecture and schema, the tradeoffs I accepted, and what I would do with more time.

## Store concept

**Roam** sells assistive technology to disabled people aged 18 to 35 in the Philippines, with families and carers as the second audience.

- **The gap:** existing assistive technology stores are catalogs for schools, hospitals and government buyers. They read like procurement lists. Nobody sells this gear the way sportswear is sold: to the person who will use it, with pride.
- **The position:** bold and active, never clinical or pitying. Copy is specs first, in plain words, with no medical promises.
- **The catalog:** 48 products across five need groups (Mobility, Hands and dexterity, Deaf and hard of hearing, Nonspeaking, Blind and low vision), from a ₱279 writing pad to a ₱289,000 prosthetic arm. Prices are in pesos.
- **The look:** white, bright teal, soft lilac and violet, with Space Grotesk headings. Teal is only used behind dark text so contrast stays above WCAG AA.

### The standout feature: "Tell us about you"

Most shoppers do not know the name of the product that would help them. So the store asks four optional questions and suggests gear.

- **How it scores:** every answer carries need tags with a weight. A product's score is the sum of the weights it matches. Goals such as travel or sports only break ties once a need is matched, so a "travel" answer alone cannot push an unrelated product up.
- **It explains itself:** each suggestion shows which answers earned it its place.
- **It respects the shopper:** everything is skippable, including "I'd rather not say". Scoring happens in the browser, and answers are saved only on the device.
- **It is not a gate:** the store works fully without it, and without JavaScript the page links to the catalog.

I also added two accessibility modes, dyslexia-friendly text and "Read it to me". They are upgrades on top of a theme that already aims for WCAG 2.2 AA, not a substitute for it.

## App idea: Roam Insights

The quiz produces something no normal store has: a record of what shoppers say they need, before they buy anything. Roam Insights turns that into decisions for the merchant.

**The question it answers:** are we stocking what our shoppers are asking for, and are our suggestions any good?

| Requirement | What the app does |
|---|---|
| Dashboard | A summary for a period the merchant picks (7, 30 or 90 days, or all time), what needs the merchant's attention, how much of the catalog serves each need, and a searchable table of how every suggested product performs |
| Create and update | The merchant edits each product's need tags, key facts and summary. Saving writes metafields that the quiz and product page read |
| History | Every merchant edit, review decision and alert is written to an activity log |
| Logic | Unmet-need alerts, low-conversion alerts, a smoothed ranking and a coverage verdict |

The app and the theme form a loop. The quiz sends anonymous results to the app. The app shows where the catalog is thin. The merchant retags or adds products. The quiz then suggests differently.

### Why it does not repeat Shopify Analytics

I considered putting orders and sales on the dashboard, built a first version, and removed it.

- **Shopify already does it.** The admin's Analytics page reports sales, orders and top products. A second copy inside the app would add nothing.
- **The app's value is the data Shopify does not have.** Shopify sees what sold. It cannot see the shopper who wanted a visual doorbell, found none, and left. The quiz records what people wanted before they bought, so the app can show demand that never became an order.

In one line: Shopify tells the merchant what sold, and Roam Insights tells them what they should be selling.

### How the dashboard is laid out

- **A period picker at the top:** 7, 30 or 90 days, or all time. The choice is kept in the page address, so a reload keeps it. Alerts ignore it and always use their own 30-day rules, so changing the view never raises or clears an alert.
- **Summary first:** four tiles in one row (two by two on a phone), then two pie charts and the best and weakest performers.
- **Then actions:** "What to do next" lists open alerts, reviews waiting and untagged products, each with a button that goes to the place to fix it.
- **Then two tables,** each answering one question in its heading:
  - **"Do you stock what shoppers ask for?"** One bar per need shows the share of shoppers who have it, and a marker on the bar shows the share of the catalog that serves it. Needs the store is short on are listed first.
  - **"Which suggestions do shoppers act on?"** One bar per product shows how often it was suggested, with how often it was added to a cart drawn on top. The controls sit in the header row: search, a performance filter and three sort buttons.
- **Charts are plain SVG and HTML,** with no charting library. Every chart has a text description for screen readers and shows its numbers as text, so colour is never the only cue.
- **Need groups have icons,** from the same Lucide set as the theme. The group's name stays available as a tooltip and to screen readers.

### The logic, in plain terms

- **Unmet-need alert:** raised when a need was chosen at least 5 times in 30 days and either no product is tagged for it, or at most 2 are and the need appears in at least 15% of results.
- **Low-conversion alert:** raised when a product was suggested at least 8 times and fewer than 5% of those suggestions were added to a cart. It usually means wrong need tags, a price problem or a weak product page.
- **Alerts close themselves.** Each time the dashboard loads, the app works out which alerts should exist and resolves the ones whose condition has cleared. Early on the app flagged that Nonspeaking had only two products. After I added seven more, the alert resolved itself and the activity log recorded it.
- **Ranking:** products are ranked by how often a suggestion becomes a cart add. A raw rate would put a product suggested once and added once above one suggested 50 times and added 20 times. So each rate is pulled toward the shop average, as if every product had 5 extra suggestions that performed averagely: `score = (added + average × 5) / (suggested + 5)`.
- **Coverage verdict:** the app compares a need's share of quiz results with its share of the catalog. If demand is 1.5 times supply or more, the store is "short"; if it is 0.6 times or less, the need is "well covered". Example: 27% of quiz results include "Deaf or hard of hearing" and 13% of products are tagged for it, so demand is about twice supply and the store is short.
- **Performance label:** each suggested product is compared with the shop's average cart-add rate. At 1.3 times the average or more it is "Shoppers want this"; at half the average or less it is "Rarely chosen". A product suggested fewer than 8 times is "Too early to say".

### Reviews

I added reviews because a shop for expensive, personal equipment needs proof from other users.

- **Buyers only.** The form posts through the app proxy, where Shopify adds the signed-in customer's id to a signed request. The app then checks that customer's orders for the product. This check runs on the server, so it cannot be skipped from the browser.
- **One review per customer per product**, with up to three photos.
- **Moderated by default**, with a switch to publish straight away.
- **Approved reviews are written to product metafields**, so product pages show them with no request to the app.

## Architecture

```
Storefront (theme)                         Shopify                    Roam Insights
──────────────────                         ───────                    ─────────────
quiz result, cart add,   ── /apps/roam ──▶ app proxy, signs  ───────▶ /proxy/* routes ──▶ MySQL
review                                     the request

product page reads       ◀── metafields ── Admin API         ◀─────── product editor,
need tags, key facts,                                                 review moderation
summary, reviews

                                           Shopify admin     ◀──────▶ embedded pages
                                           (OAuth, sessions)          (dashboard, products,
                                                                       reviews, activity)
```

- **Stack:** Shopify's React Router app template, which runs on Vite with a Node.js server, plus Drizzle ORM on MySQL 8.4 in Docker. Sessions are stored in MySQL through Drizzle's session storage adapter.
- **Why this template and not Express with a separate Vite frontend:** it is the template Shopify currently maintains for embedded apps, and it handles OAuth, token exchange and the embedded flow correctly out of the box. It is still a Vite frontend and a Node backend, in one project. I spent the time I saved on the app's logic.
- **Why the app proxy:** the theme can call the app on the shop's own domain with no API key in theme code. Shopify signs every request, so the endpoints reject anything that did not come through the store.
- **Why metafields for the theme's data:** need tags, key facts, summaries and published reviews live on the product in the `roam` namespace. The storefront stays fast and keeps working if the app's server is down.
- **Two sources of truth, on purpose:** Shopify owns the product itself. The app owns the matching data and keeps Shopify's tags in step with it, because the catalog filters run on tags.

## Schema decisions

Ten tables. The schema is one file, [roam-insights/app/db/schema.ts](roam-insights/app/db/schema.ts), and the four migrations are generated from it.

| Table | Holds | Why it is shaped this way |
|---|---|---|
| `products` | The app's copy of each product's need tags, key facts and summary | The merchant edits here. Keeping a copy means the dashboard never waits on the Admin API |
| `suggestion_events` | One row per finished quiz | The unit everything else counts |
| `event_needs` | The need tags chosen in an event, one row per tag | A separate table, not a JSON column, so "how often was this need chosen" is an indexed count |
| `event_picks` | The products suggested in an event, in order, and when one was added to a cart | Links demand to outcome. It keeps the product handle as well as the id, so history survives a product being removed |
| `alerts` | Open, acknowledged and resolved alerts with the numbers behind them | Status is a column, not a deletion, so the history of a problem is kept |
| `activity_log` | Who did what and when, linked to a product or alert | One table for every kind of change keeps the Activity page a single query |
| `reviews`, `review_photos` | Reviews and their photos | Photos are a separate table so listing reviews never loads image data |
| `shop_settings` | Per-shop switches, such as publishing reviews without approval | One row per shop |
| `session` | Shopify sessions | The shape is fixed by Shopify's adapter |

- **No personal data from the quiz.** An event is tags and product handles. The free-text answer never leaves the browser.
- **Deletes are deliberate.** Removing a product sets its id to null in past suggestions and in the log, and deletes its reviews.

## Tradeoffs

- **The verdicts are rules of thumb.** The coverage cut-offs (1.5 and 0.6) and the performance cut-offs (1.3 and 0.5) are starting values I chose, not numbers learned from sales. Coverage also counts products, which ignores stock levels, price and quality. The verdicts point the merchant at where to look; they do not prove the catalog is right.
- **The two dashboard tables are hand-built HTML,** not Polaris tables. I wanted the search box, filter and sort buttons inside the header row and a bar inside each row, which the Polaris table does not offer. The cost is that they are styled by hand to match the admin.
- **The dashboard is wider than the other pages.** It uses a full-width page with its own two-column layout, because the tables need the room. Products, Reviews and Activity still use Shopify's standard width.
- **Fixed alert thresholds.** "At most 2 products" made sense with 15 products. With 48 it rarely fires, and the coverage verdict now does that job better. I kept the rule simple and visible in one file instead of tuning it late.
- **Review photos are stored in MySQL.** It kept the project to one data store and no file service. It would not scale; object storage is the right home.
- **Scoring runs in the browser.** That is good for privacy and speed, but the merchant cannot change the weights without editing the theme.
- **Cart adds, not purchases.** The app measures whether a suggestion was added to a cart. Following it through to a paid order needs order webhooks and a way to connect an order to a quiz result without identifying the shopper.
- **Products are published by hand.** The app has no permission to publish to sales channels, so products created by the catalog script need one click in the admin. I chose not to widen the app's permissions for a setup convenience.
- **The app runs locally.** It is not deployed, so it is live only while my development server is running.
- **The catalog is invented.** Products, specs, prices, quiz results and "Sample shopper" reviews are sample data. Most product photos are AI-generated, and that is stated in the README.

## What I would improve with more time

1. **Make the unmet-need rule relative.** Alert when a need's share of demand is well above its share of the catalog, so the rule scales with catalog size.
2. **Track suggestions through to orders**, to rank products by revenue and not only cart adds.
3. **Let the merchant tune the quiz from the app:** weights, questions and wording, stored in metaobjects the theme reads.
4. **Add "limb difference" and "hands and dexterity" as quiz options.** The Hands group is only reached through follow-up questions today.
5. **A free-text option with AI:** "describe it yourself", turned into need tags on the server through the app proxy.
6. **Move review photos to object storage** and add image resizing.
7. **Deploy the app** and add automated tests for the scoring, ranking and alert rules, which are pure functions and easy to test.
8. **A full accessibility audit** with screen reader users, not only automated checks and my own keyboard testing.
9. **Real photography** of real disabled people using the gear, with consent, to replace the generated images.
10. **Remove the template's leftover example definitions** from the app configuration.
11. **Tune the verdict cut-offs with real sales data,** and let the merchant adjust them.
12. **Give the Products page the same search and filters** as the dashboard table, including a "no need tags" filter.
13. **Link the product editor to the product in Shopify** and show how that product is performing, so an alert leads somewhere the merchant can act on price and photos too.

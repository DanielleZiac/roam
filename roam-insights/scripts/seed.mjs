/*
 * Fills the database with SAMPLE quiz results and reviews, so the dashboard,
 * ranking, alerts and review moderation have something to show before real
 * shoppers arrive.
 *
 *   npm run db:seed                    add about 960 sample results over the last 90 days
 *   npm run db:seed -- --fresh-results remove the recorded quiz results first, keep reviews and alerts
 *   npm run db:seed -- --reset         remove every recorded result, review and alert first
 *
 * The data is invented. It is shaped to look like a plausible quarter, a little
 * busier in recent weeks than at the start: mobility
 * is the most common need, "Deaf or hard of hearing" is chosen more often than
 * its share of the catalog, everyday low-cost items convert well, and a few
 * products are suggested a lot but almost never added to a cart.
 *
 * Without --reset it tops up: more quiz results are added, and only products
 * that have no reviews yet get sample reviews.
 *
 * Run it after opening the app once, so the store's products are synced.
 */
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL || "mysql://roam:roam_local_dev@127.0.0.1:3306/roam_insights";
const RESULTS = 960;
const DAYS = 90;

// Each sample shopper: the needs they choose, and how common that kind of shopper is.
const PROFILES = [
  { weight: 18, needs: ["mobility", "wheelchair"], goals: ["get-around", "sports", "travel"] },
  { weight: 10, needs: ["mobility", "walking-aid"], goals: ["get-around", "travel", "everyday"] },
  { weight: 16, needs: ["nonspeaking"], goals: ["everyday", "travel"] },
  { weight: 26, needs: ["deaf-hoh"], goals: ["everyday", "travel"] },
  { weight: 12, needs: ["dexterity"], goals: ["everyday", "sports"] },
  { weight: 12, needs: ["blind-low-vision"], goals: ["everyday", "get-around"] },
  { weight: 6, needs: ["mobility", "dexterity"], goals: ["sports"] },
];

// Chance that a suggestion of this product is added to a cart. Others use DEFAULT_RATE.
const DEFAULT_RATE = 0.22;
const CART_RATES = {
  "roam-write-pad": 0.5,
  "roam-shake-alarm-clock": 0.45,
  "roam-tactile-dots": 0.45,
  "roam-trail-cane": 0.4,
  "roam-clamp-phone-mount": 0.38,
  "roam-buzz-band": 0.36,
  "roam-talking-watch": 0.34,
  "roam-grip-aid": 0.3,
  "roam-court-wheels": 0.16,
  "roam-boost": 0.1,
  "roam-pocket-magnifier": 0.06,
  "roam-voice-8": 0.02,
  "roam-talk-tablet": 0.02,
  "roam-bionic-arm-2000": 0.01,
};

// A small seeded random generator, so every run produces the same data.
let state = 20261005;
function random() {
  state = (state * 1664525 + 1013904223) % 4294967296;
  return state / 4294967296;
}

function pickWeighted(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

const connection = await mysql.createConnection(DATABASE_URL);

const [[session]] = await connection.query("SELECT shop FROM session LIMIT 1");
if (!session) {
  console.error("No shop found. Open the app in the Shopify admin once, then run this again.");
  process.exit(1);
}
const shop = session.shop;

const [products] = await connection.query("SELECT id, handle, need_tags FROM products WHERE shop = ?", [shop]);
if (products.length === 0) {
  console.error("No products found. Open the app in the Shopify admin once so it can sync them.");
  process.exit(1);
}
for (const product of products) {
  product.needTags = typeof product.need_tags === "string" ? JSON.parse(product.need_tags) : product.need_tags;
}

// Sample reviews. Author names are plainly placeholders, because these are not real customers.
const REVIEW_TEXT = {
  5: [
    "Does exactly what it says. Set-up took a few minutes and it has been in daily use since.",
    "Well made and easy to use. It fitted my routine straight away.",
    "Better than I expected for the price. I would buy it again.",
  ],
  4: [
    "Works well. The instructions could be clearer, but I got there.",
    "Solid and reliable. Delivery took a little longer than promised.",
    "Good product. I would like more colour options.",
  ],
  3: ["It does the job, but it feels less sturdy than the photos suggest.", "Fine for occasional use. Not sure about every day."],
  2: ["It works, but it was awkward to set up and I needed help."],
};

if (process.argv.includes("--reset")) {
  await connection.query("DELETE FROM activity_log WHERE shop = ? AND action LIKE 'review.%'", [shop]);
  await connection.query("DELETE FROM reviews WHERE shop = ?", [shop]);
  await connection.query("DELETE FROM activity_log WHERE shop = ? AND action LIKE 'alert.%'", [shop]);
  await connection.query("DELETE FROM alerts WHERE shop = ?", [shop]);
  await connection.query("DELETE FROM suggestion_events WHERE shop = ?", [shop]);
  console.log("Removed existing results and alerts.");
} else if (process.argv.includes("--fresh-results")) {
  await connection.query("DELETE FROM suggestion_events WHERE shop = ?", [shop]);
  console.log("Removed existing quiz results.");
}

let events = 0;
let picks = 0;
let adds = 0;

for (let i = 0; i < RESULTS; i += 1) {
  const profile = pickWeighted(PROFILES);
  const goal = profile.goals[Math.floor(random() * profile.goals.length)];
  const tags = [...profile.needs, goal];

  // The same idea as the storefront: a product must match a need, and goals add to its score.
  const scored = products
    .map((product) => ({
      product,
      needScore: profile.needs.filter((tag) => product.needTags.includes(tag)).length,
      goalScore: product.needTags.includes(goal) ? 1 : 0,
    }))
    .filter((entry) => entry.needScore > 0)
    .sort((a, b) => b.needScore * 3 + b.goalScore - (a.needScore * 3 + a.goalScore) || random() - 0.5)
    .slice(0, 4);

  // Raising the random number to a power above 1 puts slightly more results in recent weeks.
  const createdAt = new Date(Date.now() - random() ** 1.2 * DAYS * 24 * 60 * 60 * 1000);

  const [result] = await connection.query(
    "INSERT INTO suggestion_events (shop, pick_count, created_at) VALUES (?, ?, ?)",
    [shop, scored.length, createdAt],
  );
  const eventId = result.insertId;
  events += 1;

  await connection.query("INSERT INTO event_needs (event_id, need_tag) VALUES ?", [tags.map((tag) => [eventId, tag])]);

  if (scored.length > 0) {
    const rows = scored.map((entry, index) => {
      const rate = CART_RATES[entry.product.handle] ?? DEFAULT_RATE;
      const added = random() < rate;
      if (added) adds += 1;
      const addedAt = added ? new Date(createdAt.getTime() + (1 + random() * 20) * 60 * 1000) : null;
      return [eventId, entry.product.id, entry.product.handle, index + 1, addedAt];
    });
    picks += rows.length;
    await connection.query(
      "INSERT INTO event_picks (event_id, product_id, product_handle, position, added_to_cart_at) VALUES ?",
      [rows],
    );
  }
}

// Two to four reviews for each product that has none. Most are already approved; a few wait for a decision.
const [reviewed] = await connection.query("SELECT DISTINCT product_id FROM reviews WHERE shop = ?", [shop]);
const hasReviews = new Set(reviewed.map((row) => row.product_id));
const [[{ existing }]] = await connection.query("SELECT COUNT(*) AS existing FROM reviews WHERE shop = ?", [shop]);
let reviewCount = 0;
let pendingCount = 0;
let reviewer = existing + 1;
for (const product of products) {
  if (hasReviews.has(product.id)) continue;
  const howMany = 2 + Math.floor(random() * 3);
  for (let i = 0; i < howMany; i += 1) {
    const roll = random();
    const rating = roll < 0.5 ? 5 : roll < 0.82 ? 4 : roll < 0.95 ? 3 : 2;
    const options = REVIEW_TEXT[rating];
    const body = options[Math.floor(random() * options.length)];
    const pending = random() < 0.12;
    const createdAt = new Date(Date.now() - random() * DAYS * 24 * 60 * 60 * 1000);
    await connection.query(
      "INSERT INTO reviews (shop, product_id, rating, author_name, body, status, created_at, moderated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [shop, product.id, rating, `Sample shopper ${reviewer}`, body, pending ? "pending" : "approved", createdAt, pending ? null : createdAt],
    );
    reviewer += 1;
    reviewCount += 1;
    if (pending) pendingCount += 1;
  }
}

await connection.end();
console.log(`Added ${events} sample results for ${shop}: ${picks} suggestions, ${adds} added to cart.`);
console.log(`Added ${reviewCount} sample reviews, ${pendingCount} of them waiting for approval.`);
console.log("Open the app's home page to see the dashboard and alerts.");
console.log('To show the sample reviews on the store, open Reviews in the app and press "Publish all approved reviews".');

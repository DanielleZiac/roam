/*
 * Fills the database with SAMPLE quiz results, so the dashboard, ranking and
 * alerts have something to show before real shoppers arrive.
 *
 *   npm run db:seed            add about 160 sample results over the last 30 days
 *   npm run db:seed -- --reset remove every recorded result and alert first
 *
 * The data is invented. It is shaped to look like a plausible month: mobility
 * is the most common need, "Nonspeaking" and "Deaf or hard of hearing" are
 * chosen often relative to how few products cover them, and one product is
 * suggested a lot but almost never added to a cart.
 *
 * Run it after opening the app once, so the store's products are synced.
 */
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL || "mysql://roam:roam_local_dev@127.0.0.1:3306/roam_insights";
const RESULTS = 160;
const DAYS = 30;

// Each sample shopper: the needs they choose, and how common that kind of shopper is.
const PROFILES = [
  { weight: 20, needs: ["mobility", "wheelchair"], goals: ["get-around", "sports", "travel"] },
  { weight: 12, needs: ["mobility", "walking-aid"], goals: ["get-around", "travel", "everyday"] },
  { weight: 20, needs: ["nonspeaking"], goals: ["everyday", "travel"] },
  { weight: 18, needs: ["deaf-hoh"], goals: ["everyday", "travel"] },
  { weight: 14, needs: ["dexterity"], goals: ["everyday", "sports"] },
  { weight: 10, needs: ["blind-low-vision"], goals: ["everyday", "get-around"] },
  { weight: 6, needs: ["mobility", "dexterity"], goals: ["sports"] },
];

// Chance that a suggestion of this product is added to a cart. Others use DEFAULT_RATE.
const DEFAULT_RATE = 0.22;
const CART_RATES = {
  "roam-shake-alarm-clock": 0.45,
  "roam-trail-cane": 0.4,
  "roam-clamp-phone-mount": 0.38,
  "roam-grip-aid": 0.3,
  "roam-court-wheels": 0.16,
  "roam-boost": 0.1,
  "roam-voice-8": 0.02,
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

if (process.argv.includes("--reset")) {
  await connection.query("DELETE FROM activity_log WHERE shop = ? AND action LIKE 'alert.%'", [shop]);
  await connection.query("DELETE FROM alerts WHERE shop = ?", [shop]);
  await connection.query("DELETE FROM suggestion_events WHERE shop = ?", [shop]);
  console.log("Removed existing results and alerts.");
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

  const createdAt = new Date(Date.now() - random() * DAYS * 24 * 60 * 60 * 1000);

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

await connection.end();
console.log(`Added ${events} sample results for ${shop}: ${picks} suggestions, ${adds} added to cart.`);
console.log("Open the app's home page to see the dashboard and alerts.");

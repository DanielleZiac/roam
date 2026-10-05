/*
 * Database schema for Roam Insights (MySQL, via Drizzle).
 *
 * This file is the single source of truth for the tables. Migrations in
 * ./drizzle are generated from it with `npm run db:generate`.
 *
 * How the tables relate:
 *
 *   products ──< event_picks >── suggestion_events ──< event_needs
 *      │                               (one storefront "Tell us about you" result)
 *      ├──< alerts
 *      └──< activity_log >── alerts
 *
 * No table stores anything that identifies a shopper. A suggestion event is
 * only the need tags chosen and the products suggested.
 */
import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

// --- Shopify sessions ---------------------------------------------------------
// Column names and types are fixed by @shopify/shopify-app-session-storage-drizzle.

export const sessionTable = mysqlTable("session", {
  id: varchar("id", { length: 255 }).primaryKey(),
  shop: text("shop").notNull(),
  state: text("state").notNull(),
  isOnline: boolean("isOnline").default(false).notNull(),
  scope: text("scope"),
  expires: timestamp("expires", { mode: "date" }),
  accessToken: text("accessToken").notNull(),
  userId: bigint("userId", { mode: "number" }),
  firstName: text("firstName"),
  lastName: text("lastName"),
  email: text("email"),
  accountOwner: boolean("accountOwner"),
  locale: text("locale"),
  collaborator: boolean("collaborator"),
  emailVerified: boolean("emailVerified"),
  refreshToken: text("refreshToken"),
  refreshTokenExpires: timestamp("refreshTokenExpires", { mode: "date" }),
});

// --- Products -----------------------------------------------------------------
// The app's own copy of each product's matching data. The merchant edits need
// tags and key facts here; saving also writes them to product metafields, which
// the storefront reads.

export type KeyFact = { label: string; value: string };

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    shop: varchar("shop", { length: 255 }).notNull(),
    shopifyProductId: varchar("shopify_product_id", { length: 64 }).notNull(),
    handle: varchar("handle", { length: 255 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    productType: varchar("product_type", { length: 255 }).notNull().default(""),
    needTags: json("need_tags").$type<string[]>().notNull(),
    keyFacts: json("key_facts").$type<KeyFact[]>().notNull(),
    summary: text("summary"),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("products_shop_handle_unique").on(table.shop, table.handle),
    uniqueIndex("products_shop_shopify_id_unique").on(table.shop, table.shopifyProductId),
  ],
);

// --- Suggestion events ----------------------------------------------------------
// One row each time a shopper finishes "Tell us about you" on the storefront.

export const suggestionEvents = mysqlTable(
  "suggestion_events",
  {
    id: int("id").autoincrement().primaryKey(),
    shop: varchar("shop", { length: 255 }).notNull(),
    pickCount: int("pick_count").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("suggestion_events_shop_created_idx").on(table.shop, table.createdAt)],
);

// The need tags chosen in an event. One row per tag.
export const eventNeeds = mysqlTable(
  "event_needs",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("event_id")
      .notNull()
      .references(() => suggestionEvents.id, { onDelete: "cascade" }),
    needTag: varchar("need_tag", { length: 64 }).notNull(),
  },
  (table) => [
    index("event_needs_event_idx").on(table.eventId),
    index("event_needs_tag_idx").on(table.needTag),
  ],
);

// The products suggested in an event, in the order shown. addedToCartAt is set
// if the shopper went on to add that suggestion to their cart.
export const eventPicks = mysqlTable(
  "event_picks",
  {
    id: int("id").autoincrement().primaryKey(),
    eventId: int("event_id")
      .notNull()
      .references(() => suggestionEvents.id, { onDelete: "cascade" }),
    productId: int("product_id").references(() => products.id, { onDelete: "set null" }),
    productHandle: varchar("product_handle", { length: 255 }).notNull(),
    position: int("position").notNull(),
    addedToCartAt: timestamp("added_to_cart_at", { mode: "date" }),
  },
  (table) => [
    index("event_picks_event_idx").on(table.eventId),
    index("event_picks_product_idx").on(table.productId),
  ],
);

// --- Alerts -------------------------------------------------------------------
// Raised by the app's own logic: a need many shoppers choose that few products
// match, or a product that is suggested often but rarely added to cart.

export const alertTypes = ["unmet_need", "low_conversion"] as const;
export const alertSeverities = ["low", "medium", "high"] as const;
export const alertStatuses = ["open", "acknowledged", "resolved"] as const;

export type AlertMetric = Record<string, number>;

export const alerts = mysqlTable(
  "alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    shop: varchar("shop", { length: 255 }).notNull(),
    type: mysqlEnum("type", alertTypes).notNull(),
    severity: mysqlEnum("severity", alertSeverities).notNull().default("medium"),
    status: mysqlEnum("status", alertStatuses).notNull().default("open"),
    needTag: varchar("need_tag", { length: 64 }),
    productId: int("product_id").references(() => products.id, { onDelete: "cascade" }),
    message: varchar("message", { length: 500 }).notNull(),
    // The numbers behind the alert, e.g. { selections: 42, matchingProducts: 1 }.
    metric: json("metric").$type<AlertMetric>().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { mode: "date" }),
  },
  (table) => [index("alerts_shop_status_idx").on(table.shop, table.status)],
);

// --- Activity log ---------------------------------------------------------------
// An append-only history of what changed and who changed it.

export const activityActors = ["merchant", "system"] as const;

export const activityLog = mysqlTable(
  "activity_log",
  {
    id: int("id").autoincrement().primaryKey(),
    shop: varchar("shop", { length: 255 }).notNull(),
    actor: mysqlEnum("actor", activityActors).notNull(),
    // Dotted names such as "product.tags_updated" or "alert.raised".
    action: varchar("action", { length: 64 }).notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    // Before and after values, for changes that have them.
    details: json("details").$type<Record<string, unknown>>(),
    productId: int("product_id").references(() => products.id, { onDelete: "set null" }),
    alertId: int("alert_id").references(() => alerts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("activity_log_shop_created_idx").on(table.shop, table.createdAt)],
);

// --- Relations ----------------------------------------------------------------
// These let queries fetch related rows together, e.g. an event with its needs and picks.

export const productsRelations = relations(products, ({ many }) => ({
  picks: many(eventPicks),
  alerts: many(alerts),
  activity: many(activityLog),
}));

export const suggestionEventsRelations = relations(suggestionEvents, ({ many }) => ({
  needs: many(eventNeeds),
  picks: many(eventPicks),
}));

export const eventNeedsRelations = relations(eventNeeds, ({ one }) => ({
  event: one(suggestionEvents, { fields: [eventNeeds.eventId], references: [suggestionEvents.id] }),
}));

export const eventPicksRelations = relations(eventPicks, ({ one }) => ({
  event: one(suggestionEvents, { fields: [eventPicks.eventId], references: [suggestionEvents.id] }),
  product: one(products, { fields: [eventPicks.productId], references: [products.id] }),
}));

export const alertsRelations = relations(alerts, ({ one, many }) => ({
  product: one(products, { fields: [alerts.productId], references: [products.id] }),
  activity: many(activityLog),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  product: one(products, { fields: [activityLog.productId], references: [products.id] }),
  alert: one(alerts, { fields: [activityLog.alertId], references: [alerts.id] }),
}));

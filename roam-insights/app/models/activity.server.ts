import { desc, eq } from "drizzle-orm";

import db from "../db.server";
import { activityLog, products } from "../db/schema";

type NewEntry = typeof activityLog.$inferInsert;

// Every write to the activity log goes through here.
export function logActivity(entry: NewEntry) {
  return db.insert(activityLog).values(entry);
}

// The most recent entries for a shop, each with the product it concerns (if any).
export function listActivity(shop: string, limit = 100) {
  return db
    .select({
      id: activityLog.id,
      actor: activityLog.actor,
      action: activityLog.action,
      summary: activityLog.summary,
      details: activityLog.details,
      createdAt: activityLog.createdAt,
      productId: activityLog.productId,
      productTitle: products.title,
    })
    .from(activityLog)
    .leftJoin(products, eq(activityLog.productId, products.id))
    .where(eq(activityLog.shop, shop))
    .orderBy(desc(activityLog.createdAt), desc(activityLog.id))
    .limit(limit);
}

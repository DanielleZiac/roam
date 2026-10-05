import type { ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sessionTable } from "../db/schema";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current as string[];
  if (session) {
    await db.update(sessionTable).set({ scope: current.toString() }).where(eq(sessionTable.id, session.id));
  }
  return new Response();
};

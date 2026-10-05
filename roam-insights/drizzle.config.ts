import { defineConfig } from "drizzle-kit";

// Used by drizzle-kit to generate and run migrations (npm run db:generate, npm run db:migrate).
export default defineConfig({
  dialect: "mysql",
  schema: "./app/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL || "mysql://roam:roam_local_dev@127.0.0.1:3306/roam_insights",
  },
});

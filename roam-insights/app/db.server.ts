import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import * as schema from "./db/schema";

// Falls back to the local Docker database from docker-compose.yml.
export const DATABASE_URL =
  process.env.DATABASE_URL || "mysql://roam:roam_local_dev@127.0.0.1:3306/roam_insights";

declare global {
  // eslint-disable-next-line no-var
  var mysqlPoolGlobal: mysql.Pool | undefined;
}

// In development the server reloads on every change. Reusing one pool across
// reloads stops each reload from opening a new set of connections.
const pool = global.mysqlPoolGlobal ?? mysql.createPool({ uri: DATABASE_URL, connectionLimit: 10 });

if (process.env.NODE_ENV !== "production") {
  global.mysqlPoolGlobal = pool;
}

const db = drizzle(pool, { schema, mode: "default" });

export default db;
export { schema };

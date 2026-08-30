import { Kysely, SqliteDialect } from "kysely";
import type { DB } from "../generated/db-types.js";
import { getDb } from "./db.js";

// Initialize Kysely using the existing better-sqlite3 connection from getDb()
export const kysely = new Kysely<DB>({
  dialect: new SqliteDialect({
    database: () => getDb() as any,
  }),
});

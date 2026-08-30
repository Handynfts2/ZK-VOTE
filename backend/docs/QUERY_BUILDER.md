# Database Query Builder

This document describes how we use Kysely as a type-safe SQL query builder in `ZK-VOTE/backend`.

## Why Kysely?
Historically, SQL queries in `services/db.ts` were written as raw strings. This approach lacked compile-time validation for table and column names and provided no type inference for query results. It was also prone to SQL injection risks when dynamically constructing queries.

By adopting [Kysely](https://kysely.dev/), we gain:
- Compile-time safety for queries.
- Easy and secure composition of dynamic queries (e.g., dynamic filtering).
- Auto-generated typings matching the existing database schema.

## Synchronous Execution
Because ZK-VOTE relies on `better-sqlite3`, which exposes a synchronous API, we use Kysely's query builder functionality to *compile* SQL strings and parameter arrays, which are then passed directly to `better-sqlite3`'s `.prepare(...).run(...)` or `.get(...)`.

This pattern gives us type safety without needing to refactor the entire backend architecture to async/await immediately.

### Example

Instead of:
```typescript
database
  .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
  .run(key, JSON.stringify(value));
```

We now do:
```typescript
import { kysely } from "./kysely.js";

const compiled = kysely
  .insertInto("metadata")
  .values({ key, value: JSON.stringify(value) })
  .onConflict((oc) => oc.column("key").doUpdateSet({ value: JSON.stringify(value) }))
  .compile();

database.prepare(compiled.sql).run(...compiled.parameters);
```

## Schema & Type Generation
We use `kysely-codegen` to inspect the `better-sqlite3` database and automatically generate TypeScript interfaces for all tables.

To regenerate types after a schema change (i.e. migrations in `db.ts`), run:
```bash
npm run db:generate-types
```
This script will initialize a temporary schema via `init-db-for-types.ts` and output `src/generated/db-types.ts`.

## Dynamic Partition Tables
ZK-VOTE uses per-DAO partition tables for events (e.g., `events_1`). Kysely can query these tables dynamically by using `sql.raw`:
```typescript
import { sql } from "kysely";

const tableName = partitionTableName(daoId);

const query = kysely
  .selectFrom(sql<any>\`\${sql.raw(tableName)}\`.as("events"))
  .selectAll();
```
This safely injects the table name (which is strictly validated in `partitionTableName`) into Kysely's type-checked builder.

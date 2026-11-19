import pg from "pg";

/** @type {import("pg").Pool | undefined} */
let pool;

export function postgresPool() {
  if (!pool) {
    const {
      POSTGRES_DB,
      POSTGRES_USER,
      POSTGRES_PASSWORD,
      POSTGRES_PORT,
      POSTGRES_HOST,
    } = process.env;
    if (!POSTGRES_DB || !POSTGRES_USER || !POSTGRES_PASSWORD) {
      throw new Error("Set POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD.");
    }
    pool = new pg.Pool({
      host: POSTGRES_HOST ?? "127.0.0.1",
      port: Number(POSTGRES_PORT ?? 5432),
      database: POSTGRES_DB,
      user: POSTGRES_USER,
      password: POSTGRES_PASSWORD,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", (error) =>
      console.error("PostgreSQL connection lost:", error.message),
    );
  }
  return pool;
}

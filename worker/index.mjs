import { setTimeout as delay } from "node:timers/promises";
import { createPool } from "mysql2/promise";
import pg from "pg";
import { processIndexEvents } from "./indexing.mjs";

function required(name) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Set ${name} before starting the indexing worker.`);
  return value;
}

const mysql = createPool({
  host: "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  database: required("MYSQL_DATABASE"),
  user: required("MYSQL_USER"),
  password: required("MYSQL_PASSWORD"),
  supportBigNumbers: true,
  bigNumberStrings: true,
});
const postgres = new pg.Pool({
  host: "127.0.0.1",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  database: required("POSTGRES_DB"),
  user: required("POSTGRES_USER"),
  password: required("POSTGRES_PASSWORD"),
  connectionTimeoutMillis: 5000,
});
postgres.on("error", (error) =>
  console.error("PostgreSQL connection lost:", error.message),
);

const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());

console.log("Indexing worker started.");
try {
  while (!stop.signal.aborted) {
    try {
      await processIndexEvents(mysql, postgres, stop.signal);
    } catch (error) {
      console.error("Could not poll index events:", error.message);
    }
    await delay(1000, undefined, { signal: stop.signal });
  }
} catch (error) {
  if (error.name !== "AbortError") throw error;
} finally {
  await Promise.allSettled([mysql.end(), postgres.end()]);
}

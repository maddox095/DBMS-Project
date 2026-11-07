import { setTimeout as delay } from "node:timers/promises";
import { mysqlPool } from "../src/server/mysql-pool.mjs";
import { postgresPool } from "../src/server/postgres.mjs";
import { processIndexEvents } from "./indexing.mjs";

const mysql = mysqlPool();
const postgres = postgresPool();

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

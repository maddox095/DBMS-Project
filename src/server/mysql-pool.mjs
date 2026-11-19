import { createPool } from "mysql2/promise";

const runtimeAccounts = {
  auth: ["exchange_auth", "MYSQL_AUTH_PASSWORD"],
  PRODUCER: ["exchange_producer", "MYSQL_PRODUCER_PASSWORD"],
  CONSUMER: ["exchange_consumer", "MYSQL_CONSUMER_PASSWORD"],
  worker: ["exchange_worker", "MYSQL_WORKER_PASSWORD"],
};

/** @typedef {keyof typeof runtimeAccounts | "admin"} DatabaseAccess */
/** @type {Map<DatabaseAccess, import("mysql2/promise").Pool>} */
const pools = new Map();

/** @param {DatabaseAccess} access */
export function mysqlPool(access) {
  let pool = pools.get(access);
  if (!pool) {
    const { MYSQL_DATABASE, MYSQL_HOST, MYSQL_PORT, MYSQL_USER } = process.env;
    const [user, passwordVariable] =
      access === "admin"
        ? [MYSQL_USER, "MYSQL_PASSWORD"]
        : runtimeAccounts[access];
    const password = process.env[passwordVariable];
    if (!MYSQL_DATABASE || !user || !password) {
      throw new Error(
        `Missing database settings for ${access}: MYSQL_DATABASE, account name, or ${passwordVariable}.`,
      );
    }
    pool = createPool({
      host: MYSQL_HOST ?? "127.0.0.1",
      port: Number(MYSQL_PORT ?? 3306),
      database: MYSQL_DATABASE,
      user,
      password,
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: "Z",
    });
    pools.set(access, pool);
  }
  return pool;
}

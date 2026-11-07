import { createPool } from "mysql2/promise";

/** @type {import("mysql2/promise").Pool | undefined} */
let pool;

export function mysqlPool() {
  if (!pool) {
    const { MYSQL_DATABASE, MYSQL_USER, MYSQL_PASSWORD, MYSQL_PORT } =
      process.env;
    if (!MYSQL_DATABASE || !MYSQL_USER || !MYSQL_PASSWORD) {
      throw new Error("Set MYSQL_DATABASE, MYSQL_USER, and MYSQL_PASSWORD.");
    }
    pool = createPool({
      host: "127.0.0.1",
      port: Number(MYSQL_PORT ?? 3306),
      database: MYSQL_DATABASE,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      supportBigNumbers: true,
      bigNumberStrings: true,
      timezone: "Z",
    });
  }
  return pool;
}

import { createPool, type Pool, type PoolConnection } from "mysql2/promise";

let pool: Pool | undefined;

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

export async function mysqlTransaction<T>(
  work: (connection: PoolConnection) => Promise<T>,
  mode: "write" | "snapshot" = "write",
): Promise<T> {
  const connection = await mysqlPool().getConnection();
  try {
    await connection.query(
      mode === "snapshot"
        ? "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"
        : "SET TRANSACTION ISOLATION LEVEL READ COMMITTED",
    );
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      connection.destroy();
    }
    throw error;
  } finally {
    connection.release();
  }
}

export function hasMysqlError(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

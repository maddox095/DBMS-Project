import type { PoolConnection } from "mysql2/promise";
import { mysqlPool } from "./mysql-pool.mjs";
export { mysqlPool };

export async function mysqlTransaction<T>(
  access: "auth" | "PRODUCER" | "CONSUMER",
  work: (connection: PoolConnection) => Promise<T>,
  mode: "write" | "snapshot" = "write",
): Promise<T> {
  const connection = await mysqlPool(access).getConnection();
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

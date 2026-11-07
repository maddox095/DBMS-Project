import { batchSelect } from "../src/server/batch-query.mjs";
import { mysqlPool } from "../src/server/mysql-pool.mjs";
import { postgresPool } from "../src/server/postgres.mjs";
import { upsertBatchSearch } from "./indexing.mjs";

const mysql = mysqlPool();
const postgres = postgresPool();
let client;

try {
  const [rows] = await mysql.execute(`${batchSelect} ORDER BY b.id`);
  client = await postgres.connect();
  await client.query("BEGIN");
  try {
    await client.query("TRUNCATE TABLE batch_search");
    for (const row of rows) {
      const {
        totalQuantity: _total,
        materialId,
        materialName,
        category,
        unit,
        ...batch
      } = row;
      await upsertBatchSearch(client, {
        ...batch,
        material: { id: materialId, name: materialName, category, unit },
      });
    }
    await client.query("COMMIT");
    console.log(`Rebuilt ${rows.length} batch search snapshots.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
} catch (error) {
  console.error("Search rebuild failed:", error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await Promise.allSettled([mysql.end(), postgres.end()]);
}

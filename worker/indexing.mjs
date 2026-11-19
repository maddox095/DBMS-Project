import { embedText } from "../src/server/embedding.mjs";

const maxId = BigInt("9223372036854775807");
const idPattern = /^[1-9][0-9]{0,18}$/;
const quantityPattern = /^(?:0|[1-9][0-9]{0,10})\.[0-9]{3}$/;

function isId(value) {
  return (
    typeof value === "string" && idPattern.test(value) && BigInt(value) <= maxId
  );
}

function decodeEvent(event) {
  const payload = event.payload;
  if (payload?.type !== "batch.search.upsert" || payload.schemaVersion !== 1) {
    throw new Error("Unsupported batch index event format.");
  }
  const batch = payload.batch;
  if (
    !batch ||
    batch.batchId !== event.batch_id ||
    batch.revision !== event.batch_revision ||
    !isId(batch.supplierOrgId) ||
    !isId(batch.material?.id) ||
    typeof batch.availableQuantity !== "string" ||
    !quantityPattern.test(batch.availableQuantity) ||
    (batch.status !== "OPEN" && batch.status !== "CLOSED")
  ) {
    throw new Error(
      "Invalid batch ID, revision, material, status, or availability.",
    );
  }
  const textFields = [
    batch.material.name,
    batch.material.category,
    batch.material.unit,
    batch.batchCode,
    batch.description,
    batch.location,
  ];
  if (!textFields.every((value) => typeof value === "string")) {
    throw new Error("Missing searchable batch fields.");
  }
  return batch;
}

// Run inside the caller's PostgreSQL transaction. The per-batch lock makes
// checking revisions, replacing a vector, and recording deletion atomic.
export async function writeBatchProjection(postgres, batch) {
  const key = [batch.batchId, batch.revision];
  await postgres.query("SELECT pg_advisory_xact_lock($1::bigint)", [
    batch.batchId,
  ]);

  if (batch.status === "CLOSED") {
    await postgres.query(
      `INSERT INTO batch_search_removals (batch_id, revision) VALUES ($1, $2)
       ON CONFLICT (batch_id) DO UPDATE SET revision = EXCLUDED.revision
       WHERE batch_search_removals.revision < EXCLUDED.revision`,
      key,
    );
    await postgres.query(
      "DELETE FROM batch_search WHERE batch_id = $1 AND revision <= $2",
      key,
    );
    return;
  }

  const { rowCount } = await postgres.query(
    `SELECT 1 FROM batch_search_removals WHERE batch_id = $1 AND revision >= $2
     UNION ALL
     SELECT 1 FROM batch_search WHERE batch_id = $1 AND revision >= $2`,
    key,
  );
  if (rowCount) return;

  const { material } = batch;
  const text = [
    material.name,
    material.category,
    batch.description.trim(),
  ].join("\n");
  const embedding = await embedText(text);
  await postgres.query(
    `INSERT INTO batch_search (
       batch_id, supplier_org_id, material_id, material_name, category, unit,
       batch_code, description, location, status, available_quantity, revision, embedding
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector)
     ON CONFLICT (batch_id) DO UPDATE SET
       supplier_org_id = EXCLUDED.supplier_org_id,
       material_id = EXCLUDED.material_id,
       material_name = EXCLUDED.material_name,
       category = EXCLUDED.category,
       unit = EXCLUDED.unit,
       batch_code = EXCLUDED.batch_code,
       description = EXCLUDED.description,
       location = EXCLUDED.location,
       status = EXCLUDED.status,
       available_quantity = EXCLUDED.available_quantity,
       revision = EXCLUDED.revision,
       embedding = EXCLUDED.embedding,
       indexed_at = CURRENT_TIMESTAMP
     WHERE batch_search.revision < EXCLUDED.revision`,
    [
      batch.batchId,
      batch.supplierOrgId,
      material.id,
      material.name,
      material.category,
      material.unit,
      batch.batchCode,
      batch.description,
      batch.location,
      batch.status,
      batch.availableQuantity,
      batch.revision,
      embedding,
    ],
  );
}

export async function processIndexEvents(mysql, postgres, signal) {
  const [events] = await mysql.execute(
    `SELECT id, batch_id, batch_revision, payload, attempts
     FROM batch_index_events
     WHERE processed_at IS NULL AND next_attempt_at <= CURRENT_TIMESTAMP(6)
     ORDER BY next_attempt_at, id
     LIMIT 10`,
  );

  for (const event of events) {
    if (signal.aborted) break;
    try {
      const batch = decodeEvent(event);
      const connection = await postgres.connect();
      try {
        await connection.query("BEGIN");
        await writeBatchProjection(connection, batch);
        await connection.query("COMMIT");
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally {
        connection.release();
      }
      await mysql.execute(
        `UPDATE batch_index_events SET processed_at = CURRENT_TIMESTAMP(6)
         WHERE id = CAST(? AS SIGNED) AND processed_at IS NULL`,
        [event.id],
      );
    } catch (error) {
      console.error(`Index event ${event.id} failed:`, error.message);
      const delaySeconds = Math.min(300, 2 ** Math.min(event.attempts + 1, 9));
      await mysql.execute(
        `UPDATE batch_index_events
         SET attempts = attempts + 1,
             next_attempt_at = TIMESTAMPADD(SECOND, ?, CURRENT_TIMESTAMP(6))
         WHERE id = CAST(? AS SIGNED) AND processed_at IS NULL`,
        [delaySeconds, event.id],
      );
    }
  }
}

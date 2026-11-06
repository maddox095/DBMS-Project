import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { ApiError, invalidInput, readObject } from "./http";
import { hasMysqlError, mysqlPool, mysqlTransaction } from "./mysql";
import { quantityUnits, readId, readQuantity, readText } from "./validation";

type BatchStatus = "OPEN" | "CLOSED";

interface BatchRow extends RowDataPacket {
  batchId: string;
  supplierOrgId: string;
  materialId: string;
  materialName: string;
  category: string;
  unit: string;
  batchCode: string;
  description: string;
  location: string;
  totalQuantity: string;
  availableQuantity: string;
  status: BatchStatus;
  revision: string;
}

const batchSelect = `
  SELECT b.id AS batchId, b.supplier_org_id AS supplierOrgId, b.material_id AS materialId,
         m.name AS materialName, m.category, m.unit, b.batch_code AS batchCode,
         b.description, b.location, b.total_quantity AS totalQuantity, b.status, b.revision,
         b.total_quantity - COALESCE((
           SELECT SUM(r.quantity) FROM reservations AS r
           WHERE r.batch_id = b.id AND r.status IN ('ACTIVE', 'CONVERTED')
         ), 0) AS availableQuantity
  FROM batches AS b JOIN materials AS m ON m.id = b.material_id
`;

function batchFromRow(row: BatchRow) {
  const { materialId, materialName, category, unit, ...batch } = row;
  return {
    ...batch,
    material: { id: materialId, name: materialName, category, unit },
  };
}

type Batch = ReturnType<typeof batchFromRow>;

export function batchNotFound() {
  return new ApiError(404, "BATCH_NOT_FOUND", "Batch not found.");
}

export async function lockBatch(connection: PoolConnection, id: string) {
  const [rows] = await connection.execute<
    (RowDataPacket & { supplierOrgId: string })[]
  >(
    "SELECT supplier_org_id AS supplierOrgId FROM batches WHERE id = CAST(? AS SIGNED) FOR UPDATE",
    [id],
  );
  return rows[0]?.supplierOrgId;
}

export async function getBatch(
  id: string,
  db: Pool | PoolConnection = mysqlPool(),
) {
  const [rows] = await db.execute<BatchRow[]>(
    `${batchSelect} WHERE b.id = CAST(? AS SIGNED)`,
    [id],
  );
  if (!rows[0]) throw batchNotFound();
  return batchFromRow(rows[0]);
}

export async function listBatches(params: URLSearchParams) {
  const rawLimit = params.get("limit") ?? "20";
  const limit = Number(rawLimit);
  if (!/^[1-9][0-9]?$/.test(rawLimit) || limit > 50) {
    throw invalidInput("limit must be an integer from 1 to 50.");
  }
  const conditions = ["b.status = 'OPEN'"];
  const values: string[] = [];
  const materialId = params.get("materialId");
  if (materialId !== null) {
    conditions.push("b.material_id = CAST(? AS SIGNED)");
    values.push(readId(materialId, "materialId"));
  }
  const afterId = params.get("afterId");
  if (afterId !== null) {
    conditions.push("b.id > CAST(? AS SIGNED)");
    values.push(readId(afterId, "afterId"));
  }
  const [rows] = await mysqlPool().execute<BatchRow[]>(
    `${batchSelect} WHERE ${conditions.join(" AND ")} ORDER BY b.id LIMIT ?`,
    [...values, String(limit + 1)],
  );
  return {
    items: rows.slice(0, limit).map(batchFromRow),
    nextAfterId: rows.length > limit ? rows[limit - 1].batchId : null,
  };
}

function readDescription(value: unknown) {
  if (typeof value !== "string")
    throw invalidInput("description must be a string.");
  const description = value.trim();
  if (Buffer.byteLength(description, "utf8") > 65535) {
    throw invalidInput(
      "description must be a string of at most 65,535 UTF-8 bytes.",
    );
  }
  return description;
}

export async function writeBatchIndexEvent(
  connection: PoolConnection,
  batch: Batch,
) {
  const { totalQuantity: _totalQuantity, ...snapshot } = batch;
  const payload = {
    type: "batch.search.upsert",
    schemaVersion: 1,
    batch: snapshot,
  };
  await connection.execute(
    "INSERT INTO batch_index_events (batch_id, batch_revision, payload) VALUES (?, ?, ?)",
    [batch.batchId, batch.revision, JSON.stringify(payload)],
  );
}

export async function publishBatch(request: Request, supplierOrgId: string) {
  const body = await readObject(request, [
    "materialId",
    "batchCode",
    "description",
    "location",
    "totalQuantity",
  ]);
  const materialId = readId(body.materialId, "materialId");
  const batchCode = readText(body.batchCode, "batchCode", 64);
  const description = readDescription(body.description);
  const location = readText(body.location, "location", 160);
  const totalQuantity = readQuantity(body.totalQuantity, "totalQuantity");
  return mysqlTransaction(async (connection) => {
    try {
      await connection.execute(
        `INSERT INTO batches (supplier_org_id, material_id, batch_code, description, location, total_quantity)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          supplierOrgId,
          materialId,
          batchCode,
          description,
          location,
          totalQuantity,
        ],
      );
    } catch (error) {
      if (hasMysqlError(error, "ER_DUP_ENTRY")) {
        throw new ApiError(
          409,
          "BATCH_CODE_EXISTS",
          "This supplier already uses that batch code.",
        );
      }
      if (hasMysqlError(error, "ER_NO_REFERENCED_ROW_2")) {
        throw new ApiError(404, "MATERIAL_NOT_FOUND", "Material not found.");
      }
      throw error;
    }
    const [rows] = await connection.execute<BatchRow[]>(
      `${batchSelect} WHERE b.id = LAST_INSERT_ID()`,
    );
    if (!rows[0]) throw new Error("The inserted batch could not be read.");
    const batch = batchFromRow(rows[0]);
    await writeBatchIndexEvent(connection, batch);
    return batch;
  });
}

export async function editBatch(
  request: Request,
  id: string,
  supplierOrgId: string,
) {
  const body = await readObject(request, [
    "description",
    "location",
    "totalQuantity",
    "status",
  ]);
  if (Object.keys(body).length === 0)
    throw invalidInput("Provide at least one batch field.");
  const description =
    body.description === undefined
      ? undefined
      : readDescription(body.description);
  const location =
    body.location === undefined
      ? undefined
      : readText(body.location, "location", 160);
  const totalQuantity =
    body.totalQuantity === undefined
      ? undefined
      : readQuantity(body.totalQuantity, "totalQuantity");
  const status = body.status;
  if (status !== undefined && status !== "OPEN" && status !== "CLOSED") {
    throw invalidInput("status must be OPEN or CLOSED.");
  }

  return mysqlTransaction(async (connection) => {
    const owner = await lockBatch(connection, id);
    if (!owner) throw batchNotFound();
    if (owner !== supplierOrgId) {
      throw new ApiError(
        403,
        "BATCH_FORBIDDEN",
        "Only the supplier can edit this batch.",
      );
    }
    const current = await getBatch(id, connection);
    if (current.status === "CLOSED" && status === "OPEN") {
      throw new ApiError(
        409,
        "BATCH_CLOSED",
        "A closed batch cannot be reopened.",
      );
    }
    const updated = {
      description: description ?? current.description,
      location: location ?? current.location,
      totalQuantity: totalQuantity ?? current.totalQuantity,
      status: status ?? current.status,
    };
    if (
      updated.description === current.description &&
      updated.location === current.location &&
      updated.totalQuantity === current.totalQuantity &&
      updated.status === current.status
    ) {
      return current;
    }
    if (totalQuantity !== undefined) {
      const allocated =
        quantityUnits(current.totalQuantity) -
        quantityUnits(current.availableQuantity);
      if (quantityUnits(totalQuantity) < allocated) {
        throw new ApiError(
          409,
          "QUANTITY_ALLOCATED",
          "Total quantity must cover existing reservations and orders.",
        );
      }
    }
    await connection.execute(
      `UPDATE batches SET description = ?, location = ?, total_quantity = ?, status = ?, revision = revision + 1
       WHERE id = CAST(? AS SIGNED)`,
      [
        updated.description,
        updated.location,
        updated.totalQuantity,
        updated.status,
        id,
      ],
    );
    const batch = await getBatch(id, connection);
    await writeBatchIndexEvent(connection, batch);
    return batch;
  });
}

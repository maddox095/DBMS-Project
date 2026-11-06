import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import {
  batchNotFound,
  getBatch,
  lockBatch,
  writeBatchIndexEvent,
} from "./batches";
import { ApiError, invalidInput } from "./http";
import { hasMysqlError, mysqlTransaction } from "./mysql";
import { quantityUnits } from "./validation";

type ReservationStatus = "ACTIVE" | "CANCELLED" | "CONVERTED";

export interface ReservationRow extends RowDataPacket {
  reservationId: string;
  batchId: string;
  recipientOrgId: string;
  quantity: string;
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}

interface OrderRow extends RowDataPacket {
  orderId: string;
  reservationId: string;
  placedAt: Date;
}

const reservationSelect = `
  SELECT id AS reservationId, batch_id AS batchId, recipient_org_id AS recipientOrgId,
         quantity, status, created_at AS createdAt, updated_at AS updatedAt
  FROM reservations
`;

export function serializeReservation(row: ReservationRow) {
  return {
    reservationId: row.reservationId,
    batchId: row.batchId,
    recipientOrgId: row.recipientOrgId,
    quantity: row.quantity,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function readRequestKey(request: Request) {
  const key = request.headers.get("Idempotency-Key");
  if (!key || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(key)) {
    throw invalidInput("Idempotency-Key must be a UUID.");
  }
  return key.toLowerCase();
}

async function findByRequestKey(
  connection: PoolConnection,
  recipientOrgId: string,
  key: string,
) {
  const [rows] = await connection.execute<ReservationRow[]>(
    `${reservationSelect} WHERE recipient_org_id = CAST(? AS SIGNED) AND request_key = ?`,
    [recipientOrgId, key],
  );
  return rows[0];
}

async function getReservation(connection: PoolConnection, id: string) {
  const [rows] = await connection.execute<ReservationRow[]>(
    `${reservationSelect} WHERE id = CAST(? AS SIGNED)`,
    [id],
  );
  if (!rows[0]) {
    throw new ApiError(404, "RESERVATION_NOT_FOUND", "Reservation not found.");
  }
  return rows[0];
}

async function getOrder(connection: PoolConnection, reservationId: string) {
  const [rows] = await connection.execute<OrderRow[]>(
    `SELECT id AS orderId, reservation_id AS reservationId, placed_at AS placedAt
     FROM exchange_orders WHERE reservation_id = CAST(? AS SIGNED)`,
    [reservationId],
  );
  if (!rows[0]) throw new Error("The converted reservation has no order.");
  return { ...rows[0], placedAt: rows[0].placedAt.toISOString() };
}

async function recordAvailabilityChange(
  connection: PoolConnection,
  batchId: string,
) {
  await connection.execute(
    "UPDATE batches SET revision = revision + 1 WHERE id = CAST(? AS SIGNED)",
    [batchId],
  );
  await writeBatchIndexEvent(connection, await getBatch(batchId, connection));
}

function replayReservation(
  row: ReservationRow,
  batchId: string,
  quantity: string,
) {
  if (row.batchId !== batchId || row.quantity !== quantity) {
    throw new ApiError(
      409,
      "RESERVATION_KEY_CONFLICT",
      "This idempotency key was used for a different batch or quantity.",
    );
  }
  return { reservation: serializeReservation(row), created: false };
}

export async function reserveBatch(
  batchId: string,
  recipientOrgId: string,
  key: string,
  quantity: string,
) {
  return mysqlTransaction(async (connection) => {
    const supplierOrgId = await lockBatch(connection, batchId);
    const existing = await findByRequestKey(connection, recipientOrgId, key);
    if (existing) return replayReservation(existing, batchId, quantity);
    if (!supplierOrgId) throw batchNotFound();
    if (supplierOrgId === recipientOrgId) {
      throw new ApiError(
        403,
        "SELF_RESERVATION",
        "A supplier cannot reserve its own batch.",
      );
    }
    const batch = await getBatch(batchId, connection);
    if (batch.status !== "OPEN") {
      throw new ApiError(409, "BATCH_CLOSED", "This batch is closed.");
    }
    if (quantityUnits(quantity) > quantityUnits(batch.availableQuantity)) {
      throw new ApiError(
        409,
        "INSUFFICIENT_QUANTITY",
        "The requested quantity is no longer available.",
      );
    }
    try {
      await connection.execute(
        "INSERT INTO reservations (batch_id, recipient_org_id, request_key, quantity) VALUES (?, ?, ?, ?)",
        [batchId, recipientOrgId, key, quantity],
      );
    } catch (error) {
      if (hasMysqlError(error, "ER_DUP_ENTRY")) {
        // A concurrent request for another batch can win this recipient's key.
        const winner = await findByRequestKey(connection, recipientOrgId, key);
        if (winner) return replayReservation(winner, batchId, quantity);
      }
      throw error;
    }
    const row = await findByRequestKey(connection, recipientOrgId, key);
    if (!row) throw new Error("The inserted reservation could not be read.");
    await recordAvailabilityChange(connection, batchId);
    return { reservation: serializeReservation(row), created: true };
  });
}

async function withOwnedReservation<T>(
  id: string,
  recipientOrgId: string,
  work: (connection: PoolConnection, row: ReservationRow) => Promise<T>,
) {
  return mysqlTransaction(async (connection) => {
    const initial = await getReservation(connection, id);
    if (!(await lockBatch(connection, initial.batchId))) throw batchNotFound();
    const row = await getReservation(connection, id);
    if (row.recipientOrgId !== recipientOrgId) {
      throw new ApiError(
        403,
        "RESERVATION_FORBIDDEN",
        "Only the recipient can change this reservation.",
      );
    }
    return work(connection, row);
  });
}

async function setReservationStatus(
  connection: PoolConnection,
  id: string,
  status: "CANCELLED" | "CONVERTED",
) {
  await connection.execute(
    "UPDATE reservations SET status = ? WHERE id = CAST(? AS SIGNED)",
    [status, id],
  );
}

export function cancelReservation(id: string, recipientOrgId: string) {
  return withOwnedReservation(id, recipientOrgId, async (connection, row) => {
    if (row.status === "CANCELLED") return serializeReservation(row);
    if (row.status !== "ACTIVE") {
      throw new ApiError(
        409,
        "RESERVATION_CONVERTED",
        "This reservation already has an order.",
      );
    }
    await setReservationStatus(connection, id, "CANCELLED");
    await recordAvailabilityChange(connection, row.batchId);
    return serializeReservation(await getReservation(connection, id));
  });
}

export function placeOrder(id: string, recipientOrgId: string) {
  return withOwnedReservation(id, recipientOrgId, async (connection, row) => {
    if (row.status === "CONVERTED") {
      return { order: await getOrder(connection, id), created: false };
    }
    if (row.status !== "ACTIVE") {
      throw new ApiError(
        409,
        "RESERVATION_CANCELLED",
        "This reservation has been cancelled.",
      );
    }
    await setReservationStatus(connection, id, "CONVERTED");
    await connection.execute(
      "INSERT INTO exchange_orders (reservation_id) VALUES (?)",
      [id],
    );
    return { order: await getOrder(connection, id), created: true };
  });
}

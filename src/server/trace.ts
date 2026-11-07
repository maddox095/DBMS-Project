import type { RowDataPacket } from "mysql2/promise";
import { getBatch } from "./batches";
import { ApiError } from "./http";
import { mysqlTransaction } from "./mysql";
import { allOrderDetails } from "./order-details";
import { type ReservationRow, serializeReservation } from "./reservations";

interface Organization {
  id: string;
  name: string;
}

interface TraceRow extends ReservationRow {
  recipientName: string;
  orderId: string | null;
  placedAt: Date | null;
}

export function traceBatch(batchId: string, organizationId: string) {
  return mysqlTransaction(async (connection) => {
    const batch = await getBatch(batchId, connection);
    const isSupplier = batch.supplierOrgId === organizationId;
    const [rows] = await connection.execute<TraceRow[]>(
      `SELECT r.id AS reservationId, r.batch_id AS batchId,
              r.recipient_org_id AS recipientOrgId, r.quantity, r.status,
              r.created_at AS createdAt, r.updated_at AS updatedAt,
              recipient.name AS recipientName, orders.id AS orderId,
              orders.placed_at AS placedAt
       FROM reservations AS r
       JOIN organizations AS recipient ON recipient.id = r.recipient_org_id
       LEFT JOIN exchange_orders AS orders ON orders.reservation_id = r.id
       WHERE r.batch_id = CAST(? AS SIGNED)
       ${isSupplier ? "" : "AND r.recipient_org_id = CAST(? AS SIGNED)"}
       ORDER BY r.id`,
      isSupplier ? [batchId] : [batchId, organizationId],
    );
    if (!isSupplier && rows.length === 0) {
      throw new ApiError(
        403,
        "TRACE_FORBIDDEN",
        "Only the supplier and recipients can view this trace.",
      );
    }

    const [sources] = await connection.execute<
      (RowDataPacket & Organization)[]
    >("SELECT id, name FROM organizations WHERE id = CAST(? AS SIGNED)", [
      batch.supplierOrgId,
    ]);
    if (!sources[0])
      throw new Error("The batch source organization could not be read.");

    const details = await allOrderDetails(
      connection,
      rows.flatMap((row) => (row.orderId ? [row.orderId] : [])),
    );
    const recipients = new Map<string, Organization>();
    const reservations = [];
    const orders = [];
    for (const row of rows) {
      recipients.set(row.recipientOrgId, {
        id: row.recipientOrgId,
        name: row.recipientName,
      });
      reservations.push(serializeReservation(row));
      if (row.orderId !== null && row.placedAt !== null) {
        orders.push({
          orderId: row.orderId,
          reservationId: row.reservationId,
          placedAt: row.placedAt.toISOString(),
          fulfillment: details.get(row.orderId) ?? null,
        });
      }
    }
    return {
      batch,
      source: sources[0],
      recipients: [...recipients.values()],
      reservations,
      orders,
    };
  }, "snapshot");
}

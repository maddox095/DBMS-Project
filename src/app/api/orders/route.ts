import type { RowDataPacket } from "mysql2/promise";
import type { NextRequest } from "next/server";
import { currentOrganization } from "@/server/auth";
import { json, respond } from "@/server/http";
import { mysqlTransaction } from "@/server/mysql";
import { allOrderDetails } from "@/server/order-details";
import {
  type ReservationRow,
  serializeReservation,
} from "@/server/reservations";

type ActivityRow = ReservationRow &
  RowDataPacket & {
    orderId: string | null;
    placedAt: Date | null;
    batchCode: string;
    materialName: string;
    unit: string;
    partnerName: string;
  };

export function GET(request: NextRequest) {
  return respond(async () => {
    const organization = await currentOrganization(request);
    const producer = organization.role === "PRODUCER";
    return json(
      await mysqlTransaction(
        organization.role,
        async (connection) => {
          const [rows] = await connection.execute<ActivityRow[]>(
            `SELECT r.id AS reservationId,
        r.batch_id AS batchId, r.recipient_org_id AS recipientOrgId, r.quantity, r.status,
        r.created_at AS createdAt, r.updated_at AS updatedAt, b.batch_code AS batchCode,
        m.name AS materialName, m.unit, partner.name AS partnerName,
        o.id AS orderId, o.placed_at AS placedAt
        FROM reservations r JOIN batches b ON b.id = r.batch_id
        JOIN materials m ON m.id = b.material_id
        JOIN organizations partner ON partner.id = ${producer ? "r.recipient_org_id" : "b.supplier_org_id"}
        LEFT JOIN exchange_orders o ON o.reservation_id = r.id
        WHERE ${producer ? "b.supplier_org_id" : "r.recipient_org_id"} = ?
        ORDER BY r.id DESC`,
            [organization.id],
          );
          const details = await allOrderDetails(
            connection,
            rows.flatMap((row) => (row.orderId ? [row.orderId] : [])),
          );
          return {
            items: rows.map((row) => ({
              reservation: serializeReservation(row),
              batchCode: row.batchCode,
              materialName: row.materialName,
              unit: row.unit,
              partnerName: row.partnerName,
              order:
                row.orderId && row.placedAt
                  ? {
                      orderId: row.orderId,
                      reservationId: row.reservationId,
                      placedAt: row.placedAt.toISOString(),
                      fulfillment: details.get(row.orderId) ?? null,
                    }
                  : null,
            })),
          };
        },
        "snapshot",
      ),
    );
  });
}

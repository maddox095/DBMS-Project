import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { Fulfillment } from "@/types/order";
import { lockBatch } from "./batches";
import { ApiError, invalidInput } from "./http";
import { mysqlTransaction } from "./mysql";
import { quantityUnits, readText } from "./validation";

export const deliveryKeys = [
  "contactName",
  "email",
  "phone",
  "company",
  "addressLine",
  "city",
  "region",
  "postalCode",
  "country",
  "deliveryMethod",
  "requestedDate",
  "taxId",
  "notes",
];
export const quotationKeys = [
  "unitPrice",
  "freight",
  "taxPercent",
  "validUntil",
  "terms",
];

function optional(value: unknown, field: string, max: number) {
  return value === undefined || value === "" ? "" : readText(value, field, max);
}

function date(value: unknown, field: string) {
  const text = readText(value, field, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
    !Number.isFinite(Date.parse(text)) ||
    new Date(text).toISOString().slice(0, 10) !== text
  ) {
    throw invalidInput(`${field} must be a valid date (YYYY-MM-DD).`);
  }
  if (text < new Date().toISOString().slice(0, 10))
    throw invalidInput(`${field} cannot be in the past.`);
  return text;
}

export function readDelivery(body: Record<string, unknown>) {
  const email = readText(body.email, "email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw invalidInput("Enter a valid email address.");
  const phone = readText(body.phone, "phone", 32);
  if (
    !/^[+0-9().\s-]{7,32}$/.test(phone) ||
    phone.replace(/\D/g, "").length < 7
  )
    throw invalidInput("Enter a valid contact phone number.");
  if (body.deliveryMethod !== "DELIVERY" && body.deliveryMethod !== "PICKUP")
    throw invalidInput("Choose delivery or pickup.");
  return {
    contactName: readText(body.contactName, "contactName", 120),
    email,
    phone,
    company: readText(body.company, "company", 160),
    addressLine: readText(body.addressLine, "addressLine", 300),
    city: readText(body.city, "city", 100),
    region: readText(body.region, "region", 100),
    postalCode: readText(body.postalCode, "postalCode", 20),
    country: readText(body.country, "country", 80),
    deliveryMethod: body.deliveryMethod,
    requestedDate:
      body.requestedDate === undefined || body.requestedDate === ""
        ? null
        : date(body.requestedDate, "requestedDate"),
    taxId: optional(body.taxId, "taxId", 40),
    notes: optional(body.notes, "notes", 2000),
  };
}

export async function saveDelivery(
  connection: PoolConnection,
  orderId: string,
  details: ReturnType<typeof readDelivery>,
) {
  await connection.execute(
    `INSERT INTO order_fulfillments
    (order_id, contact_name, email, phone, company, address_line, city, region, postal_code,
     country, delivery_method, requested_date, tax_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderId, ...Object.values(details)],
  );
}

type FulfillmentRow = RowDataPacket &
  Omit<Fulfillment, "quotedAt" | "confirmedAt"> & {
    orderId: string;
    quotedAt: Date | null;
    confirmedAt: Date | null;
  };

export async function allOrderDetails(
  connection: PoolConnection,
  ids: string[],
) {
  if (!ids.length) return new Map<string, Fulfillment>();
  const [rows] = await connection.execute<FulfillmentRow[]>(
    `SELECT order_id AS orderId,
    contact_name AS contactName, email, phone, company, address_line AS addressLine,
    city, region, postal_code AS postalCode, country, delivery_method AS deliveryMethod,
    DATE_FORMAT(requested_date, '%Y-%m-%d') AS requestedDate, tax_id AS taxId, notes, status,
    unit_price AS unitPrice, freight, tax_percent AS taxPercent, subtotal, tax_amount AS taxAmount,
    total, currency, DATE_FORMAT(valid_until, '%Y-%m-%d') AS validUntil, terms,
    quoted_at AS quotedAt, confirmed_at AS confirmedAt
    FROM order_fulfillments WHERE order_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  return new Map(
    rows.map(({ orderId, ...row }) => [
      orderId,
      {
        ...row,
        quotedAt: row.quotedAt?.toISOString() ?? null,
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
      },
    ]),
  );
}

export async function orderDetails(
  connection: PoolConnection,
  orderId: string,
) {
  return (await allOrderDetails(connection, [orderId])).get(orderId) ?? null;
}

function cents(value: unknown, field: string, positive = false) {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value)
  )
    throw invalidInput(
      `${field} must be an amount with up to two decimal places.`,
    );
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (positive && amount === BigInt(0))
    throw invalidInput(`${field} must be greater than zero.`);
  return amount;
}
function money(value: bigint) {
  return `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}`;
}

export function readQuotation(body: Record<string, unknown>, quantity: string) {
  const unitPrice = cents(body.unitPrice, "unitPrice", true);
  const freight = cents(body.freight, "freight");
  const tax = cents(body.taxPercent, "taxPercent");
  if (tax > BigInt(10000))
    throw invalidInput("taxPercent must be from 0 to 100.");
  const subtotal =
    (unitPrice * quantityUnits(quantity) + BigInt(500)) / BigInt(1000);
  if (!subtotal)
    throw invalidInput("The material subtotal must be at least 0.01 INR.");
  const taxAmount = ((subtotal + freight) * tax + BigInt(5000)) / BigInt(10000);
  return {
    unitPrice: money(unitPrice),
    freight: money(freight),
    taxPercent: money(tax),
    subtotal: money(subtotal),
    taxAmount: money(taxAmount),
    total: money(subtotal + freight + taxAmount),
    validUntil: date(body.validUntil, "validUntil"),
    terms: readText(body.terms, "terms", 2000),
  };
}

export function changeOrder(
  orderId: string,
  organizationId: string,
  body: Record<string, unknown> | null,
) {
  return mysqlTransaction(
    body ? "PRODUCER" : "CONSUMER",
    async (connection) => {
      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT r.batch_id AS batchId,
      r.recipient_org_id AS recipientOrgId, r.quantity FROM exchange_orders o
      JOIN reservations r ON r.id = o.reservation_id WHERE o.id = ?`,
        [orderId],
      );
      const row = rows[0];
      if (!row) throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found.");
      const supplierOrgId = await lockBatch(connection, row.batchId);
      if (organizationId !== (body ? supplierOrgId : row.recipientOrgId))
        throw new ApiError(
          403,
          "ORDER_FORBIDDEN",
          body
            ? "Only the supplier can issue a quotation."
            : "Only the recipient can confirm this order.",
        );
      const details = await orderDetails(connection, orderId);
      if (!details)
        throw new ApiError(
          409,
          "DELIVERY_REQUIRED",
          "This earlier order has no delivery request.",
        );
      if (body) {
        if (details.status !== "QUOTE_REQUESTED")
          throw new ApiError(
            409,
            "QUOTE_ALREADY_ISSUED",
            "A quotation has already been issued for this request.",
          );
        const quote = readQuotation(body, row.quantity);
        await connection.execute(
          "CALL record_supplier_quote(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          [orderId, organizationId, ...Object.values(quote)],
        );
      } else {
        if (details.status === "CONFIRMED")
          return orderDetails(connection, orderId);
        if (details.status !== "QUOTED")
          throw new ApiError(
            409,
            "QUOTE_REQUIRED",
            "Wait for the supplier's quotation before confirming.",
          );
        if (
          !details.validUntil ||
          details.validUntil < new Date().toISOString().slice(0, 10)
        )
          throw new ApiError(
            409,
            "QUOTE_EXPIRED",
            "This quotation has expired. Contact the supplier.",
          );
        await connection.execute("CALL confirm_recipient_order(?, ?)", [
          orderId,
          organizationId,
        ]);
      }
      return orderDetails(connection, orderId);
    },
  );
}

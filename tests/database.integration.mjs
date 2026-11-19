import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mysqlPool } from "../src/server/mysql-pool.mjs";

const producer = mysqlPool("PRODUCER");
const consumer = mysqlPool("CONSUMER");
const auth = mysqlPool("auth");
const worker = mysqlPool("worker");
const admin = mysqlPool("admin");
const permissionDenied = /command denied|execute command denied/i;

try {
  for (const [pool, name] of [
    [producer, "producer"],
    [consumer, "consumer"],
    [auth, "auth"],
    [worker, "worker"],
  ]) {
    const [[row]] = await pool.query("SELECT CURRENT_ROLE() AS roles");
    assert.match(row.roles, new RegExp(`exchange_${name}_role`));
  }
  await assert.rejects(
    consumer.query("UPDATE batches SET status = 'CLOSED' WHERE 1 = 0"),
    permissionDenied,
  );
  await assert.rejects(
    consumer.query(
      "CALL record_supplier_quote(0, 0, 1, 0, 0, 1, 0, 1, UTC_DATE(), 'test')",
    ),
    permissionDenied,
  );
  await assert.rejects(
    producer.query("UPDATE reservations SET status = 'CANCELLED' WHERE 1 = 0"),
    permissionDenied,
  );
  await assert.rejects(
    producer.query("CALL confirm_recipient_order(0, 0)"),
    permissionDenied,
  );
  await assert.rejects(
    producer.query("SELECT password_hash FROM auth_users LIMIT 0"),
    permissionDenied,
  );
  await assert.rejects(
    auth.query("UPDATE batches SET revision = revision + 1 WHERE 1 = 0"),
    permissionDenied,
  );
  await assert.rejects(
    worker.query("UPDATE batches SET revision = revision + 1 WHERE 1 = 0"),
    permissionDenied,
  );
  await assert.rejects(
    worker.query("SELECT email FROM order_fulfillments LIMIT 0"),
    permissionDenied,
  );

  // The exchange test covers successful calls. Direct SQL must reject invalid
  // ownership/roles even when the caller can reach the routine or table.
  await assert.rejects(
    producer.query(
      "CALL record_supplier_quote(0, 0, 1, 0, 0, 1, 0, 1, UTC_DATE(), 'test')",
    ),
    /ineligible for a supplier quotation/i,
  );
  await assert.rejects(
    consumer.query("CALL confirm_recipient_order(0, 0)"),
    /ineligible for recipient confirmation/i,
  );
  const connection = await producer.getConnection();
  try {
    await connection.beginTransaction();
    await assert.rejects(
      connection.execute(
        `INSERT INTO batches (supplier_org_id, material_id, batch_code, description, location, total_quantity)
         SELECT o.id, m.id, ?, '', 'Verification', 1
         FROM organizations o CROSS JOIN materials m
         WHERE o.role = 'CONSUMER' LIMIT 1`,
        [crypto.randomUUID()],
      ),
      /supplier must be a producer/i,
    );
  } finally {
    await connection.rollback();
    connection.release();
  }

  const [[allocation]] = await admin.query(
    "SELECT allocated_batch_quantity(0) AS quantity",
  );
  assert.equal(allocation.quantity, "0.000");
  const report = await readFile(
    new URL("../db/mysql/examples/weekly_confirmations.sql", import.meta.url),
    "utf8",
  );
  const [days] = await producer.query(report);
  assert.equal(days.length, 7);
  for (let index = 1; index < days.length; index++) {
    assert.equal(days[index].day - days[index - 1].day, 86400000);
  }
  console.log(
    "PASS: MySQL default roles, forbidden operations, routine and trigger enforcement, allocation function, and seven-day recursive report.",
  );
} finally {
  await Promise.all(
    [admin, auth, producer, consumer, worker].map((pool) => pool.end()),
  );
}

// Run against the local application with its worker and isolated databases running.
// Creates one verification batch, retains its audit records, and closes it afterward.
const assert = require("node:assert/strict");
const origin = process.env.TEST_APP_URL ?? "http://127.0.0.1:3000";
const base = `${origin}/api`;
const sessionCookie = (response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith("exchange_session="))
    .split(";")[0];

async function assertVectorRemoval(batch, closed) {
  const { postgresPool } = await import("../src/server/postgres.mjs");
  const { writeBatchProjection } = await import("../worker/indexing.mjs");
  const postgres = postgresPool();
  const projection = `SELECT
    (SELECT revision FROM batch_search WHERE batch_id = $1) AS vector_revision,
    (SELECT revision FROM batch_search_removals WHERE batch_id = $1) AS removal_revision`;
  try {
    const deadline = Date.now() + 60000;
    for (;;) {
      const {
        rows: [row],
      } = await postgres.query(projection, [batch.batchId]);
      if (row.removal_revision === closed.revision) {
        assert.equal(row.vector_revision, null);
        break;
      }
      assert(
        Date.now() < deadline,
        "Worker did not remove the closed batch vector.",
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const connection = await postgres.connect();
    try {
      await connection.query("BEGIN");
      await writeBatchProjection(connection, batch);
      await writeBatchProjection(connection, {
        ...batch,
        revision: closed.revision,
      });
      const {
        rows: [row],
      } = await connection.query(projection, [batch.batchId]);
      assert.deepEqual(row, {
        vector_revision: null,
        removal_revision: closed.revision,
      });
    } finally {
      await connection.query("ROLLBACK");
      connection.release();
    }
  } finally {
    await postgres.end();
  }
}

(async () => {
  const sessions = {};
  const orgIds = {};
  const run = crypto.randomUUID();
  async function request(path, org, body, expected = 200, extra = {}) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(org
          ? { Cookie: sessions[org], "X-Organization-Id": orgIds[org] }
          : {}),
        ...(body !== undefined
          ? { "Content-Type": "application/json", Origin: origin }
          : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    return data;
  }
  for (const id of ["1", "2", "3"]) {
    const email = `exchange-${run}-${id}@example.com`;
    const password = `${crypto.randomUUID()}!aA7`;
    const r = await fetch(`${base}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        fullName: "Exchange Verification",
        email,
        password,
        companyName: `Exchange Verification ${run} ${id}`,
        role: id === "1" ? "PRODUCER" : "CONSUMER",
      }),
    });
    assert.equal(r.status, 201);
    orgIds[id] = (await r.json()).organization.id;
    sessions[id] = sessionCookie(r);
    await request("/auth/logout", id, {});
    await request("/orders", id, undefined, 401);
    const login = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).organization.id, orgIds[id]);
    sessions[id] = sessionCookie(login);
  }
  const { items: materials } = await request("/materials", "1");
  const batch = await request(
    "/batches",
    "1",
    {
      materialId: materials.find((x) => x.name === "Fly ash").id,
      batchCode: `VERIFY-${Date.now()}`,
      description: "Quality verification lot for cement blending.",
      location: "Bengaluru",
      totalQuantity: "5.555",
    },
    201,
  );
  let closed;
  try {
    const selected = await request("/auth/session", "1");
    assert.equal(selected.organization.role, "PRODUCER");
    const consumerSession = await request("/auth/session", "2");
    assert.equal(consumerSession.organization.role, "CONSUMER");
    const own = await request("/batches?limit=50", "1");
    assert(own.items.every((item) => item.supplierOrgId === orgIds["1"]));
    assert(own.items.some((item) => item.batchId === batch.batchId));
    await request(
      "/batches",
      "2",
      {
        materialId: batch.material.id,
        batchCode: "FORBIDDEN",
        description: "",
        location: "Test",
        totalQuantity: "1.000",
      },
      403,
    );
    await request(
      `/batches/${batch.batchId}/reservations`,
      "1",
      { quantity: "1.000" },
      403,
      { "Idempotency-Key": crypto.randomUUID() },
    );
    await request(
      `/batches/${batch.batchId}/reservations`,
      "2",
      { quantity: "1.000" },
      409,
      {
        "Idempotency-Key": crypto.randomUUID(),
        "X-Organization-Id": orgIds["3"],
      },
    );
    await request("/search?q=cement", "1", undefined, 403);
    const until = Date.now() + 60000;
    while (true) {
      const indexed = await request(
        "/search?q=cement&minSimilarity=0&limit=50",
        "2",
      );
      if (indexed.items.some((item) => item.batchId === batch.batchId)) break;
      assert(
        Date.now() < until,
        "Worker did not index the verification batch within 60 seconds.",
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    const broad = await request(
      "/search?q=cement&minSimilarity=0&limit=1",
      "2",
    );
    assert(broad.stats.searchedCount >= 1);
    assert(broad.stats.matchedCount >= broad.items.length);
    assert.equal(broad.items.length, 1);
    assert(broad.stats.elapsedMs > 0);
    const strict = await request("/search?q=cement&minSimilarity=1", "2");
    assert.equal(strict.items.length, 0);
    assert.equal(strict.stats.matchedCount, 0);
    assert.equal(strict.stats.searchedCount, broad.stats.searchedCount);
    for (const threshold of ["-1", "1.01", "NaN", ""])
      await request(
        `/search?q=cement&minSimilarity=${threshold}`,
        "2",
        undefined,
        400,
      );
    const reservation = await request(
      `/batches/${batch.batchId}/reservations`,
      "2",
      { quantity: "1.234" },
      201,
      { "Idempotency-Key": crypto.randomUUID() },
    );
    const delivery = {
      contactName: "Aarav Rao",
      email: "procurement@example.com",
      phone: "+91 90000 00000",
      company: "Bengaluru Cement Lab",
      addressLine: "24 Industrial Estate",
      city: "Bengaluru",
      region: "Karnataka",
      postalCode: "560001",
      country: "India",
      deliveryMethod: "DELIVERY",
      requestedDate: "2099-12-01",
      taxId: "",
      notes: "Covered vehicle; call before arrival.",
    };
    await request(
      `/reservations/${reservation.reservationId}/order`,
      "2",
      { ...delivery, email: "invalid" },
      400,
    );
    let trace = await request(`/batches/${batch.batchId}/trace`, "2");
    assert.equal(trace.reservations[0].status, "ACTIVE");
    assert.equal(trace.orders.length, 0);
    const order = await request(
      `/reservations/${reservation.reservationId}/order`,
      "2",
      delivery,
      201,
    );
    assert.equal(order.fulfillment.email, delivery.email);
    assert.equal(order.fulfillment.status, "QUOTE_REQUESTED");
    const replay = await request(
      `/reservations/${reservation.reservationId}/order`,
      "2",
      delivery,
      200,
    );
    assert.equal(replay.orderId, order.orderId);
    await request(`/orders/${order.orderId}/confirm`, "2", {}, 409);
    await request(`/orders/${order.orderId}/confirm`, "1", {}, 403);
    await request(`/batches/${batch.batchId}/trace`, "3", undefined, 403);
    const quote = {
      unitPrice: "12.34",
      freight: "3.21",
      taxPercent: "18.5",
      validUntil: "2099-12-31",
      terms:
        "Dispatch within three business days of confirmation. Payment on delivery.",
    };
    await request(`/orders/${order.orderId}/quotation`, "2", quote, 403);
    for (const invalid of [
      { unitPrice: "-1" },
      { taxPercent: "101" },
      { validUntil: "2099-02-30" },
      { freight: "1.001" },
    ])
      await request(
        `/orders/${order.orderId}/quotation`,
        "1",
        { ...quote, ...invalid },
        400,
      );
    const results = await Promise.all(
      [1, 2].map(() =>
        fetch(`${base}/orders/${order.orderId}/quotation`, {
          method: "POST",
          headers: {
            Cookie: sessions["1"],
            "X-Organization-Id": orgIds["1"],
            "Content-Type": "application/json",
          },
          body: JSON.stringify(quote),
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    trace = await request(`/batches/${batch.batchId}/trace`, "2");
    const buyerDashboard = await request("/orders", "2");
    assert(
      buyerDashboard.items.every(
        (item) => item.reservation.recipientOrgId === orgIds["2"],
      ),
    );
    assert(
      buyerDashboard.items.some(
        (item) => item.order?.orderId === order.orderId,
      ),
    );
    const otherDashboard = await request("/orders", "3");
    assert(
      !otherDashboard.items.some(
        (item) => item.order?.orderId === order.orderId,
      ),
    );
    const supplierDashboard = await request("/orders", "1");
    assert(
      supplierDashboard.items.some(
        (item) => item.order?.orderId === order.orderId,
      ),
    );
    const pricing = trace.orders[0].fulfillment;
    assert.equal(pricing.subtotal, "15.23");
    assert.equal(pricing.taxAmount, "3.41");
    assert.equal(pricing.total, "21.85");
    await request(`/orders/${order.orderId}/confirm`, "3", {}, 403);
    const confirmations = await Promise.all(
      [1, 2].map(() => request(`/orders/${order.orderId}/confirm`, "2", {})),
    );
    assert(confirmations.every((x) => x.status === "CONFIRMED"));
    trace = await request(`/batches/${batch.batchId}/trace`, "1");
    assert.equal(trace.orders[0].fulfillment.status, "CONFIRMED");
    assert.equal(trace.batch.availableQuantity, "4.321");
    const hold = await request(
      `/batches/${batch.batchId}/reservations`,
      "2",
      { quantity: "0.500" },
      201,
      { "Idempotency-Key": crypto.randomUUID() },
    );
    const updateDeadline = Date.now() + 60000;
    for (;;) {
      const results = await request(
        "/search?q=cement&minSimilarity=0&limit=50",
        "2",
      );
      const indexed = results.items.find(
        (item) => item.batchId === batch.batchId,
      );
      if (indexed?.availableQuantity === "3.821") break;
      assert(
        Date.now() < updateDeadline,
        "Worker did not update the vector snapshot after the hold.",
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await request(`/reservations/${hold.reservationId}/cancel`, "2", {});
    const released = await request(`/batches/${batch.batchId}`, "1");
    assert.equal(released.availableQuantity, "4.321");
  } finally {
    const r = await fetch(`${base}/batches/${batch.batchId}`, {
      method: "PATCH",
      headers: {
        Cookie: sessions["1"],
        "X-Organization-Id": orgIds["1"],
        "Content-Type": "application/json",
        Origin: origin,
      },
      body: JSON.stringify({ status: "CLOSED" }),
    });
    assert.equal(r.status, 200);
    closed = await r.json();
  }
  assert.equal(closed.status, "CLOSED");
  await assertVectorRemoval(batch, closed);
  const closedSearch = await request(
    "/search?q=cement&minSimilarity=0&limit=50",
    "2",
  );
  assert(!closedSearch.items.some((item) => item.batchId === batch.batchId));
  const closedTrace = await request(`/batches/${batch.batchId}/trace`, "1");
  assert.equal(closedTrace.orders[0].fulfillment.status, "CONFIRMED");
  for (const id of ["1", "2", "3"]) {
    await request("/auth/logout", id, {});
    await request("/orders", id, undefined, 401);
  }
  console.log(
    "PASS: signup, logout and password login; role and ownership scope; publish, search, reserve, cancel, delivery request, concurrent quote and confirmation; trace retained after close; vector created, updated, deleted and protected against stale/equal revisions.",
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

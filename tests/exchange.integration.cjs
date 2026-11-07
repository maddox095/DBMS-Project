// Run against the local application with its worker and isolated databases running.
// Creates one verification batch, retains its audit records, and closes it afterward.
const assert = require("node:assert/strict");
const base = "http://127.0.0.1:3000/api";
(async () => {
  const sessions = {};
  async function request(path, org, body, expected = 200, extra = {}) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...(org ? { Cookie: sessions[org], "X-Organization-Id": org } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    assert.equal(response.status, expected, JSON.stringify(data));
    return data;
  }
  for (const id of ["1", "2", "3"]) {
    const r = await fetch(`${base}/demo-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: id }),
    });
    assert.equal(r.status, 200);
    sessions[id] = r.headers.get("set-cookie").split(";")[0];
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
  try {
    const selected = await request("/demo-session", "1");
    assert.equal(
      selected.organizations.find((item) => item.id === "1").role,
      "PRODUCER",
    );
    assert.equal(
      selected.organizations.find((item) => item.id === "2").role,
      "CONSUMER",
    );
    const own = await request("/batches?limit=50", "1");
    assert(own.items.every((item) => item.supplierOrgId === "1"));
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
      { "Idempotency-Key": crypto.randomUUID(), "X-Organization-Id": "3" },
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
            "X-Organization-Id": "1",
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
        (item) => item.reservation.recipientOrgId === "2",
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
    console.log(
      "PASS: fixed roles; producer-only publishing; consumer-only sourcing; own-batch reservation rejection; stale-account guard; scoped dashboards; search counts/timing/limit/threshold validation; delivery validation and persistence; scoped contact visibility; quotation authorization/rounding/concurrent issue; concurrent confirmation replay.",
    );
  } finally {
    const r = await fetch(`${base}/batches/${batch.batchId}`, {
      method: "PATCH",
      headers: {
        Cookie: sessions["1"],
        "X-Organization-Id": "1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "CLOSED" }),
    });
    assert.equal(r.status, 200);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

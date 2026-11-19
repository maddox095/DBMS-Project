const assert = require("node:assert/strict");
const { createHash, createHmac, randomBytes } = require("node:crypto");
const mysql = require("mysql2/promise");

const base = process.env.TEST_APP_URL ?? "http://127.0.0.1:3000";
const run = crypto.randomUUID();
const password = `${randomBytes(24).toString("base64url")}!aA7`;
const cookieFrom = (response) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith("exchange_session="))
    .split(";")[0];
const tokenHash = (cookie) =>
  createHash("sha256").update(cookie.split("=")[1]).digest();
let db;
let fixtureBatchId;
async function request(
  path,
  { method = "GET", body, cookie, headers = {} } = {},
  expected = 200,
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined
        ? { "Content-Type": "application/json", Origin: base }
        : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(
    response.status,
    expected,
    `Unexpected status for ${method} ${path}`,
  );
  return response;
}
function registration(suffix, role = "CONSUMER") {
  return {
    fullName: "Authentication Verification",
    email: `auth-${run}-${suffix}@example.com`,
    password,
    companyName: `Authentication Verification ${run} ${suffix}`,
    role,
  };
}
async function counts() {
  const [[row]] = await db.query(
    "SELECT (SELECT COUNT(*) FROM organizations) AS organizations, (SELECT COUNT(*) FROM auth_users) AS users",
  );
  return row;
}

(async () => {
  db = await mysql.createConnection({
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    timezone: "Z",
  });
  for (const path of [
    "/api/materials",
    "/api/batches",
    "/api/orders",
    "/api/search?q=cement",
    "/api/suppliers",
    "/api/batches/1/trace",
  ])
    await request(path, {}, 401);
  const anonymous = await (await request("/api/auth/session")).json();
  assert.deepEqual(anonymous, { user: null, organization: null });
  await request(
    "/api/demo-session",
    { method: "POST", body: { organizationId: "1" } },
    404,
  );
  if (process.env.DEMO_SESSION_SECRET) {
    const payload = `1.${Math.floor(Date.now() / 1000) + 3600}`;
    const mac = createHmac("sha256", process.env.DEMO_SESSION_SECRET)
      .update(payload)
      .digest("base64url");
    await request(
      "/api/orders",
      { cookie: `exchange_demo=${payload}.${mac}` },
      401,
    );
  }
  await request(
    "/api/auth/signup",
    { method: "POST", body: { ...registration("weak"), password: "short" } },
    400,
  );
  await request(
    "/api/auth/signup",
    { method: "POST", body: { ...registration("role"), role: "ADMIN" } },
    400,
  );
  await request(
    "/api/auth/signup",
    { method: "POST", body: { ...registration("claim"), organizationId: "1" } },
    400,
  );
  await request(
    "/api/auth/signup",
    {
      method: "POST",
      body: registration("cross"),
      headers: { Origin: "https://untrusted.example" },
    },
    403,
  );
  await request(
    "/api/auth/signup",
    {
      method: "POST",
      body: registration("plain"),
      headers: { "Content-Type": "text/plain" },
    },
    400,
  );
  await request(
    "/api/auth/signup",
    {
      method: "POST",
      body: { ...registration("large"), fullName: "x".repeat(17000) },
    },
    413,
  );
  let before = await counts();
  await request(
    "/api/auth/signup",
    {
      method: "POST",
      body: {
        ...registration("existing"),
        companyName: "  deccan   thermal works  ",
      },
    },
    409,
  );
  assert.deepEqual(
    await counts(),
    before,
    "A failed organization claim must roll back all records.",
  );

  const producer = registration("producer", "PRODUCER");
  const consumer = registration("consumer");
  const producerResponse = await request(
    "/api/auth/signup",
    { method: "POST", body: producer },
    201,
  );
  const producerCookie = cookieFrom(producerResponse);
  const producerData = await producerResponse.json();
  assert.equal(producerData.organization.role, "PRODUCER");
  const flags = producerResponse.headers
    .getSetCookie()
    .find((value) => value.startsWith("exchange_session="));
  assert.match(flags, /HttpOnly/i);
  assert.match(flags, /SameSite=lax/i);
  assert.match(flags, /Path=\//i);
  assert.match(flags, /Max-Age=28800/i);
  assert.equal(producerCookie.split("=")[1].length, 43);
  const consumerResponse = await request(
    "/api/auth/signup",
    { method: "POST", body: consumer },
    201,
  );
  let consumerCookie = cookieFrom(consumerResponse);
  const consumerData = await consumerResponse.json();
  assert.equal(consumerData.organization.role, "CONSUMER");
  assert.notEqual(consumerData.organization.id, producerData.organization.id);
  const [users] = await db.execute(
    "SELECT password_hash FROM auth_users WHERE email IN (?, ?) ORDER BY email",
    [producer.email, consumer.email],
  );
  assert(
    users.every((user) => user.password_hash.startsWith("scrypt$32768$8$3$")),
  );
  assert.notEqual(
    users[0].password_hash,
    users[1].password_hash,
    "Equal passwords require independent salts.",
  );
  const [[storedSession]] = await db.execute(
    "SELECT token_hash, expires_at, last_seen_at FROM auth_sessions WHERE token_hash = ?",
    [tokenHash(consumerCookie)],
  );
  assert(storedSession.token_hash.equals(tokenHash(consumerCookie)));
  assert(storedSession.expires_at > new Date(Date.now() + 7 * 60 * 60 * 1000));
  const current = await (
    await request("/api/auth/session", { cookie: consumerCookie })
  ).json();
  assert.equal(current.user.email, consumer.email);
  assert.equal(current.organization.id, consumerData.organization.id);
  assert.equal(current.organizations, undefined);
  assert.equal(current.user.passwordHash, undefined);
  assert.deepEqual(
    (await (await request("/api/orders", { cookie: consumerCookie })).json())
      .items,
    [],
  );
  const [fixture] = await db.execute(
    `INSERT INTO batches (supplier_org_id, material_id, batch_code, description, location, total_quantity)
     SELECT 1, id, ?, '', 'Verification', 1 FROM materials WHERE name = 'Fly ash' LIMIT 1`,
    [`AUTH-${run}`],
  );
  assert.equal(fixture.affectedRows, 1);
  fixtureBatchId = fixture.insertId;
  await request(
    `/api/batches/${fixtureBatchId}/trace`,
    { cookie: consumerCookie },
    403,
  );
  await request(
    `/api/batches/${fixtureBatchId}`,
    { cookie: producerCookie },
    403,
  );
  await request(
    "/api/batches",
    {
      method: "POST",
      cookie: consumerCookie,
      body: {},
      headers: { "X-Organization-Id": consumerData.organization.id },
    },
    403,
  );
  await request("/api/search?q=cement", { cookie: producerCookie }, 403);
  await request(
    "/api/auth/session",
    { method: "POST", cookie: consumerCookie, body: { organizationId: "1" } },
    405,
  );
  before = await counts();
  await request(
    "/api/auth/signup",
    {
      method: "POST",
      body: {
        ...registration("duplicate"),
        email: consumer.email.toUpperCase(),
      },
    },
    409,
  );
  assert.deepEqual(await counts(), before);
  const sameEmail = registration("race");
  const attempts = await Promise.all(
    [1, 2].map(() =>
      fetch(`${base}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sameEmail),
      }),
    ),
  );
  assert.deepEqual(
    attempts.map((response) => response.status).sort(),
    [201, 409],
  );
  const [[raceCount]] = await db.execute(
    "SELECT COUNT(*) AS count FROM auth_users WHERE email = ?",
    [sameEmail.email],
  );
  assert.equal(raceCount.count, 1);

  const knownFailure = await (
    await request(
      "/api/auth/login",
      {
        method: "POST",
        body: { email: consumer.email, password: `${password}wrong` },
      },
      401,
    )
  ).json();
  const unknownFailure = await (
    await request(
      "/api/auth/login",
      {
        method: "POST",
        body: { email: `missing-${run}@example.com`, password },
      },
      401,
    )
  ).json();
  assert.deepEqual(knownFailure, unknownFailure);
  await request(
    "/api/auth/login",
    {
      method: "POST",
      body: { email: consumer.email, password },
      headers: { Origin: "https://untrusted.example" },
    },
    403,
  );
  await request(
    "/api/auth/logout",
    {
      method: "POST",
      cookie: consumerCookie,
      body: {},
      headers: { Origin: "https://untrusted.example" },
    },
    403,
  );
  const loginResponse = await request("/api/auth/login", {
    method: "POST",
    cookie: consumerCookie,
    body: { email: consumer.email.toUpperCase(), password },
  });
  const rotatedCookie = cookieFrom(loginResponse);
  assert.notEqual(rotatedCookie, consumerCookie);
  await request("/api/orders", { cookie: consumerCookie }, 401);
  consumerCookie = rotatedCookie;
  await request(
    "/api/orders",
    { cookie: `exchange_session=${randomBytes(32).toString("base64url")}` },
    401,
  );
  await db.execute(
    "UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP - INTERVAL 31 MINUTE WHERE token_hash = ?",
    [tokenHash(consumerCookie)],
  );
  await request("/api/orders", { cookie: consumerCookie }, 401);
  let response = await request("/api/auth/login", {
    method: "POST",
    body: { email: consumer.email, password },
  });
  consumerCookie = cookieFrom(response);
  await db.execute(
    "UPDATE auth_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL 1 SECOND WHERE token_hash = ?",
    [tokenHash(consumerCookie)],
  );
  await request("/api/orders", { cookie: consumerCookie }, 401);
  response = await request("/api/auth/login", {
    method: "POST",
    body: { email: consumer.email, password },
  });
  consumerCookie = cookieFrom(response);
  await db.execute(
    "UPDATE auth_users SET disabled_at = CURRENT_TIMESTAMP WHERE email = ?",
    [consumer.email],
  );
  await request("/api/orders", { cookie: consumerCookie }, 401);
  await request(
    "/api/auth/login",
    { method: "POST", body: { email: consumer.email, password } },
    401,
  );
  await db.execute("UPDATE auth_users SET disabled_at = NULL WHERE email = ?", [
    consumer.email,
  ]);
  await request("/api/auth/logout", {
    method: "POST",
    cookie: consumerCookie,
    body: {},
  });
  await request("/api/orders", { cookie: consumerCookie }, 401);
  const [[remaining]] = await db.execute(
    "SELECT COUNT(*) AS count FROM auth_sessions WHERE token_hash = ?",
    [tokenHash(consumerCookie)],
  );
  assert.equal(remaining.count, 0);
  const rateEmail = `rate-${run}@example.com`;
  for (let attempt = 0; attempt < 10; attempt++)
    await request(
      "/api/auth/login",
      { method: "POST", body: { email: rateEmail, password } },
      401,
    );
  const limited = await request(
    "/api/auth/login",
    { method: "POST", body: { email: rateEmail, password } },
    429,
  );
  assert(Number(limited.headers.get("Retry-After")) > 0);
  console.log(
    "PASS: signup/login/logout, salted password hashing, opaque sessions, legacy-cookie rejection, organization-claim protection, duplicate signup rollback/race, generic login failures, role and ownership isolation, rotation/revocation/expiry/disabled accounts, cross-origin/body limits, and login throttling.",
  );
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!db) return;
    try {
      if (fixtureBatchId) {
        await db.execute("DELETE FROM batches WHERE id = ?", [fixtureBatchId]);
      }
    } finally {
      await db.end();
    }
  });

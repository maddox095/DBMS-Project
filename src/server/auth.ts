import { createHash, randomBytes } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import type { NextRequest, NextResponse } from "next/server";
import {
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./auth-password.mjs";
import { ApiError, invalidInput, json, readObject } from "./http";
import { hasMysqlError, mysqlPool, mysqlTransaction } from "./mysql";
import { readText } from "./validation";

const cookieName = "exchange_session";
const maxAge = 8 * 60 * 60;
type Role = "CONSUMER" | "PRODUCER";
interface SessionRow extends RowDataPacket {
  userId: string;
  fullName: string;
  email: string;
  organizationId: string;
  organizationName: string;
  role: Role;
}
function digest(value: string) {
  return createHash("sha256").update(value).digest();
}
function requestToken(request: NextRequest) {
  const token = request.cookies.get(cookieName)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function sessionData(row: SessionRow) {
  return {
    user: { id: row.userId, fullName: row.fullName, email: row.email },
    organization: {
      id: row.organizationId,
      name: row.organizationName,
      role: row.role,
    },
  };
}
export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("Origin");
  const host = request.headers.get("Host");
  const requestOrigin = host
    ? `${request.nextUrl.protocol}//${host}`
    : request.nextUrl.origin;
  if (
    (origin && origin !== requestOrigin) ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  ) {
    throw new ApiError(
      403,
      "ORIGIN_FORBIDDEN",
      "This request must come from this application.",
    );
  }
}
async function authBody(request: NextRequest, keys: string[]) {
  assertSameOrigin(request);
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") ?? "",
    )
  )
    throw invalidInput("Send application/json.");
  return readObject(request, keys, 16 * 1024);
}
function readEmail(value: unknown) {
  const email = readText(value, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw invalidInput("Enter a valid email address.");
  return email;
}
function readPassword(value: unknown, signup: boolean) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > 512 ||
    Array.from(value).length > 128 ||
    value.length === 0
  )
    throw invalidInput("Enter a password of up to 128 characters.");
  const problem = signup ? passwordProblem(value) : null;
  if (problem) throw invalidInput(problem);
  return value;
}
async function rateLimit(
  scope: string,
  identity: string,
  limit: number,
  seconds: number,
) {
  const window = Math.floor(Date.now() / (seconds * 1000));
  const bucket = digest(`${scope}:${identity}:${window}`);
  await mysqlPool("auth").execute(
    `INSERT INTO auth_rate_limits (bucket_hash, expires_at)
    VALUES (?, FROM_UNIXTIME(?)) ON DUPLICATE KEY UPDATE attempts = attempts + 1`,
    [bucket, (window + 1) * seconds],
  );
  const [rows] = await mysqlPool("auth").execute<RowDataPacket[]>(
    "SELECT attempts FROM auth_rate_limits WHERE bucket_hash = ?",
    [bucket],
  );
  if (rows[0].attempts > limit)
    throw new ApiError(
      429,
      "AUTH_RATE_LIMITED",
      "Too many attempts. Please try again after this rate-limit window expires.",
      Math.max(1, Math.ceil((window + 1) * seconds - Date.now() / 1000)),
    );
  await mysqlPool("auth").execute(
    "DELETE FROM auth_rate_limits WHERE expires_at < CURRENT_TIMESTAMP(6) LIMIT 100",
  );
}
export async function authenticatedSession(request: NextRequest) {
  const token = requestToken(request);
  if (!token) return null;
  const hash = digest(token);
  const [rows] = await mysqlPool("auth").execute<SessionRow[]>(
    `SELECT u.id AS userId, u.full_name AS fullName,
    u.email, o.id AS organizationId, o.name AS organizationName, o.role
    FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
    JOIN organizations o ON o.id = u.organization_id
    WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP(6)
      AND s.last_seen_at > CURRENT_TIMESTAMP(6) - INTERVAL 30 MINUTE AND u.disabled_at IS NULL`,
    [hash],
  );
  if (!rows[0]) return null;
  await mysqlPool("auth").execute(
    `UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP(6)
    WHERE token_hash = ? AND last_seen_at < CURRENT_TIMESTAMP(6) - INTERVAL 1 MINUTE`,
    [hash],
  );
  return sessionData(rows[0]);
}
export async function currentOrganization(request: NextRequest) {
  const session = await authenticatedSession(request);
  if (!session)
    throw new ApiError(401, "SESSION_REQUIRED", "Sign in to continue.");
  return session.organization;
}
export async function requireOrganizationRole(
  request: NextRequest,
  role: Role,
) {
  if (request.method !== "GET") assertSameOrigin(request);
  const organization = await currentOrganization(request);
  if (
    request.method !== "GET" &&
    request.headers.get("X-Organization-Id") !== organization.id
  )
    throw new ApiError(
      409,
      "ACCOUNT_CHANGED",
      "Your session changed. Refresh this page before continuing.",
    );
  if (organization.role !== role)
    throw new ApiError(
      403,
      "ROLE_FORBIDDEN",
      `This action is available only to ${role === "PRODUCER" ? "producers" : "consumers"}.`,
    );
  return organization.id;
}
async function createSession(
  connection: PoolConnection,
  request: NextRequest,
  userId: string,
) {
  const previous = requestToken(request);
  if (previous)
    await connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", [
      digest(previous),
    ]);
  const token = randomBytes(32).toString("base64url");
  await connection.execute(
    "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP(6) + INTERVAL 8 HOUR)",
    [digest(token), userId],
  );
  return token;
}
function attachSession(
  request: NextRequest,
  response: NextResponse,
  token: string,
) {
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge,
  });
  response.cookies.set("exchange_demo", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
export async function signup(request: NextRequest) {
  const body = await authBody(request, [
    "fullName",
    "email",
    "password",
    "companyName",
    "role",
  ]);
  const fullName = readText(body.fullName, "fullName", 120);
  const email = readEmail(body.email);
  const password = readPassword(body.password, true);
  const name = readText(
    readText(body.companyName, "companyName", 160)
      .normalize("NFKC")
      .replace(/\s+/gu, " "),
    "companyName",
    160,
  );
  if (body.role !== "PRODUCER" && body.role !== "CONSUMER")
    throw invalidInput("Choose Consumer or Producer.");
  const role = body.role;
  await rateLimit("signup", "global", 40, 3600);
  const passwordHash = await hashPassword(password);
  try {
    const result = await mysqlTransaction("auth", async (connection) => {
      await connection.execute(
        "INSERT INTO organizations (name, role) VALUES (?, ?)",
        [name, role],
      );
      const [orgs] = await connection.query<RowDataPacket[]>(
        "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
      );
      const organizationId = orgs[0].id as string;
      await connection.execute(
        "INSERT INTO auth_organization_names (name_key, organization_id) VALUES (?, ?)",
        [name.toLowerCase(), organizationId],
      );
      await connection.execute(
        "INSERT INTO auth_users (organization_id, full_name, email, password_hash) VALUES (?, ?, ?, ?)",
        [organizationId, fullName, email, passwordHash],
      );
      const [users] = await connection.query<RowDataPacket[]>(
        "SELECT CAST(LAST_INSERT_ID() AS CHAR) AS id",
      );
      const userId = users[0].id as string;
      return {
        token: await createSession(connection, request, userId),
        user: { id: userId, fullName, email },
        organization: { id: organizationId, name, role },
      };
    });
    return attachSession(
      request,
      json({ user: result.user, organization: result.organization }, 201),
      result.token,
    );
  } catch (error) {
    if (hasMysqlError(error, "ER_DUP_ENTRY"))
      throw new ApiError(
        409,
        "ACCOUNT_EXISTS",
        "An account or organization with those details already exists. Sign in or contact your organization administrator.",
      );
    throw error;
  }
}
export async function login(request: NextRequest) {
  const body = await authBody(request, ["email", "password"]);
  const email = readEmail(body.email);
  const password = readPassword(body.password, false);
  await rateLimit("login", "global", 200, 900);
  await rateLimit("login", email, 10, 900);
  const [rows] = await mysqlPool("auth").execute<
    (SessionRow & { passwordHash: string; disabledAt: Date | null })[]
  >(
    `SELECT u.id AS userId, u.full_name AS fullName, u.email, u.password_hash AS passwordHash, u.disabled_at AS disabledAt,
    o.id AS organizationId, o.name AS organizationName, o.role
    FROM auth_users u JOIN organizations o ON o.id = u.organization_id WHERE u.email = ?`,
    [email],
  );
  const row = rows[0];
  const valid = await verifyPassword(password, row?.passwordHash ?? null);
  if (!row || !valid || row.disabledAt)
    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "Email or password is incorrect.",
    );
  const token = await mysqlTransaction("auth", (connection) =>
    createSession(connection, request, row.userId),
  );
  return attachSession(request, json(sessionData(row)), token);
}
export async function logout(request: NextRequest) {
  await authBody(request, []);
  const token = requestToken(request);
  if (token)
    await mysqlPool("auth").execute(
      "DELETE FROM auth_sessions WHERE token_hash = ?",
      [digest(token)],
    );
  const response = json({ user: null, organization: null });
  response.cookies.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("exchange_demo", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

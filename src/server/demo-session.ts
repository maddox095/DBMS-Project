import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { ApiError } from "./http";
import { isId } from "./validation";

const cookieName = "exchange_demo";
const maxAge = 8 * 60 * 60;

export function requireDemoConfig() {
  const secret = process.env.DEMO_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError(
      503,
      "DEMO_SESSION_UNAVAILABLE",
      "Configure DEMO_SESSION_SECRET for the local demo.",
    );
  }
  return secret;
}

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest();
}

export function demoOrganizationId(request: NextRequest) {
  const value = request.cookies.get(cookieName)?.value;
  if (!value) return null;
  const [id, expiry, mac, extra] = value.split(".");
  if (
    extra !== undefined ||
    !isId(id) ||
    !/^\d{1,12}$/.test(expiry) ||
    Number(expiry) <= Math.floor(Date.now() / 1000) ||
    !/^[A-Za-z0-9_-]{43}$/.test(mac)
  )
    return null;

  const actual = Buffer.from(mac, "base64url");
  const expected = signature(`${id}.${expiry}`, requireDemoConfig());
  return timingSafeEqual(actual, expected) ? id : null;
}

export function requireOrganizationId(request: NextRequest) {
  const id = demoOrganizationId(request);
  if (!id)
    throw new ApiError(
      401,
      "SESSION_REQUIRED",
      "Select a demo organization first.",
    );
  return id;
}

export function setDemoSession(
  request: NextRequest,
  response: NextResponse,
  id: string,
) {
  const expiry = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `${id}.${expiry}`;
  const mac = signature(payload, requireDemoConfig()).toString("base64url");
  response.cookies.set(cookieName, `${payload}.${mac}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge,
  });
}

import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function invalidInput(message: string) {
  return new ApiError(400, "INVALID_INPUT", message);
}

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function respond(handle: () => Promise<Response>) {
  try {
    return await handle();
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    }
    console.error("API request failed", error);
    return json(
      { error: { code: "INTERNAL_ERROR", message: "The request failed." } },
      500,
    );
  }
}

export async function readObject(request: Request, allowedKeys: string[]) {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw invalidInput("Send a valid JSON object.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidInput("Send a valid JSON object.");
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key))
      throw invalidInput(`Unexpected field: ${key}.`);
  }
  return value as Record<string, unknown>;
}

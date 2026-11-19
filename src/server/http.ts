import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfter?: number,
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
      const response = json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
      if (error.retryAfter !== undefined)
        response.headers.set("Retry-After", String(error.retryAfter));
      return response;
    }
    console.error("API request failed", error);
    return json(
      { error: { code: "INTERNAL_ERROR", message: "The request failed." } },
      500,
    );
  }
}

export async function readObject(
  request: Request,
  allowedKeys: string[],
  maxBytes = 128 * 1024,
) {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "BODY_TOO_LARGE", "The request is too large.");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
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

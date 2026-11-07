import { useEffect, useState } from "react";

export interface Organization {
  id: string;
  name: string;
}

export interface Material {
  id: string;
  name: string;
  category: string;
  unit: string;
}

interface BatchSnapshot {
  batchId: string;
  supplierOrgId: string;
  material: Material;
  batchCode: string;
  description: string;
  location: string;
  status: "OPEN" | "CLOSED";
  availableQuantity: string;
  revision: string;
}

export interface Batch extends BatchSnapshot {
  totalQuantity: string;
}

export interface SearchResult extends BatchSnapshot {
  score: number;
}

export interface Reservation {
  reservationId: string;
  batchId: string;
  recipientOrgId: string;
  quantity: string;
  status: "ACTIVE" | "CANCELLED" | "CONVERTED";
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  orderId: string;
  reservationId: string;
  placedAt: string;
}

export interface Trace {
  batch: Batch;
  source: Organization;
  recipients: Organization[];
  reservations: Reservation[];
  orders: Order[];
}

class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request failed. Try again.";
}

export async function apiRequest<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw new RequestError(
      data?.error?.message ??
        "The service could not complete the request. Try again.",
      response.status,
    );
  }
  return data as T;
}

export function positiveQuantity(value: string) {
  const quantity = apiQuantity(value);
  if (quantity === "0.000")
    throw new Error("Enter a quantity greater than zero.");
  return quantity;
}

export function jsonOptions(
  method: "POST" | "PATCH",
  body: unknown,
): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function apiQuantity(value: string) {
  const match = /^([0-9]{1,11})(?:\.([0-9]{1,3}))?$/.exec(value.trim());
  if (!match) {
    throw new Error(
      "Enter a quantity with up to 11 whole digits and three decimal places.",
    );
  }
  return `${Number(match[1])}.${(match[2] ?? "").padEnd(3, "0")}`;
}

export function useApiData<T>(
  path: string | null,
  identity: string | null = null,
) {
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${identity ?? ""}:${attempt}:${path ?? ""}`;
  const [result, setResult] = useState<{
    requestKey: string;
    data?: T;
    error?: string;
    errorStatus?: number;
  }>();

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    apiRequest<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ requestKey, data });
      },
      (error) => {
        if (!controller.signal.aborted)
          setResult({
            requestKey,
            error: errorMessage(error),
            errorStatus:
              error instanceof RequestError ? error.status : undefined,
          });
      },
    );
    return () => controller.abort();
  }, [path, requestKey]);

  const current =
    path && result?.requestKey === requestKey ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    errorStatus: current?.errorStatus,
    loading: path !== null && current === undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}

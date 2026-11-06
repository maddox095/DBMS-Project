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

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request failed. Try again.";
}

export async function apiRequest<T>(path: string, options?: RequestInit) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw new Error(
      data?.error?.message ??
        "The service could not complete the request. Try again.",
    );
  }
  return data as T;
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
          setResult({ requestKey, error: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [path, requestKey]);

  const current =
    path && result?.requestKey === requestKey ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: path !== null && current === undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}

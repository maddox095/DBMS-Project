"use client";

import { useState } from "react";
import {
  apiRequest,
  errorMessage,
  type Organization,
  useApiData,
} from "./exchange-api";

interface DemoSession {
  organizations: Organization[];
  organizationId: string | null;
}

export function useDemoSession() {
  const session = useApiData<DemoSession>("/api/demo-session");
  const [selected, setSelected] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  async function select(organizationId: string) {
    setSelecting(true);
    setSelectionError(null);
    try {
      const result = await apiRequest<{ organization: Organization }>(
        "/api/demo-session",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId }),
        },
      );
      setSelected(result.organization.id);
    } catch (error) {
      setSelectionError(errorMessage(error));
    } finally {
      setSelecting(false);
    }
  }

  return {
    ...session,
    organizationId: selected ?? session.data?.organizationId ?? null,
    organizations: session.data?.organizations ?? [],
    select,
    selecting,
    selectionError,
  };
}

export function OrganizationPicker({
  session,
}: {
  session: ReturnType<typeof useDemoSession>;
}) {
  return (
    <div className="organization-picker">
      <label htmlFor="demo-organization">Demo organization</label>
      <select
        id="demo-organization"
        value={session.organizationId ?? ""}
        disabled={
          session.loading || session.selecting || Boolean(session.error)
        }
        onChange={(event) => void session.select(event.target.value)}
      >
        <option value="" disabled>
          Choose an organization
        </option>
        {session.organizations.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      {session.loading || session.selecting ? (
        <output className="field-hint">
          {session.loading
            ? "Loading organizations…"
            : "Switching organization…"}
        </output>
      ) : null}
      {session.error ? (
        <div className="picker-error">
          <p role="alert">{session.error}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={session.retry}
          >
            Retry
          </button>
        </div>
      ) : null}
      {session.selectionError ? (
        <p className="picker-error" role="alert">
          {session.selectionError}
        </p>
      ) : null}
    </div>
  );
}

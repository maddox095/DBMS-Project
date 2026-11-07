"use client";

import Link from "next/link";
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  apiRequest,
  errorMessage,
  type Organization,
  useApiData,
} from "./exchange-api";

type SessionData = {
  organizations: Organization[];
  organizationId: string | null;
};
function useSessionState() {
  const session = useApiData<SessionData>("/api/demo-session");
  const [selected, setSelected] = useState<{
    organization: Organization;
    source: SessionData | undefined;
  } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    function refresh() {
      session.retry();
    }
    channel.current = new BroadcastChannel("material-exchange-account");
    channel.current.onmessage = refresh;
    window.addEventListener("focus", refresh);
    return () => {
      channel.current?.close();
      window.removeEventListener("focus", refresh);
    };
  }, [session.retry]);
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
      setSelected({ organization: result.organization, source: session.data });
      session.retry();
      channel.current?.postMessage("changed");
    } catch (error) {
      setSelectionError(errorMessage(error));
    } finally {
      setSelecting(false);
    }
  }
  const organization =
    (selected?.source === session.data ? selected?.organization : null) ??
    session.data?.organizations.find(
      (item) => item.id === session.data?.organizationId,
    ) ??
    null;
  return {
    ...session,
    organization,
    organizationId: organization?.id ?? null,
    role: organization?.role ?? null,
    organizations: session.data?.organizations ?? [],
    select,
    selecting,
    selectionError,
  };
}
const SessionContext = createContext<ReturnType<typeof useSessionState> | null>(
  null,
);
export function OrganizationSessionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const session = useSessionState();
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}
export function useOrganizationSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("Organization session provider is missing.");
  return session;
}
export function WorkspaceGate({
  requiredRole,
  children,
}: {
  requiredRole: "CONSUMER" | "PRODUCER";
  children: ReactNode;
}) {
  const session = useOrganizationSession();
  if ((session.loading && !session.organization) || session.selecting)
    return <output className="empty-panel">Loading workspace…</output>;
  if (session.error)
    return (
      <div className="empty-panel">
        <p role="alert">{session.error}</p>
        <button
          type="button"
          className="secondary-button"
          onClick={session.retry}
        >
          Retry
        </button>
      </div>
    );
  if (!session.organizationId)
    return (
      <div className="empty-panel">
        <h1>Choose your workspace.</h1>
        <p>
          Use your consumer account to source materials, or your producer
          account to manage supply.
        </p>
        <Link className="primary-button" href="/account">
          Choose account
        </Link>
      </div>
    );
  if (session.role !== requiredRole)
    return (
      <div className="empty-panel">
        <h2>
          {requiredRole === "PRODUCER"
            ? "Producer workspace"
            : "Consumer workspace"}
        </h2>
        <p>
          Your active account is a{" "}
          {session.role === "PRODUCER" ? "producer" : "consumer"}. Its tools are
          available in its own workspace.
        </p>
        <Link
          className="primary-button"
          href={session.role === "PRODUCER" ? "/producer" : "/"}
        >
          Go to my workspace
        </Link>
      </div>
    );
  return <Fragment key={session.organizationId}>{children}</Fragment>;
}
export function AccountPage() {
  const session = useOrganizationSession();
  return (
    <section className="account-page">
      <p className="eyebrow">Account & workspace</p>
      <h1>
        Work on your side
        <br />
        of the exchange.
      </h1>
      <p className="hero-copy">
        Each organization has one role. Consumers source and order materials.
        Producers manage their own inventory and quote incoming requests.
      </p>
      <div className="role-grid">
        {(["CONSUMER", "PRODUCER"] as const).map((role) => (
          <section className="panel account-role" key={role}>
            <p className="eyebrow">
              {role === "PRODUCER" ? "Supply materials" : "Source materials"}
            </p>
            <h2>{role === "PRODUCER" ? "Producer" : "Consumer"}</h2>
            <p className="muted">
              {role === "PRODUCER"
                ? "Publish batches, manage stock, and issue quotations to buyers."
                : "Discover available materials, reserve quantities, and manage your orders."}
            </p>
            {session.organizations
              .filter((item) => item.role === role)
              .map((item) => (
                <button
                  type="button"
                  className="account-choice"
                  key={item.id}
                  disabled={session.selecting}
                  aria-pressed={session.organizationId === item.id}
                  onClick={() => void session.select(item.id)}
                >
                  <span>{item.name}</span>
                  <span className="field-hint">
                    {session.organizationId === item.id
                      ? "Selected"
                      : "Select account"}
                  </span>
                </button>
              ))}
          </section>
        ))}
      </div>
      {session.loading ? <output>Loading accounts…</output> : null}
      {session.error || session.selectionError ? (
        <p role="alert" className="inline-error">
          {session.error ?? session.selectionError}
        </p>
      ) : null}
      {session.organizationId ? (
        <Link
          className="primary-button"
          href={session.role === "PRODUCER" ? "/producer" : "/"}
        >
          Continue to {session.role === "PRODUCER" ? "producer" : "consumer"}{" "}
          workspace
        </Link>
      ) : null}
    </section>
  );
}

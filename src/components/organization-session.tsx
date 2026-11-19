"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  jsonOptions,
  type Organization,
  useApiData,
} from "./exchange-api";

export interface SessionData {
  user: { id: string; fullName: string; email: string } | null;
  organization: (Organization & { role: "CONSUMER" | "PRODUCER" }) | null;
}
function useSessionState() {
  const session = useApiData<SessionData>("/api/auth/session");
  const [override, setOverride] = useState<{
    source: SessionData | undefined;
    data: SessionData | null;
  } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef(session);
  latest.current = session;
  const data =
    override && override.source === session.data ? override.data : session.data;
  const organization = data?.organization ?? null;
  const user = data?.user ?? null;
  const suppliers = useApiData<{ items: Organization[] }>(
    user ? "/api/suppliers" : null,
    user?.id ?? null,
  );
  useEffect(() => {
    function invalidate() {
      setOverride({ source: latest.current.data, data: null });
      latest.current.retry();
    }
    function refresh() {
      latest.current.retry();
    }
    channel.current = new BroadcastChannel("material-exchange-auth");
    channel.current.onmessage = invalidate;
    window.addEventListener("focus", refresh);
    window.addEventListener("exchange:session-expired", invalidate);
    return () => {
      channel.current?.close();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("exchange:session-expired", invalidate);
    };
  }, []);
  async function authenticate(mode: "login" | "signup", body: unknown) {
    setSelecting(true);
    try {
      const result = await apiRequest<SessionData>(
        `/api/auth/${mode}`,
        jsonOptions("POST", body),
      );
      setOverride({ source: session.data, data: result });
      session.retry();
      channel.current?.postMessage("changed");
      return result;
    } finally {
      setSelecting(false);
    }
  }
  async function logout() {
    setSelecting(true);
    try {
      await apiRequest("/api/auth/logout", jsonOptions("POST", {}));
      setOverride({ source: session.data, data: null });
      session.retry();
      channel.current?.postMessage("changed");
    } finally {
      setSelecting(false);
    }
  }
  return {
    ...session,
    user,
    organization,
    organizationId: organization?.id ?? null,
    role: organization?.role ?? null,
    suppliers: suppliers.data?.items ?? [],
    authenticate,
    logout,
    selecting,
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
  if ((session.loading && !session.user) || session.selecting)
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
  if (!session.user)
    return (
      <div className="empty-panel signed-out">
        <p className="eyebrow">Material Exchange</p>
        <h1>Sign in to your workspace.</h1>
        <p>
          Source materials as a Consumer, or manage your supply as a Producer.
          Your account keeps your organization's activity private.
        </p>
        <div className="button-row">
          <Link className="primary-button" href="/login">
            Sign in
          </Link>
          <Link className="secondary-button" href="/signup">
            Create an account
          </Link>
        </div>
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
          Your account belongs to a{" "}
          {session.role === "PRODUCER" ? "producer" : "consumer"} organization.
          Its tools are available in its own workspace.
        </p>
        <Link
          className="primary-button"
          href={session.role === "PRODUCER" ? "/producer" : "/"}
        >
          Go to my workspace
        </Link>
      </div>
    );
  return (
    <Fragment key={`${session.user.id}:${session.organizationId}`}>
      {children}
    </Fragment>
  );
}
export function AccountPage() {
  const session = useOrganizationSession();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (session.loading && !session.user)
    return <output className="empty-panel">Loading account…</output>;
  if (session.error)
    return (
      <div className="empty-panel">
        <p role="alert">{session.error}</p>
        <button
          className="secondary-button"
          type="button"
          onClick={session.retry}
        >
          Retry
        </button>
      </div>
    );
  return (
    <section className="account-page">
      <p className="eyebrow">My account</p>
      <h1>
        {session.user
          ? "Your organization account."
          : "Your workspace starts here."}
      </h1>
      {session.user && session.organization ? (
        <div className="panel account-details">
          <dl className="detail-facts">
            <div>
              <dt>Name</dt>
              <dd>{session.user.fullName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{session.user.email}</dd>
            </div>
            <div>
              <dt>Organization</dt>
              <dd>{session.organization.name}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{session.role === "PRODUCER" ? "Producer" : "Consumer"}</dd>
            </div>
          </dl>
          <p className="muted">
            Your organization and role are linked to your account. Sign out
            before using another account.
          </p>
          <div className="button-row">
            <Link
              className="primary-button"
              href={session.role === "PRODUCER" ? "/producer" : "/"}
            >
              Open workspace
            </Link>
            <button
              className="secondary-button"
              type="button"
              disabled={session.selecting}
              onClick={() => {
                setError(null);
                void session.logout().then(
                  () => router.replace("/login"),
                  (failure) =>
                    setError(
                      failure instanceof Error
                        ? failure.message
                        : "Sign out failed. Try again.",
                    ),
                );
              }}
            >
              Sign out
            </button>
          </div>
          {error ? (
            <p className="inline-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="empty-panel">
          <p>
            Sign in to access your organization, or create a new Consumer or
            Producer organization.
          </p>
          <div className="button-row">
            <Link className="primary-button" href="/login">
              Sign in
            </Link>
            <Link className="secondary-button" href="/signup">
              Create an account
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

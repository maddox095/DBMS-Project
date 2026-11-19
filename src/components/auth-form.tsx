"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { errorMessage } from "./exchange-api";
import { AccountPage, useOrganizationSession } from "./organization-session";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const session = useOrganizationSession();
  const router = useRouter();
  const [role, setRole] = useState("CONSUMER");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const password = String(values.get("password") ?? "");
    if (signup && password !== values.get("confirmation")) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await session.authenticate(mode, {
        email: values.get("email"),
        password,
        ...(signup
          ? {
              fullName: values.get("fullName"),
              companyName: values.get("companyName"),
              role,
            }
          : {}),
      });
      router.replace(
        result.organization?.role === "PRODUCER" ? "/producer" : "/",
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  if (session.user) return <AccountPage />;
  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <p className="eyebrow">Material Exchange</p>
        <h1>
          {signup ? (
            <>
              A new account.
              <br />A better use for materials.
            </>
          ) : (
            <>
              Welcome back.
              <br />
              Your workspace awaits.
            </>
          )}
        </h1>
        <p className="hero-copy">
          {signup
            ? "Connect surplus materials with the people who can use them. Create an organization and choose your side of the exchange."
            : "Sign in to manage your organization's materials, reservations, and quotations."}
        </p>
        <div className="auth-explainer">
          <p>
            <strong>Consumers</strong> discover materials and manage purchases.
          </p>
          <p>
            <strong>Producers</strong> manage inventory and respond to buyers.
          </p>
        </div>
      </section>
      <section className="panel auth-panel">
        <h2>{signup ? "Create your account" : "Sign in"}</h2>
        <p className="muted">
          {signup
            ? "Register a new organization. Existing members should sign in."
            : "Use the email and password linked to your organization."}
        </p>
        <form
          onSubmit={submit}
          aria-label={signup ? "Create account" : "Sign in"}
        >
          {error ? (
            <p
              ref={errorRef}
              className="inline-error"
              role="alert"
              tabIndex={-1}
            >
              {error}
            </p>
          ) : null}
          <fieldset disabled={busy || session.loading} className="auth-fields">
            <legend className="sr-only">
              {signup ? "Account details" : "Sign-in details"}
            </legend>
            {signup ? (
              <>
                <fieldset className="role-options">
                  <legend>Organization role</legend>
                  {["CONSUMER", "PRODUCER"].map((value) => (
                    <label className="role-option" key={value}>
                      <input
                        type="radio"
                        name="role"
                        value={value}
                        checked={role === value}
                        onChange={() => setRole(value)}
                      />
                      <span>
                        <strong>
                          {value === "PRODUCER" ? "Producer" : "Consumer"}
                        </strong>
                        <span>
                          {value === "PRODUCER"
                            ? "Supply materials"
                            : "Source materials"}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div>
                  <label htmlFor="auth-name">Full name</label>
                  <input
                    id="auth-name"
                    name="fullName"
                    autoComplete="name"
                    required
                    maxLength={120}
                  />
                </div>
                <div>
                  <label htmlFor="auth-company">Organization name</label>
                  <input
                    id="auth-company"
                    name="companyName"
                    autoComplete="organization"
                    required
                    maxLength={160}
                    aria-describedby="company-hint"
                  />
                  <p className="field-hint" id="company-hint">
                    This creates a new organization; it cannot claim an existing
                    one.
                  </p>
                </div>
              </>
            ) : null}
            <div>
              <label htmlFor="auth-email">Email address</label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={254}
              />
            </div>
            <div>
              <div className="password-label">
                <label htmlFor="auth-password">Password</label>
                <button
                  type="button"
                  className="text-button"
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? "Hide password" : "Show password"}
                </button>
              </div>
              <input
                id="auth-password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete={signup ? "new-password" : "current-password"}
                required
                minLength={signup ? 15 : 1}
                maxLength={128}
                aria-describedby={signup ? "password-hint" : undefined}
              />
              {signup ? (
                <p className="field-hint" id="password-hint">
                  15–128 characters. A long, memorable passphrase works well.
                </p>
              ) : null}
            </div>
            {signup ? (
              <div>
                <label htmlFor="auth-confirmation">Confirm password</label>
                <input
                  id="auth-confirmation"
                  name="confirmation"
                  type={visible ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={15}
                  maxLength={128}
                />
              </div>
            ) : null}
            <button className="primary-button" type="submit">
              {busy
                ? signup
                  ? "Creating account…"
                  : "Signing in…"
                : signup
                  ? "Create account"
                  : "Sign in"}
            </button>
          </fieldset>
        </form>
        <p className="auth-switch">
          {signup ? "Already have an account?" : "New to Material Exchange?"}{" "}
          <Link href={signup ? "/login" : "/signup"}>
            {signup ? "Sign in" : "Create an account"}
          </Link>
        </p>
      </section>
    </div>
  );
}

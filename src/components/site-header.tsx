"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "./exchange-api";
import { useOrganizationSession } from "./organization-session";

export function SiteHeader() {
  const session = useOrganizationSession();
  const path = usePathname();
  const router = useRouter();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const producer = session.role === "PRODUCER";
  const links = producer
    ? [
        ["/producer", "My inventory"],
        ["/producer/orders", "Incoming requests"],
        ["/batches/new", "Publish batch"],
      ]
    : [
        ["/", "Discover materials"],
        ["/orders", "My reservations & orders"],
      ];
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link className="site-brand" href={producer ? "/producer" : "/"}>
          <span className="brand-mark" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Material Exchange</title>
              <path d="m12 3 9 5-9 5-9-5 9-5Z" />
              <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
            </svg>
          </span>
          Material Exchange
        </Link>
        {session.organization ? (
          <div className="account-summary">
            <span className="role-label">
              {producer ? "Producer" : "Consumer"}
            </span>
            <span>{session.organization.name}</span>
          </div>
        ) : null}
        <nav className="workspace-nav" aria-label="Main navigation">
          {session.organization
            ? links.map(([href, label]) => (
                <Link
                  className={
                    href === "/batches/new" ? "primary-button" : "nav-link"
                  }
                  aria-current={path === href ? "page" : undefined}
                  key={href}
                  href={href}
                >
                  {label}
                </Link>
              ))
            : null}
          {session.user ? (
            <>
              <Link className="nav-link account-link" href="/account">
                My account
              </Link>
              <button
                type="button"
                className="nav-link text-button"
                disabled={session.selecting}
                onClick={() => {
                  setLogoutError(null);
                  void session.logout().then(
                    () => router.replace("/login"),
                    (error) => setLogoutError(errorMessage(error)),
                  );
                }}
              >
                {session.selecting ? "Signing out…" : "Sign out"}
              </button>
            </>
          ) : (
            <>
              <Link
                className="nav-link"
                href="/login"
                aria-current={path === "/login" ? "page" : undefined}
              >
                Sign in
              </Link>
              <Link className="primary-button" href="/signup">
                Create account
              </Link>
            </>
          )}
        </nav>
        {logoutError ? (
          <p className="inline-error" role="alert">
            {logoutError}
          </p>
        ) : null}
      </div>
    </header>
  );
}

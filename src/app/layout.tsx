import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Industrial Byproduct Exchange",
  description:
    "A DBMS course project for industrial byproduct exchange and material traceability.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <header className="site-header">
          <div className="shell header-inner">
            <Link className="site-brand" href="/">
              <span className="brand-mark" aria-hidden="true">
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m12 3 9 5-9 5-9-5 9-5Z" />
                  <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
                </svg>
              </span>
              Material Exchange
            </Link>
            <span className="workspace-label">Local demo</span>
          </div>
        </header>
        <main className="shell workspace" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}

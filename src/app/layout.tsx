import type { Metadata } from "next";
import { OrganizationSessionProvider } from "@/components/organization-session";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Industrial Byproduct Exchange",
  description:
    "Source industrial byproducts, request quotations, and manage material exchanges.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <OrganizationSessionProvider>
          <SiteHeader />
          <main className="shell workspace" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </OrganizationSessionProvider>
      </body>
    </html>
  );
}

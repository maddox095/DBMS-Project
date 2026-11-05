import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Industrial Byproduct Exchange",
  description:
    "A DBMS course project for industrial byproduct exchange and material traceability.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

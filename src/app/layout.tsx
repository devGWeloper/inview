import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TraceX · AI Action Trace Viewer",
  description: "Integrated trace viewer across Cube / Gaia / MCP / OneOIS / Legacy"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

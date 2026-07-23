import type { Metadata } from "next";
import "./globals.css";
import pkg from "../../package.json";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { AppChrome } from "@/components/AppChrome";

export const metadata: Metadata = {
  title: "TraceX · AI Action Trace Viewer",
  description: "Integrated trace viewer across Cube / Gaia / MCP / OneOIS / Legacy"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>
          <AppChrome version={pkg.version}>{children}</AppChrome>
        </AuthProvider>
      </body>
    </html>
  );
}

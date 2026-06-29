import type { Metadata } from "next";
import "./globals.css";
import pkg from "../../package.json";
import { TabNav, AgentNavChip } from "@/components/TabNav";

export const metadata: Metadata = {
  title: "TraceX · AI Action Trace Viewer",
  description: "Integrated trace viewer across Cube / Gaia / MCP / OneOIS / Legacy"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="app">
          <header className="topbar">
            <div className="brand">
              <span className="logo" aria-hidden />
              TraceX
              <span className="sub">· AI Action Trace</span>
            </div>
            <TabNav />
            <AgentNavChip />
          </header>
          {children}
          <footer className="statusbar">
            <div className="left">
              <span>© 2026 SK hynix</span>
              <span className="sep" aria-hidden />
              <span>eWorks Agent</span>
            </div>
            <div className="right">
              <span>TraceX</span>
              <span className="ver">v{pkg.version}</span>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

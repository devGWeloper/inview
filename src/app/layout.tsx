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
              <span className="logo" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" width="15" height="15">
                  <path d="M4 17 L10 11 L14 14 L20 6" stroke="#fff" strokeWidth="2.2"
                        strokeLinecap="round" strokeLinejoin="round" />
                  <circle cx="4" cy="17" r="1.7" fill="#fff" />
                  <circle cx="20" cy="6" r="1.7" fill="#fff" />
                </svg>
              </span>
              <span className="brand-word">Trace<span className="brand-x">X</span></span>
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

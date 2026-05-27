import type { Metadata } from "next";
import "./globals.css";
import { TabNav } from "@/components/TabNav";
import { connectedLayerCount, getAppEnv } from "@/lib/db";
import { LAYER_ORDER } from "@/lib/types";

export const metadata: Metadata = {
  title: "TraceX · AI Action Trace Viewer",
  description: "Integrated trace viewer across Cube / Gaia / MCP / OneOIS / Legacy"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const appEnv = getAppEnv();
  const connectedLayers = connectedLayerCount();
  const totalLayers = LAYER_ORDER.length;
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`env-badge ${appEnv}`}>{appEnv.toUpperCase()}</span>
              <span className="env-badge live">
                <span className="dot" />
                CONNECTED · {connectedLayers}/{totalLayers} LAYER{totalLayers !== 1 ? "S" : ""}
              </span>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

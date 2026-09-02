"use client";

import React from "react";

export function Card({
  title, sub, hero, children,
}: {
  title: string;
  sub?: string;
  hero?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={"dash-card" + (hero ? " dash-card-hero" : "")}>
      <div className="dash-card-head">
        <div className="dash-card-title-group">
          <span className="dash-card-title">{title}</span>
          {sub && <span className="dash-card-sub">{sub}</span>}
        </div>
      </div>
      <div className="dash-card-body">{children}</div>
    </section>
  );
}

export function Kpi({
  label, value, unit, sub, tone,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone: "accent" | "ok" | "err" | "muted";
}) {
  return (
    <div className={"ins-kpi tone-" + tone}>
      <div className="ins-kpi-label">{label}</div>
      <div className="ins-kpi-value">
        {value}
        {unit && <span className="ins-kpi-unit">{unit}</span>}
      </div>
      {sub && <div className="ins-kpi-sub">{sub}</div>}
    </div>
  );
}

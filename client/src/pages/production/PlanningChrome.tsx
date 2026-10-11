import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Link } from "wouter";

export type PlanningNavigationTab = { href: string; label: string; active: boolean };

export function PlanningHeader({
  title,
  description,
  refreshLabel,
  onRefresh,
  refreshing = false,
  showRefresh = true,
  children,
}: {
  title: string;
  description: string;
  refreshLabel: string;
  onRefresh: () => void;
  refreshing?: boolean;
  showRefresh?: boolean;
  children?: ReactNode;
}) {
  return <header className="planning-header">
    <div className="planning-heading">
      <div className="planning-kicker">MPBF / PLANNING &amp; MONITORING</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
    <div className="planning-header-actions">
      {showRefresh && <button className="planning-refresh" type="button" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw aria-hidden="true" />{refreshLabel}
      </button>}
      {children}
      <div className="planning-mark" aria-hidden="true"><i /><span>PLAN<br />/ CONTROL</span></div>
    </div>
  </header>;
}

export function PlanningNavigation({ tabs, label }: { tabs: PlanningNavigationTab[]; label: string }) {
  return <nav className="planning-nav" aria-label={label}>
    {tabs.map(tab => <Link key={tab.href} href={tab.href} aria-current={tab.active ? "page" : undefined}>{tab.label}</Link>)}
  </nav>;
}

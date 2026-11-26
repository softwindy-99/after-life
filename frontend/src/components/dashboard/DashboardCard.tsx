import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function DashboardIdentity(props: { username: string; email: string }) {
  const initial = props.username.trim().charAt(0).toUpperCase() || "?";

  return (
    <article className="dashboard-card dashboard-identity">
      <div>
        <p className="dashboard-card-label">当前身份</p>
        <h3>{props.username}</h3>
        <span>{props.email}</span>
      </div>
      <div className="dashboard-avatar" aria-hidden="true">
        {initial}
      </div>
    </article>
  );
}

export function DashboardMetric(props: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  compact?: boolean;
}) {
  const Icon = props.icon;

  return (
    <article className={cn("dashboard-card dashboard-metric", props.compact && "is-compact")}>
      <div className="dashboard-metric-label">
        <Icon aria-hidden="true" size={props.compact ? 17 : 19} strokeWidth={1.8} />
        <p>{props.label}</p>
      </div>
      <strong>{props.value}</strong>
    </article>
  );
}

export function DashboardPanel(props: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  const Icon = props.icon;

  return (
    <section className={cn("dashboard-panel", props.className)}>
      <div className="dashboard-panel-head">
        <h3>{props.title}</h3>
        <span className="dashboard-panel-icon" aria-hidden="true">
          <Icon size={18} strokeWidth={1.8} />
        </span>
      </div>
      <div className="dashboard-panel-content">{props.children}</div>
    </section>
  );
}

export function DashboardEmptyState(props: { children: ReactNode }) {
  return <p className="dashboard-empty">{props.children}</p>;
}

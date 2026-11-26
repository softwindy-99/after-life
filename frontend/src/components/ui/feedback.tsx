import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Spinner({
  label = "处理中",
  decorative = false,
}: {
  label?: string;
  decorative?: boolean;
}): ReactElement {
  return (
    <span
      className="ui-spinner"
      role={decorative ? undefined : "status"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    />
  );
}

export function Progress({
  value,
  label,
  className,
}: {
  value?: number;
  label: string;
  className?: string;
}): ReactElement {
  const percentage =
    value === undefined
      ? undefined
      : Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cn("ui-progress", percentage === undefined && "is-indeterminate", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percentage}
    >
      <span style={percentage === undefined ? undefined : { width: `${percentage}%` }} />
    </div>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={cn("ui-skeleton", className)} aria-hidden="true" {...props} />;
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={cn("ui-empty-state", className)}>
      {icon && (
        <span className="ui-empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

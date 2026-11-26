import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function Panel({
  title,
  eyebrow,
  description,
  actions,
  children,
  className,
  ...props
}: PanelProps): ReactElement {
  return (
    <section className={cn("ui-panel", className)} {...props}>
      {(title || actions || eyebrow) && (
        <header className="ui-panel-header">
          <div>
            {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
            {title && <h3>{title}</h3>}
            {description && <p className="ui-panel-description">{description}</p>}
          </div>
          {actions && <div className="ui-panel-actions">{actions}</div>}
        </header>
      )}
      <div className="ui-panel-body">{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: Pick<PanelProps, "title" | "description" | "eyebrow" | "actions">): ReactElement {
  return (
    <header className="ui-page-header">
      <div>
        {eyebrow && <p className="ui-eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-panel-actions">{actions}</div>}
    </header>
  );
}

export function Separator({ className, ...props }: HTMLAttributes<HTMLHRElement>): ReactElement {
  return <hr className={cn("ui-separator", className)} {...props} />;
}

import * as React from "react";
import { cn } from "../../lib/utils";

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  scrollLabel: string;
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, scrollLabel, children, ...props }, ref) => (
    <div className="ui-table-scroll" role="region" aria-label={scrollLabel} tabIndex={0}>
      <table {...props} ref={ref} className={cn("ui-table", className)}>
        {children}
      </table>
    </div>
  ),
);
Table.displayName = "Table";

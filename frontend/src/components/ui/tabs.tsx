import { useId, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface TabItem {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}
export interface TabsProps {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  className?: string;
}

export function Tabs({ items, value, onValueChange, label, className }: TabsProps): ReactElement {
  const id = useId();
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = items.findIndex((item) => item.value === value && !item.disabled);
  const active = selected < 0 ? items.findIndex((item) => !item.disabled) : selected;
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const enabled = items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled.length) return;
    const current = enabled.indexOf(index);
    let next: number;
    if (event.key === "ArrowRight") next = enabled[(current + 1) % enabled.length];
    else if (event.key === "ArrowLeft")
      next = enabled[(current - 1 + enabled.length) % enabled.length];
    else if (event.key === "Home") next = enabled[0];
    else if (event.key === "End") next = enabled[enabled.length - 1];
    else return;
    event.preventDefault();
    onValueChange(items[next].value);
    buttons.current[next]?.focus();
  }
  return (
    <div className={cn("ui-tabs", className)}>
      <div role="tablist" aria-label={label} className="ui-tablist">
        {items.map((item, i) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            ref={(button) => {
              buttons.current[i] = button;
            }}
            id={`${id}-tab-${i}`}
            aria-controls={`${id}-panel-${i}`}
            aria-selected={i === active}
            disabled={item.disabled}
            tabIndex={i === active ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => navigate(event, i)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, i) => (
        <div
          key={item.value}
          id={`${id}-panel-${i}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${i}`}
          hidden={i !== active}
          tabIndex={0}
          className="ui-tabpanel"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

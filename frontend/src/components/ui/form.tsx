import * as React from "react";
import { cn } from "../../lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(type === "checkbox" || type === "radio" ? "ui-choice" : "ui-input", className)}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn("ui-input ui-textarea", className)} {...props} />
));
Textarea.displayName = "Textarea";

type FieldControl = {
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
};

export interface FieldProps {
  id?: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactElement<FieldControl>;
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: FieldProps): React.ReactElement {
  const generatedId = React.useId();
  const controlId = id ?? children.props.id ?? generatedId;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const describedBy = [
    children.props["aria-describedby"],
    hint ? hintId : null,
    error ? errorId : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("ui-field", className)} data-invalid={error ? true : undefined}>
      <label className="ui-field-label" htmlFor={controlId}>
        {label}
        {children.props.required && (
          <span className="ui-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {React.cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : children.props["aria-invalid"],
      })}
      {hint && (
        <p className="ui-field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="ui-field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

export const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ label, description, className, id, ...props }, ref) => {
    const generatedId = React.useId();
    const controlId = id ?? generatedId;
    return (
      <label className={cn("ui-switch", className)} htmlFor={controlId}>
        <span className="ui-switch-control">
          <input
            {...props}
            aria-labelledby={props["aria-labelledby"] ?? `${controlId}-label`}
            aria-describedby={
              [props["aria-describedby"], description ? `${controlId}-description` : undefined]
                .filter(Boolean)
                .join(" ") || undefined
            }
            id={controlId}
            type="checkbox"
            role="switch"
            ref={ref}
          />
          <span className="ui-switch-track" aria-hidden="true" />
        </span>
        <span className="ui-switch-copy">
          <span id={`${controlId}-label`}>{label}</span>
          {description && <small id={`${controlId}-description`}>{description}</small>}
        </span>
      </label>
    );
  },
);
Switch.displayName = "Switch";

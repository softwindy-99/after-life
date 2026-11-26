import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
import { Spinner } from "./feedback";

const buttonVariants = cva("ui-button", {
  variants: {
    variant: {
      default: "ui-button-default",
      secondary: "ui-button-secondary",
      outline: "ui-button-outline",
      ghost: "ui-button-ghost",
      destructive: "ui-button-destructive",
      link: "ui-button-link",
    },
    size: {
      default: "ui-button-size-default",
      sm: "ui-button-size-sm",
      icon: "ui-button-size-icon",
      lg: "ui-button-size-lg",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  busy?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, busy = false, disabled, type, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        type={asChild ? undefined : type ?? "button"}
        disabled={asChild ? undefined : disabled || busy}
        aria-busy={busy || undefined}
        aria-disabled={asChild && (disabled || busy) ? true : undefined}
        data-busy={busy || undefined}
        tabIndex={asChild && (disabled || busy) ? -1 : props.tabIndex}
        onClickCapture={(event: React.MouseEvent<HTMLButtonElement>) => {
          if (disabled || busy) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          props.onClickCapture?.(event);
        }}
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
          if (disabled || busy) {
            event.preventDefault();
            return;
          }
          props.onClick?.(event);
        }}
      >
        {asChild ? (
          children
        ) : (
          <>
            {busy && <Spinner decorative />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

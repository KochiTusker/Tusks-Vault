import React from "react";
import { cn } from "../../lib/utils";

// Button — the shadcn/Tomes API surface (variant + size) hand-rolled as a
// lookup table instead of class-variance-authority. `data-slot` passes
// through like any DOM attribute, so the CSS treatments for
// data-slot="primary-cta" / "ember-cta" (index.css) attach exactly as they
// do in the sibling project.

export type ButtonVariant = "default" | "secondary" | "ghost" | "outline" | "destructive";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground font-medium hover:bg-primary-hover shadow-glow-sm hover:shadow-glow-md",
  secondary: "bg-secondary text-secondary-foreground hover:bg-surface-strong",
  ghost: "hover:bg-muted/60 text-foreground",
  outline: "border border-border/50 bg-transparent text-foreground hover:bg-muted/40 hover:border-border",
  destructive: "bg-danger text-white hover:opacity-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2",
  sm: "h-8 rounded-md px-3 text-xs",
  lg: "h-10 rounded-md px-6",
  icon: "h-9 w-9",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "default", size = "default", type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg text-sm transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      {...props}
    />
  );
});

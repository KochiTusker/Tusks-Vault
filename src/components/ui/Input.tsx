import React from "react";
import { cn } from "../../lib/utils";

// Text input — matches the sibling project's Input API (plain
// <input> passthrough with themed classes).
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "flex h-9 w-full rounded-lg border border-border/30 bg-surface-input px-3 py-1 text-sm",
          "text-foreground placeholder:text-foreground/35 transition-colors",
          "focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/25",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    );
  }
);

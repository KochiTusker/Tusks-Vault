// Last-resort error boundary around the whole app. Without one, a render
// throw anywhere blanks the page with nothing but a console trace — the
// worst possible failure mode for a tool people run locally and diagnose
// themselves. This shows what broke, offers a reload, and keeps the
// stack reachable behind a disclosure for bug reports.

import React from "react";

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[app] render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="scriptorium-card w-full max-w-lg rounded-xl p-6 text-foreground">
          <h1 className="font-display text-lg tracking-wide text-primary">
            The scribe dropped his quill
          </h1>
          <p className="mt-2 text-sm text-foreground/70">
            Something in the interface crashed while rendering. Your lore, keys and settings are
            safe on disk — reloading almost always recovers.
          </p>
          <p className="mt-3 rounded-md bg-background/60 p-3 font-mono text-xs text-danger">
            {this.state.error.message}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Reload
            </button>
            <details className="text-xs text-foreground/50">
              <summary className="cursor-pointer">Stack trace (for a bug report)</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {this.state.error.stack}
              </pre>
            </details>
          </div>
        </div>
      </div>
    );
  }
}

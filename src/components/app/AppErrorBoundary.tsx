import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type AppErrorBoundaryProps = {
  children: ReactNode;
  scope?: "app" | "route";
};

type AppErrorBoundaryState = {
  error?: Error;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error("RoboSats interface failure", error, info);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const routeFailure = this.props.scope === "route";

    return (
      <main className={routeFailure ? "page page-narrow app-error-page" : "app-error-page app-error-page-root"}>
        <section className="app-error-boundary" role="alert" aria-labelledby="app-error-title">
          <span className="app-error-icon" aria-hidden="true"><AlertTriangle size={22} /></span>
          <div className="app-error-copy">
            <h1 id="app-error-title">{routeFailure ? "This page could not load" : "RoboSats could not start"}</h1>
            <p>Your local data is unchanged. Reload the interface to reconnect and try again.</p>
          </div>
          <Button type="button" onClick={() => window.location.reload()}>
            <RefreshCw size={17} />
            Reload interface
          </Button>
        </section>
      </main>
    );
  }
}

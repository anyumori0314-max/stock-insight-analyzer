import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Optional recovery handler. When provided it is called on "再読み込み" and the
   * boundary clears its error state in place (used by tests). When omitted the
   * default recovery is a full page reload to a known-good state.
   */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  /** Dev-only diagnostic message. Never populated in production builds. */
  detail: string | null;
}

/**
 * Top-level React error boundary.
 *
 * Catches *render-time* exceptions (a genuine UI bug) so one broken component
 * can never blank the entire page. Ordinary API failures are NOT thrown during
 * render — they live in hook state and render an inline `role="alert"` — so they
 * never reach this boundary. The fallback shows a fixed, safe message plus a
 * recovery action; any error detail/stack is shown ONLY in development
 * (`import.meta.env.DEV`), so production never leaks internals to users.
 *
 * The fallback itself is intentionally trivial (static markup, no data access),
 * so it cannot throw and re-enter the boundary.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, detail: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const detail = import.meta.env.DEV && error instanceof Error ? error.message : null;
    return { hasError: true, detail };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Development aid only; never transmitted and never shown to users in prod.
    if (import.meta.env.DEV) {
      console.error("[error-boundary]", error, info.componentStack);
    }
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, detail: null });
    if (this.props.onReset) {
      this.props.onReset();
      return;
    }
    if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary__card">
          <h1 className="error-boundary__title">表示中に問題が発生しました</h1>
          <p className="error-boundary__text">
            画面の描画中に予期しないエラーが発生しました。お手数ですが、再読み込みをお試しください。
            問題が続く場合は、しばらく時間をおいてから再度アクセスしてください。
          </p>
          <button type="button" className="btn" onClick={this.handleReset}>
            再読み込み
          </button>
          {this.state.detail !== null && (
            <pre className="error-boundary__detail">{this.state.detail}</pre>
          )}
        </div>
      </div>
    );
  }
}

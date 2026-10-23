import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../../i18n';

/**
 * A crash in one screen stays in that screen.
 *
 * Without this, one exception anywhere under the app unmounts all of it and
 * leaves a white page with nothing to tap - not even the tabs. With it, the
 * header and the navigation stay, and the broken screen is replaced by a short
 * note and the two ways out: back to the championship, or a fresh page.
 *
 * The app keys it by screen, so moving to another tab clears it by itself. A
 * second one, with `page`, sits around the whole app for a crash in the frame
 * itself, and draws its note inside a page of its own.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onHome(): void; page?: boolean },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Screen crashed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const c = t().app.crash;
    const note = (
      <div className="card notched" role="alert">
        <h2 style={{ margin: '0 0 6px' }}>{c.title}</h2>
        <p className="muted small" style={{ margin: '0 0 14px' }}>
          {c.body}
        </p>
        <div className="row wrap">
          <button
            className="primary"
            onClick={() => {
              this.setState({ failed: false });
              this.props.onHome();
            }}
          >
            {c.back}
          </button>
          <button className="ghost" onClick={() => window.location.reload()}>
            {c.reload}
          </button>
        </div>
      </div>
    );
    if (!this.props.page) return note;
    return (
      <div className="app">
        <main className="content">
          <div className="wrap">{note}</div>
        </main>
      </div>
    );
  }
}

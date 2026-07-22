import React from 'react';

/**
 * App-wide error boundary so a render/runtime crash shows a readable message
 * instead of a silent blank page.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Surface the error in the console for debugging.
    console.error('App crashed:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
          background: '#0b1220',
          color: '#eaf3ff',
        }}
      >
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px' }}>Something went wrong</h2>
          <p style={{ color: '#9fb0c9', margin: '0 0 16px' }}>
            This page hit an unexpected error. Try reloading, or go back to your dashboard.
          </p>
          {this.state.error?.message ? (
            <pre
              style={{
                textAlign: 'left',
                background: '#111c2f',
                border: '1px solid rgba(159,176,201,0.25)',
                borderRadius: 8,
                padding: 12,
                fontSize: 12,
                color: '#ff9cad',
                overflow: 'auto',
                maxHeight: 160,
              }}
            >
              {String(this.state.error.message)}
            </pre>
          ) : null}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button
              onClick={this.handleReload}
              style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#4361ee', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
            >
              Reload
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid rgba(159,176,201,0.4)', background: 'transparent', color: '#eaf3ff', fontWeight: 600, cursor: 'pointer' }}
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }
}

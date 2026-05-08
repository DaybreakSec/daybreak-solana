import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="bg-bg-elevated"
          style={{
            border: '0.5px solid var(--color-dawn-coral)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            margin: '20px 0',
          }}
        >
          <h2
            className="font-display text-dawn-coral mb-2"
            style={{ fontSize: '17px', fontWeight: 500 }}
          >
            something went wrong
          </h2>
          <p
            className="font-mono text-text-secondary mb-4"
            style={{ fontSize: '14px', lineHeight: '1.6' }}
          >
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="font-mono text-dawn-amber cursor-pointer"
            style={{
              fontSize: '13px',
              padding: '6px 14px',
              borderRadius: '999px',
              border: '0.5px solid var(--color-border-strong)',
              background: 'transparent',
            }}
          >
            try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

import { Component } from 'react'

// Catches a render error anywhere below it so one broken card/screen shows a
// recoverable message instead of blanking the entire app. Wraps <Routes> in
// App.jsx — outside AuthProvider/ProtectedRoute is deliberately not needed
// here, since a crash in auth/routing itself is rare enough that this
// class-component boundary (the only mechanism React offers for this) is
// scoped to the routed screens, where almost all render errors will actually
// originate.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled render error', error, info)
  }

  handleReload = () => {
    window.location.assign('/')
  }

  render() {
    if (this.state.hasError) {
      return (
        <main style={{ padding: 24 }}>
          <h1>Something went wrong</h1>
          <p>This screen hit an unexpected error. Reloading usually fixes it.</p>
          <button
            type="button"
            className="vip-btn vip-btn-secondary"
            style={{ marginTop: 16, width: 'auto' }}
            onClick={this.handleReload}
          >
            Reload
          </button>
        </main>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary

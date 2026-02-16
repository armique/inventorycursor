import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

// Simple Error Boundary to prevent white screen of death
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("React Error Boundary Caught:", error, errorInfo);
  }

  handleReset = () => {
    if (window.confirm("Do you want to reset Cloud Settings to try and fix the crash?")) {
      localStorage.removeItem('firebase_client_config');
      localStorage.removeItem('firebase_config');
    }
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-slate-50 text-slate-800 p-8 text-center font-sans">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl max-w-md border border-red-100">
             <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
             </div>
             <h1 className="text-2xl font-black mb-2">Something went wrong</h1>
             <p className="text-sm text-slate-500 mb-6">The application encountered an unexpected error.</p>
             
             <div className="bg-slate-50 p-4 rounded-xl text-xs font-mono text-left mb-6 overflow-auto max-h-32 border border-slate-200 text-red-600">
                {this.state.error?.toString()}
             </div>

             <button 
                onClick={this.handleReset}
                className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold uppercase text-xs tracking-widest hover:bg-black transition-all shadow-lg"
             >
                Reset App & Reload
             </button>
          </div>
        </div>
      );
    }

    return this.props.children; 
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Could not find root element to mount to");
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
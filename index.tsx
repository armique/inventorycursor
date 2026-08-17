import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import AppErrorBoundary from './components/AppErrorBoundary';
import { shouldBootPanel } from './utils/bootRoute';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Could not find root element to mount to');
const root = ReactDOM.createRoot(rootElement);

const boot = shouldBootPanel()
  ? import('./bootPanel')
  : import('./bootStorefront');

void boot.then(({ default: Boot }) => {
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <Boot />
      </AppErrorBoundary>
    </React.StrictMode>
  );
});

/**
 * Application Entry Point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'jotai';
import { AppProviders } from './app/providers';
import App from './app';

// Import styles
import './styles/tokens.css';
import './styles/base.css';

// Mount application
const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <Provider>
      <AppProviders>
        <App />
      </AppProviders>
    </Provider>
  </React.StrictMode>
);
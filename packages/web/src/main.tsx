/**
 * Application Entry Point
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'jotai';
import { AppProviders } from './app/providers';
import App from './app';

import 'xterm/css/xterm.css';

// Import styles
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

// Mount application
const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <Provider>
    <AppProviders>
      <App />
    </AppProviders>
  </Provider>
);

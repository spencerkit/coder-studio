/**
 * Application Entry Point
 */

import "@vitejs/plugin-react/preamble";
import { Provider } from "jotai";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import { AppProviders } from "./app/providers";

import "@xterm/xterm/css/xterm.css";
import "@xyflow/react/dist/style.css";

// Import fonts
import "./styles/fonts.css";

// Import styles
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

// Mount application
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

root.render(
  <Provider>
    <AppProviders>
      <App />
    </AppProviders>
  </Provider>
);

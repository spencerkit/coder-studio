/**
 * Application Entry Point
 */

import "@vitejs/plugin-react/preamble";
import { Provider } from "jotai";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app";
import { logStartupTraceOnce } from "./startup-trace";

import "@xyflow/react/dist/style.css";

// Import fonts
import "./styles/fonts.css";

// Import styles
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

// Mount application
logStartupTraceOnce("main:module_evaluated");
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
logStartupTraceOnce("main:render_started");

root.render(
  <Provider>
    <App />
  </Provider>
);
logStartupTraceOnce("main:render_called");

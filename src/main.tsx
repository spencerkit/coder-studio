import React from "react";
import ReactDOM from "react-dom/client";
import { RelaxProvider } from "@relax-state/react";
import App from "./App";
import "./styles/app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RelaxProvider>
      <App />
    </RelaxProvider>
  </React.StrictMode>
);

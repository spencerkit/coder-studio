import "@vitejs/plugin-react/preamble";
import { Provider } from "jotai";
import ReactDOM from "react-dom/client";
import { resolvePreviewRequest, UiPreviewApp } from "./app";
import { buildUiPreviewStore } from "./preview-store";

import "@xterm/xterm/css/xterm.css";
import "@xyflow/react/dist/style.css";
import "../styles/fonts.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";

const request = resolvePreviewRequest(window.location.search);
const store = buildUiPreviewStore(
  request.scene ? request.scene.seed(request.context) : request.context
);
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

root.render(
  <Provider store={store}>
    <UiPreviewApp request={request} />
  </Provider>
);

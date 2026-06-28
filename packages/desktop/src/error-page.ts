export interface DesktopErrorPageModel {
  title: string;
  detail: string;
  canRetry: boolean;
  logExcerpt?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderDesktopErrorPage(model: DesktopErrorPageModel): string {
  return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(model.title)}</title>
    <style>
      body {
        margin: 0;
        font-family: "IBM Plex Sans", system-ui, sans-serif;
        background: radial-gradient(circle at top, #152235, #09111b 58%, #060a10 100%);
        color: #f5f8fb;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      main {
        width: min(560px, calc(100vw - 48px));
        background: rgba(10, 18, 28, 0.86);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 28px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      p { color: rgba(245, 248, 251, 0.78); line-height: 1.5; }
      pre {
        margin: 20px 0 0;
        padding: 14px;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.26);
        color: rgba(245, 248, 251, 0.82);
        overflow: auto;
        font: 12px/1.45 "IBM Plex Mono", monospace;
      }
      .actions { display: flex; gap: 12px; margin-top: 24px; }
      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 16px;
        font: inherit;
        cursor: pointer;
      }
      .primary { background: #7ee787; color: #08110a; }
      .secondary { background: rgba(255,255,255,0.08); color: #f5f8fb; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(model.title)}</h1>
      <p>${escapeHtml(model.detail)}</p>
      ${model.logExcerpt ? `<pre>${escapeHtml(model.logExcerpt)}</pre>` : ""}
      <div class="actions">
        ${
          model.canRetry
            ? '<button class="primary" onclick="window.coderStudioDesktop.retryStartup()">Retry</button>'
            : ""
        }
        <button class="secondary" onclick="window.coderStudioDesktop.quit()">Quit</button>
      </div>
    </main>
  </body>
</html>
`;
}

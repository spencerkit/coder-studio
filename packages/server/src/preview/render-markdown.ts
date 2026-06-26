import { markdownUsesMermaid } from "@coder-studio/utils";
import MarkdownIt from "markdown-it";

const MERMAID_RUNTIME_SRC = "/api/preview/assets/mermaid.min.js";
const MERMAID_INIT_SRC = "/api/preview/assets/markdown-mermaid-init.js";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

const defaultFenceRenderer = md.renderer.rules.fence?.bind(md.renderer.rules);

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (!token) {
    return "";
  }

  const language = token.info.trim().split(/\s+/, 1)[0];
  if (language === "mermaid") {
    return `<pre class="mermaid">${md.utils.escapeHtml(token.content)}</pre>\n`;
  }

  if (defaultFenceRenderer) {
    return defaultFenceRenderer(tokens, idx, options, env, self);
  }

  return self.renderToken(tokens, idx, options);
};

const PREVIEW_CSS = `
  :root { color-scheme: light; }
  body {
    margin: 0;
    padding: 32px;
    font: 16px/1.6 "IBM Plex Sans", sans-serif;
    color: #1d232b;
    background: #fbfaf7;
  }
  img { max-width: 100%; height: auto; }
  pre {
    overflow: auto;
    padding: 16px;
    border-radius: 12px;
    background: #f2efe8;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th, td {
    border: 1px solid #d6d0c2;
    padding: 8px 10px;
  }
`;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMarkdownDocument(input: { markdown: string; title: string }): string {
  const body = md.render(input.markdown);
  const scripts = markdownUsesMermaid(input.markdown)
    ? `\n    <script src="${MERMAID_RUNTIME_SRC}"></script>\n    <script src="${MERMAID_INIT_SRC}"></script>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>${PREVIEW_CSS}</style>
  </head>
  <body>${body}${scripts}</body>
</html>`;
}

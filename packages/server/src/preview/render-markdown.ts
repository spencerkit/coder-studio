import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

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
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>${PREVIEW_CSS}</style>
  </head>
  <body>${body}</body>
</html>`;
}

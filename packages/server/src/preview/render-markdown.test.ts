import { describe, expect, it } from "vitest";
import { renderMarkdownDocument } from "./render-markdown.js";

describe("renderMarkdownDocument", () => {
  it("wraps markdown output in a full HTML document shell", () => {
    const html = renderMarkdownDocument({
      markdown: "# Title\n\n![Cover](./img/cover.png)",
      title: "docs/guide/intro.md",
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('src="./img/cover.png"');
    expect(html).toContain("<style>");
  });

  it("escapes raw html in markdown content", () => {
    const html = renderMarkdownDocument({
      markdown: "# Title\n\n<script>alert(1)</script>",
      title: "docs/guide/intro.md",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes the document title", () => {
    const html = renderMarkdownDocument({
      markdown: "# Title",
      title: `docs/guide/<script>alert("x")</script>.md`,
    });

    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("injects mermaid runtime assets for mermaid fenced code blocks", () => {
    const html = renderMarkdownDocument({
      markdown: "```mermaid\ngraph TD\nA[README] --> B[Preview]\n```",
      title: "README.md",
    });

    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain("/api/preview/assets/mermaid.min.js");
    expect(html).toContain("/api/preview/assets/markdown-mermaid-init.js");
  });
});

import type { CompiledCanvas } from "@coder-studio/core";
import MarkdownIt from "markdown-it";

interface ReportCanvasRendererProps {
  canvas: Extract<CompiledCanvas, { kind: "report_canvas" }>;
}

const panelStyle = {
  border: "1px solid rgba(31,41,51,0.12)",
  borderRadius: "20px",
  padding: "18px",
  background: "rgba(255,255,255,0.84)",
};

const markdownStyle = {
  color: "#52606d",
  lineHeight: 1.6,
};

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

function renderBlock(
  block: Extract<
    Extract<CompiledCanvas, { kind: "report_canvas" }>["sections"][number],
    { type: "section" }
  >["blocks"][number],
  key: string
) {
  switch (block.type) {
    case "markdown":
      return (
        <div
          key={key}
          style={markdownStyle}
          dangerouslySetInnerHTML={{ __html: markdown.render(block.markdown) }}
        />
      );
    case "list":
      return (
        <ul key={key} style={{ margin: 0, color: "#52606d", lineHeight: 1.6 }}>
          {block.items.map((item, index) => (
            <li key={`${key}-${index}`}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return (
        <table key={key} style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {block.columns.map((column) => (
                <th
                  key={`${key}-${column}`}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderBottom: "1px solid rgba(31,41,51,0.12)",
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${key}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${key}-${rowIndex}-${cellIndex}`}
                    style={{ padding: "10px 12px", borderBottom: "1px solid rgba(31,41,51,0.12)" }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "callout":
      return (
        <aside
          key={key}
          style={{
            borderRadius: "16px",
            padding: "14px 16px",
            background: "rgba(15,118,110,0.08)",
          }}
        >
          <h3 style={{ margin: "0 0 8px" }}>{block.title}</h3>
          <p style={{ margin: 0, color: "#52606d", lineHeight: 1.6 }}>{block.body}</p>
        </aside>
      );
    case "stats":
      return (
        <div
          key={key}
          style={{
            display: "grid",
            gap: "12px",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          }}
        >
          {block.items.map((item, index) => (
            <article
              key={`${key}-${index}`}
              style={{
                border: "1px solid rgba(31,41,51,0.12)",
                borderRadius: "14px",
                padding: "14px",
                background: "rgba(255,255,255,0.9)",
              }}
            >
              <span style={{ display: "block", color: "#52606d" }}>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>
      );
  }
}

export function ReportCanvasRenderer({ canvas }: ReportCanvasRendererProps) {
  return (
    <div style={{ display: "grid", gap: "18px" }}>
      {canvas.sections.map((section, sectionIndex) => {
        if (section.type === "stats") {
          return (
            <section key={`stats-${sectionIndex}`} style={panelStyle}>
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                }}
              >
                {section.items.map((item, itemIndex) => (
                  <article
                    key={`stats-${sectionIndex}-${itemIndex}`}
                    style={{
                      border: "1px solid rgba(31,41,51,0.12)",
                      borderRadius: "14px",
                      padding: "14px",
                      background: "rgba(255,255,255,0.9)",
                    }}
                  >
                    <span style={{ display: "block", color: "#52606d" }}>{item.label}</span>
                    <strong>{item.value}</strong>
                  </article>
                ))}
              </div>
            </section>
          );
        }

        return (
          <section key={`section-${sectionIndex}`} style={panelStyle}>
            <h2 style={{ marginTop: 0 }}>{section.title}</h2>
            <div style={{ display: "grid", gap: "14px" }}>
              {section.blocks.map((block, blockIndex) =>
                renderBlock(block, `section-${sectionIndex}-block-${blockIndex}`)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

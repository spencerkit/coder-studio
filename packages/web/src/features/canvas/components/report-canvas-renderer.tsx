import type { CompiledCanvas } from "@coder-studio/core";
import MarkdownIt from "markdown-it";
import type { RefObject } from "react";
import { CanvasSceneBox, type CanvasSceneRegistry } from "./canvas-scene-registry";
import { ReportCanvasChartRenderer } from "./report-canvas-chart-renderer";

interface ReportCanvasRendererProps {
  canvas: Extract<CompiledCanvas, { kind: "report_canvas" }>;
  sceneRegistry?: CanvasSceneRegistry;
  sceneRootRef?: RefObject<HTMLElement | null>;
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
  key: string,
  options: {
    sceneRegistry?: CanvasSceneRegistry;
    sceneRootRef?: RefObject<HTMLElement | null>;
    sectionIndex: number;
    blockIndex: number;
  }
) {
  const sceneIdBase = `section-${options.sectionIndex}:block-${options.blockIndex}`;

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
                  <CanvasSceneBox
                    as="td"
                    id={`table-cell:${sceneIdBase}:row-${rowIndex}:col-${cellIndex}`}
                    key={`${key}-${rowIndex}-${cellIndex}`}
                    kind="table-cell"
                    label={cell}
                    payload={{
                      column: block.columns[cellIndex] ?? "",
                      rowIndex,
                      cellIndex,
                      value: cell,
                    }}
                    sceneRegistry={options.sceneRegistry}
                    sceneRootRef={options.sceneRootRef}
                    style={{ padding: "10px 12px", borderBottom: "1px solid rgba(31,41,51,0.12)" }}
                  >
                    {cell}
                  </CanvasSceneBox>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "callout":
      return (
        <CanvasSceneBox
          as="aside"
          id={`callout:${sceneIdBase}`}
          key={key}
          kind="callout"
          label={block.title}
          payload={{ tone: block.tone, body: block.body }}
          sceneRegistry={options.sceneRegistry}
          sceneRootRef={options.sceneRootRef}
          style={{
            borderRadius: "16px",
            padding: "14px 16px",
            background: "rgba(15,118,110,0.08)",
          }}
        >
          <h3 style={{ margin: "0 0 8px" }}>{block.title}</h3>
          <p style={{ margin: 0, color: "#52606d", lineHeight: 1.6 }}>{block.body}</p>
        </CanvasSceneBox>
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
            <CanvasSceneBox
              as="article"
              id={`report-stat:${sceneIdBase}:item-${index}`}
              key={`${key}-${index}`}
              kind="report-stat"
              label={item.label}
              payload={{ tone: item.tone ?? "neutral", value: item.value }}
              sceneRegistry={options.sceneRegistry}
              sceneRootRef={options.sceneRootRef}
              style={{
                border: "1px solid rgba(31,41,51,0.12)",
                borderRadius: "14px",
                padding: "14px",
                background: "rgba(255,255,255,0.9)",
              }}
            >
              <span style={{ display: "block", color: "#52606d" }}>{item.label}</span>
              <strong>{item.value}</strong>
            </CanvasSceneBox>
          ))}
        </div>
      );
    case "chart":
      return (
        <CanvasSceneBox
          as="div"
          id={`chart-block:${sceneIdBase}`}
          key={key}
          kind="chart-block"
          label={block.title}
          payload={{ chartKind: block.kind, unit: block.unit, seriesCount: block.series.length }}
          sceneRegistry={options.sceneRegistry}
          sceneRootRef={options.sceneRootRef}
        >
          <ReportCanvasChartRenderer
            block={block}
            sceneRegistry={options.sceneRegistry}
            sceneRootRef={options.sceneRootRef}
            semanticBaseId={`chart-block:${sceneIdBase}`}
          />
        </CanvasSceneBox>
      );
  }

  return null;
}

export function ReportCanvasRenderer({
  canvas,
  sceneRegistry,
  sceneRootRef,
}: ReportCanvasRendererProps) {
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
                renderBlock(block, `section-${sectionIndex}-block-${blockIndex}`, {
                  sceneRegistry,
                  sceneRootRef,
                  sectionIndex,
                  blockIndex,
                })
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

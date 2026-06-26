import type { PropsWithChildren, ReactNode } from "react";

export type CanvasContentLayout = "page" | "inline";

interface CanvasRouteFrameProps extends PropsWithChildren {
  title?: string;
  summary?: string;
  error?: ReactNode;
  loading?: boolean;
  variant?: "report" | "architecture";
  layout?: CanvasContentLayout;
}

export function CanvasRouteFrame({
  children,
  title,
  summary,
  error,
  loading = false,
  variant = "report",
  layout = "page",
}: CanvasRouteFrameProps) {
  const isArchitecture = variant === "architecture";
  const isInline = layout === "inline";

  return (
    <main
      className={isInline ? "canvas-route-frame canvas-route-frame--inline" : "canvas-route-frame"}
      style={{
        minHeight: isInline ? "auto" : "100vh",
        padding: isInline ? "16px" : "24px",
        background: isArchitecture
          ? "linear-gradient(180deg, rgba(244,249,248,1) 0%, rgba(235,242,241,1) 100%)"
          : "linear-gradient(180deg, rgba(248,245,238,1) 0%, rgba(240,234,223,1) 100%)",
        color: "#1f2933",
        fontFamily: isArchitecture
          ? '"Instrument Sans", "Avenir Next", "Segoe UI", sans-serif'
          : '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif',
      }}
    >
      <section
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          display: "grid",
          gap: "18px",
        }}
      >
        {title ? (
          <header style={{ display: "grid", gap: isArchitecture ? "12px" : "10px" }}>
            {isArchitecture ? (
              <p
                style={{
                  margin: 0,
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#0f766e",
                }}
              >
                Canvas Renderer
              </p>
            ) : null}
            <h1
              style={{
                margin: 0,
                fontSize: "clamp(2rem, 4vw, 3rem)",
                lineHeight: isArchitecture ? 0.98 : 1.05,
                color: isArchitecture ? "#0f172a" : "#1f2933",
                letterSpacing: isArchitecture ? "-0.03em" : undefined,
              }}
            >
              {title}
            </h1>
            {summary ? (
              <p
                style={{
                  margin: 0,
                  color: "#52606d",
                  fontSize: isArchitecture ? "1.02rem" : "1rem",
                  lineHeight: 1.6,
                  maxWidth: isArchitecture ? "72ch" : undefined,
                }}
              >
                {summary}
              </p>
            ) : null}
          </header>
        ) : null}
        {loading ? (
          <section
            style={{
              border: "1px solid rgba(31,41,51,0.12)",
              borderRadius: "20px",
              padding: "18px",
              background: "rgba(255,255,255,0.84)",
            }}
          >
            Loading canvas...
          </section>
        ) : null}
        {error ? (
          <section
            style={{
              border: "1px solid rgba(185,28,28,0.2)",
              borderRadius: "20px",
              padding: "18px",
              background: "rgba(255,255,255,0.84)",
              color: "#7f1d1d",
            }}
          >
            {error}
          </section>
        ) : null}
        {!loading && !error ? children : null}
      </section>
    </main>
  );
}

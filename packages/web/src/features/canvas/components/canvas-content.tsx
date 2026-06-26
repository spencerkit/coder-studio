import type { CanvasDataResponse } from "@coder-studio/core";
import { useEffect, useState } from "react";
import { fetchCanvasData } from "../api";
import { ArchitectureCanvasRenderer } from "./architecture-canvas-renderer";
import { type CanvasContentLayout, CanvasRouteFrame } from "./canvas-route-frame";
import { ReportCanvasRenderer } from "./report-canvas-renderer";

export type { CanvasContentLayout } from "./canvas-route-frame";

interface CanvasContentProps {
  workspaceId: string;
  sourcePath: string;
  refreshToken?: number;
  layout?: CanvasContentLayout;
}

export function CanvasContent({
  workspaceId,
  sourcePath,
  refreshToken = 0,
  layout = "page",
}: CanvasContentProps) {
  const [data, setData] = useState<CanvasDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const normalizedSourcePath = sourcePath.trim();
    if (!workspaceId || !normalizedSourcePath) {
      setData(null);
      setError("Canvas route is missing workspace or source path.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setData(null);
    setLoading(true);
    setError(null);

    void fetchCanvasData(workspaceId, normalizedSourcePath)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setData(response);
        setLoading(false);
      })
      .catch((nextError) => {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Failed to load canvas.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken, sourcePath, workspaceId]);

  if (loading) {
    return <CanvasRouteFrame layout={layout} loading />;
  }

  if (error) {
    return <CanvasRouteFrame layout={layout} error={<p style={{ margin: 0 }}>{error}</p>} />;
  }

  if (!data) {
    return (
      <CanvasRouteFrame
        layout={layout}
        error={<p style={{ margin: 0 }}>Canvas data is unavailable.</p>}
      />
    );
  }

  if (data.renderStatus === "error") {
    return (
      <CanvasRouteFrame
        layout={layout}
        title={data.title}
        error={
          <div>
            <h2 style={{ marginTop: 0 }}>Render failed</h2>
            <p style={{ marginBottom: 0 }}>{data.lastError?.message ?? "Unknown canvas error."}</p>
          </div>
        }
      />
    );
  }

  if (!data.compiledDocument) {
    return (
      <CanvasRouteFrame
        layout={layout}
        error={<p style={{ margin: 0 }}>Canvas data is unavailable.</p>}
      />
    );
  }

  if (data.compiledDocument.kind === "architecture_canvas") {
    return (
      <CanvasRouteFrame
        layout={layout}
        title={data.compiledDocument.title}
        summary={data.compiledDocument.summary}
        variant="architecture"
      >
        <ArchitectureCanvasRenderer canvas={data.compiledDocument} />
      </CanvasRouteFrame>
    );
  }

  return (
    <CanvasRouteFrame layout={layout} title={data.compiledDocument.title}>
      <ReportCanvasRenderer canvas={data.compiledDocument} />
    </CanvasRouteFrame>
  );
}

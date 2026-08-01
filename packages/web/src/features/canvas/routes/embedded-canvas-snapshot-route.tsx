import type { CanvasSnapshotDataResponse } from "@coder-studio/core";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchCanvasSnapshotData } from "../api";
import { ArchitectureCanvasRenderer } from "../components/architecture-canvas-renderer";
import { CanvasRouteFrame } from "../components/canvas-route-frame";
import { ReportCanvasRenderer } from "../components/report-canvas-renderer";

export function EmbeddedCanvasSnapshotRoute() {
  const { snapshotId } = useParams<{ snapshotId: string }>();
  const [data, setData] = useState<CanvasSnapshotDataResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshotId) {
      setData(null);
      setError("Canvas snapshot route is missing snapshot id.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setData(null);
    setLoading(true);
    setError(null);

    void fetchCanvasSnapshotData(snapshotId)
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
  }, [snapshotId]);

  if (loading) {
    return <CanvasRouteFrame layout="page" loading />;
  }

  if (error) {
    return <CanvasRouteFrame layout="page" error={<p style={{ margin: 0 }}>{error}</p>} />;
  }

  if (!data) {
    return (
      <CanvasRouteFrame
        layout="page"
        error={<p style={{ margin: 0 }}>Canvas data is unavailable.</p>}
      />
    );
  }

  if (data.compiledDocument.kind === "architecture_canvas") {
    return (
      <CanvasRouteFrame
        layout="page"
        title={data.compiledDocument.title}
        summary={data.compiledDocument.summary}
        variant="architecture"
      >
        <ArchitectureCanvasRenderer canvas={data.compiledDocument} />
      </CanvasRouteFrame>
    );
  }

  return (
    <CanvasRouteFrame layout="page" title={data.compiledDocument.title}>
      <ReportCanvasRenderer canvas={data.compiledDocument} />
    </CanvasRouteFrame>
  );
}

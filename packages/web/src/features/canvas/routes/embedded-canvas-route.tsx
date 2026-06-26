import { useParams, useSearchParams } from "react-router-dom";
import { CanvasContent } from "../components/canvas-content";

export function EmbeddedCanvasRoute() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams] = useSearchParams();
  const sourcePath = searchParams.get("sourcePath") ?? "";
  const refreshToken = Number.parseInt(searchParams.get("refresh") ?? "0", 10);

  if (!workspaceId || !sourcePath) {
    return <CanvasContent workspaceId={workspaceId ?? ""} sourcePath={sourcePath} layout="page" />;
  }

  return (
    <CanvasContent
      workspaceId={workspaceId}
      sourcePath={sourcePath}
      refreshToken={Number.isFinite(refreshToken) ? refreshToken : 0}
      layout="page"
    />
  );
}

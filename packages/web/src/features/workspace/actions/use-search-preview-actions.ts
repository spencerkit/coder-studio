import type { SearchSessionFilePreview } from "@coder-studio/core";
import { useAtomValue, useSetAtom } from "jotai";
import { wsClientAtom } from "../../../atoms/connection";
import { activeFilePathAtomFamily, editorModeAtomFamily, gitDiffPreviewAtomFamily } from "../atoms";

export function useSearchPreviewActions(workspaceId: string) {
  const wsClient = useAtomValue(wsClientAtom);
  const setDiffPreview = useSetAtom(gitDiffPreviewAtomFamily(workspaceId));
  const setActiveFilePath = useSetAtom(activeFilePathAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));

  const openSearchPreview = async (sessionId: string, path: string) => {
    if (!wsClient) {
      return false;
    }

    const preview = await wsClient.sendCommand<SearchSessionFilePreview>(
      "file.searchSession.previewFile",
      {
        workspaceId,
        sessionId,
        path,
      }
    );

    setActiveFilePath(path);
    setDiffPreview(preview);
    setEditorMode("diff");
    return true;
  };

  return { openSearchPreview };
}

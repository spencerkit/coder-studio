import { useAtomValue, useSetAtom } from "jotai";
import { useTranslation } from "../../../../lib/i18n";
import { useOpenLocation } from "../../../code-editor/actions/use-open-location";
import {
  activeFilePathAtomFamily,
  deriveEditorModeForPath,
  editorModeAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";

interface OpenEditorsSectionProps {
  workspaceId: string;
  onSelectFile?: (path: string) => void;
  title?: string;
}

export function OpenEditorsSection({ workspaceId, onSelectFile, title }: OpenEditorsSectionProps) {
  const t = useTranslation();
  const openFiles = useAtomValue(openFilesAtomFamily(workspaceId));
  const activeFilePath = useAtomValue(activeFilePathAtomFamily(workspaceId));
  const setEditorMode = useSetAtom(editorModeAtomFamily(workspaceId));
  const { openLocation } = useOpenLocation(workspaceId);
  const openEditorPaths = Object.keys(openFiles).sort((left, right) => left.localeCompare(right));

  return (
    <section className="workspace-sidebar-section">
      <h2 className="workspace-sidebar-section__title">
        {title ?? t("workspace.sidebar.open_editors")}
      </h2>
      <div className="workspace-open-editors">
        {openEditorPaths.map((path) => (
          <button
            key={path}
            type="button"
            className={`workspace-open-editors__item ${
              activeFilePath === path ? "workspace-open-editors__item--active" : ""
            }`}
            title={path}
            onClick={() => {
              setEditorMode(deriveEditorModeForPath(path));
              void openLocation({
                workspaceId,
                path,
                source: "manual",
              });
              onSelectFile?.(path);
            }}
          >
            {path}
          </button>
        ))}
      </div>
    </section>
  );
}

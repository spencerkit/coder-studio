import { Maximize2, Minimize2 } from "lucide-react";
import { useTranslation } from "../../../lib/i18n";
import type { WorkspaceFullscreenController } from "../actions/use-workspace-fullscreen";

interface WorkspaceFullscreenButtonProps {
  controller?: WorkspaceFullscreenController;
  className: string;
  iconSize: number;
  dataTestId?: string;
}

export function WorkspaceFullscreenButton({
  controller,
  className,
  iconSize,
  dataTestId,
}: WorkspaceFullscreenButtonProps) {
  const t = useTranslation();

  if (!controller) {
    return null;
  }

  const label = controller.isFullscreen
    ? t("tooltip.exit_fullscreen")
    : t("tooltip.enter_fullscreen");
  const Icon = controller.isFullscreen ? Minimize2 : Maximize2;

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      title={label}
      data-testid={dataTestId}
      onClick={() => {
        void controller.toggleFullscreen();
      }}
    >
      <Icon size={iconSize} />
    </button>
  );
}

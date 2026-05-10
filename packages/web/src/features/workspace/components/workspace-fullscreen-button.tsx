import { Maximize2, Minimize2 } from "lucide-react";
import { IconButton, Tooltip } from "../../../components/ui";
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
    <Tooltip content={label}>
      <IconButton
        aria-label={label}
        className={className}
        data-testid={dataTestId}
        icon={<Icon size={iconSize} />}
        onClick={() => {
          void controller.toggleFullscreen();
        }}
      />
    </Tooltip>
  );
}

import { useAtomValue } from "jotai";
import { useCallback, useState } from "react";
import { fencingStateAtom } from "../../../../atoms/fencing";
import { Button } from "../../../../components/ui";
import { useFencing } from "../../../../hooks/use-fencing";
import { useTranslation } from "../../../../lib/i18n";

interface ObserverBannerProps {
  workspaceId: string;
}

export function ObserverBanner({ workspaceId }: ObserverBannerProps) {
  const t = useTranslation();
  const fencingStates = useAtomValue(fencingStateAtom);
  const state = fencingStates.get(workspaceId);
  const { requestTakeover } = useFencing(workspaceId);
  const [takingOver, setTakingOver] = useState(false);

  const handleTakeover = useCallback(async () => {
    setTakingOver(true);
    try {
      await requestTakeover();
    } finally {
      setTakingOver(false);
    }
  }, [requestTakeover]);

  if (!state || state.isController) {
    return null;
  }

  return (
    <div className="observer-banner" role="alert">
      <span className="observer-banner-icon">👁</span>
      <span className="observer-banner-text">{t("fencing.observer_mode")}</span>
      <Button onClick={handleTakeover} disabled={takingOver} size="sm" variant="secondary">
        {takingOver ? t("fencing.taking_over") : t("fencing.takeover")}
      </Button>
    </div>
  );
}

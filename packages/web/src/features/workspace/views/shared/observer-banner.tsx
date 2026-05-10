import { useAtomValue } from "jotai";
import { useCallback, useState } from "react";
import { fencingStateAtom } from "../../../../atoms/fencing";
import { Button } from "../../../../components/ui";
import { useFencing } from "../../../../hooks/use-fencing";

interface ObserverBannerProps {
  workspaceId: string;
}

export function ObserverBanner({ workspaceId }: ObserverBannerProps) {
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
      <span className="observer-banner-text">只读模式 — 另一个标签页正在控制</span>
      <Button onClick={handleTakeover} disabled={takingOver} size="sm" variant="secondary">
        {takingOver ? "接管中..." : "接管控制"}
      </Button>
    </div>
  );
}

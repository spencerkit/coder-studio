import { useAtom } from "jotai";
import { useCallback } from "react";
import { supervisorDetailsAtom } from "../atoms";

export function useSupervisorDetails(sessionId?: string) {
  const [details, setDetails] = useAtom(supervisorDetailsAtom);
  const isVisible = details.open && (!sessionId || details.sessionId === sessionId);

  const openDetails = useCallback(
    (nextSessionId: string) => {
      setDetails({
        open: true,
        sessionId: nextSessionId,
      });
    },
    [setDetails]
  );

  const closeDetails = useCallback(() => {
    setDetails({
      open: false,
      sessionId: null,
    });
  }, [setDetails]);

  return {
    details,
    isVisible,
    openDetails,
    closeDetails,
  };
}

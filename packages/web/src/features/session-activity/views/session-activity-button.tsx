import { useSetAtom } from "jotai";
import { Button } from "../../../components/ui";
import { sessionActivityDialogOpenAtomFamily } from "../atoms";

interface SessionActivityButtonProps {
  sessionId: string;
  workspaceId: string;
}

export function SessionActivityButton({ sessionId, workspaceId }: SessionActivityButtonProps) {
  const setOpen = useSetAtom(sessionActivityDialogOpenAtomFamily(sessionId));

  return (
    <Button
      aria-label="Logs"
      size="sm"
      variant="ghost"
      onClick={() => {
        setOpen(true);
      }}
    >
      Logs
    </Button>
  );
}

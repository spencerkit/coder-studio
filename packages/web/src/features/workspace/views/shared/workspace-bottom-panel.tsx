import { useAtom } from "jotai";
import { Tab, TabList, Tabs } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { type BottomPanelTab, bottomPanelActiveTabAtomFamily } from "../../../bottom-panel";
import { TasksPanel } from "../../../tasks";
import { TerminalPanel } from "../../../terminal-panel";

interface WorkspaceBottomPanelProps {
  workspaceId: string;
}

export function WorkspaceBottomPanel({ workspaceId }: WorkspaceBottomPanelProps) {
  const t = useTranslation();
  const [activeTab, setActiveTab] = useAtom(bottomPanelActiveTabAtomFamily(workspaceId));

  return (
    <div className="workspace-bottom-panel-shell">
      <Tabs
        aria-label={t("bottom_panel.tabs_label")}
        className="workspace-bottom-panel-tabs-shell"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as BottomPanelTab)}
      >
        <TabList className="workspace-bottom-panel-tabs">
          <Tab className="workspace-bottom-panel-tab" value="terminal">
            {t("bottom_panel.terminal")}
          </Tab>
          <Tab className="workspace-bottom-panel-tab" value="tasks">
            {t("bottom_panel.tasks")}
          </Tab>
        </TabList>
      </Tabs>
      <div className="workspace-bottom-panel-body">
        {activeTab === "terminal" ? <TerminalPanel /> : <TasksPanel workspaceId={workspaceId} />}
      </div>
    </div>
  );
}

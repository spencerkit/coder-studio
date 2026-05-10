import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tab, TabList, TabPanel, Tabs } from ".";

describe("Tabs", () => {
  it("provides tablist, tab, and tabpanel semantics with controlled selection", () => {
    const onValueChange = vi.fn();

    render(
      <Tabs aria-label="Workspace sections" onValueChange={onValueChange} value="files">
        <TabList className="panel-tabs">
          <Tab className="panel-tab" value="files">
            Files
          </Tab>
          <Tab className="panel-tab" value="git">
            Git
          </Tab>
        </TabList>
        <TabPanel value="files">Files panel</TabPanel>
        <TabPanel value="git">Git panel</TabPanel>
      </Tabs>
    );

    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-controls");
    expect(screen.getByRole("tabpanel", { name: "Files" })).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Git" })).toBeNull();
  });

  it("calls onValueChange when a tab is clicked and keeps caller classes", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Tabs aria-label="Workspace sections" onValueChange={onValueChange} value="files">
        <TabList className="panel-tabs">
          <Tab className="panel-tab" value="files">
            Files
          </Tab>
          <Tab className="panel-tab" value="git">
            Git
          </Tab>
        </TabList>
      </Tabs>
    );

    const gitTab = screen.getByRole("tab", { name: "Git" });
    expect(gitTab).toHaveClass("panel-tab");
    await user.click(gitTab);

    expect(onValueChange).toHaveBeenCalledWith("git");
  });

  it("applies the Tabs aria-label to the rendered tablist", () => {
    render(
      <Tabs aria-label="Workspace sections" onValueChange={vi.fn()} value="files">
        <TabList className="panel-tabs">
          <Tab className="panel-tab" value="files">
            Files
          </Tab>
          <Tab className="panel-tab" value="git">
            Git
          </Tab>
        </TabList>
      </Tabs>
    );

    expect(screen.getByRole("tablist", { name: "Workspace sections" })).toBeInTheDocument();
  });

  it("keeps caller click handlers while changing the active value", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onValueChange = vi.fn();

    render(
      <Tabs aria-label="Workspace sections" onValueChange={onValueChange} value="files">
        <TabList className="panel-tabs">
          <Tab className="panel-tab" value="files">
            Files
          </Tab>
          <Tab className="panel-tab" onClick={onClick} value="git">
            Git
          </Tab>
        </TabList>
      </Tabs>
    );

    await user.click(screen.getByRole("tab", { name: "Git" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith("git");
  });

  it("uses the rendered tablist orientation for keyboard navigation", () => {
    const onValueChange = vi.fn();

    render(
      <Tabs aria-label="Workspace sections" onValueChange={onValueChange} value="files">
        <TabList className="panel-tabs" orientation="vertical">
          <Tab className="panel-tab" value="files">
            Files
          </Tab>
          <Tab className="panel-tab" value="git">
            Git
          </Tab>
        </TabList>
      </Tabs>
    );

    const filesTab = screen.getByRole("tab", { name: "Files" });
    filesTab.focus();
    fireEvent.keyDown(filesTab, { key: "ArrowDown" });

    expect(onValueChange).toHaveBeenCalledWith("git");
  });

  it("does not point tabs at missing tabpanels when panels are omitted", () => {
    render(
      <Tabs aria-label="Workspace sections" onValueChange={vi.fn()} value="files">
        <TabList className="panel-tabs">
          <Tab className="panel-tab" value="files">
            Files
          </Tab>
          <Tab className="panel-tab" value="git">
            Git
          </Tab>
        </TabList>
      </Tabs>
    );

    expect(screen.getByRole("tab", { name: "Files" })).not.toHaveAttribute("aria-controls");
    expect(screen.getByRole("tab", { name: "Git" })).not.toHaveAttribute("aria-controls");
  });

  it("changes selection from the keyboard without firing caller click handlers", () => {
    const onClick = vi.fn();
    const onValueChange = vi.fn();

    render(
      <Tabs aria-label="Workspace sections" onValueChange={onValueChange} value="files">
        <TabList className="panel-tabs">
          <Tab className="panel-tab" value="files">
            Files
          </Tab>
          <Tab className="panel-tab" onClick={onClick} value="git">
            Git
          </Tab>
        </TabList>
      </Tabs>
    );

    const filesTab = screen.getByRole("tab", { name: "Files" });
    filesTab.focus();
    fireEvent.keyDown(filesTab, { key: "ArrowRight" });

    expect(onValueChange).toHaveBeenCalledWith("git");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("allows tab bars without panels", () => {
    render(
      <Tabs aria-label="Workspace sections" onValueChange={vi.fn()} value="files">
        <TabList className="panel-tabs">
          <Tab className="panel-tab" value="files">
            Files
          </Tab>
          <Tab className="panel-tab" value="git">
            Git
          </Tab>
        </TabList>
      </Tabs>
    );

    expect(screen.getByRole("tablist")).toHaveClass("panel-tabs");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveClass("panel-tab");
  });
});

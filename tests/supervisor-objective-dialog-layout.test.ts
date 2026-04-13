import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("supervisor objective uses in-app dialog instead of browser prompt/confirm", () => {
  const screenSource = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(screenSource, /window\.prompt\(/);
  assert.doesNotMatch(screenSource, /window\.confirm\(/);
  assert.match(screenSource, /SupervisorObjectiveDialog/);
  assert.match(screenSource, /setSupervisorObjectiveDialog\(/);
});

test("supervisor objective dialog supports textarea editing, generated context preview, and disable confirmation copy", () => {
  const dialogSource = readFileSync(
    new URL("../apps/web/src/features/workspace/SupervisorObjectiveDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(dialogSource, /role="dialog"/);
  assert.match(dialogSource, /aria-modal="true"/);
  assert.match(dialogSource, /textarea/);
  assert.match(dialogSource, /composeSupervisorObjectivePreview/);
  assert.match(dialogSource, /supervisorContextPreview/);
  assert.match(dialogSource, /supervisor-objective-dialog-preview/);
  assert.match(dialogSource, /supervisorDisableTitle/);
});

test("supervisor controls live in a dedicated region with clearer action icons", () => {
  const paneSource = readFileSync(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.match(paneSource, /agent-pane-supervisor/);
  assert.match(paneSource, /agent-pane-supervisor-actions/);
  assert.match(paneSource, /BadgeCheckIcon/);
  assert.match(paneSource, /MessageSquareIcon/);
  assert.match(paneSource, /CirclePauseIcon/);
  assert.match(paneSource, /SquareIcon/);
  assert.doesNotMatch(paneSource, /Edit3Icon/);
  assert.doesNotMatch(paneSource, /pane-action-text">O</);
  assert.doesNotMatch(paneSource, /pane-action-text">P</);
  assert.doesNotMatch(paneSource, /pane-action-text">R</);
  assert.doesNotMatch(paneSource, /pane-action-text">S</);
});

test("supervisor toolbar shows only label and actions without summary copy", () => {
  const paneSource = readFileSync(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.match(paneSource, /agent-pane-supervisor-label/);
  assert.match(paneSource, /handleEditSupervisorObjective/);
  assert.match(paneSource, /onEditSupervisorObjective\(session\.id, supervisor\.objectiveText\)/);
  assert.doesNotMatch(paneSource, /agent-pane-supervisor-summary/);
  assert.doesNotMatch(paneSource, /Objective hidden from the shared workspace view\./);
});

test("supervisor region uses card-style structure without summary rows", () => {
  const paneSource = readFileSync(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.match(paneSource, /agent-pane-supervisor-card/);
  assert.match(paneSource, /agent-pane-supervisor-copy/);
  assert.doesNotMatch(paneSource, /agent-pane-supervisor-summary/);
});

test("supervisor card exposes state-specific styling while keeping objective hidden in the card", () => {
  const paneSource = readFileSync(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.match(paneSource, /data-state=\{supervisor \? supervisor\.status : "off"\}/);
  assert.doesNotMatch(paneSource, /title=\{supervisorSummary\}/);
});

test("supervisor objective is hidden in the header card without duplicate body banner copy", () => {
  const paneSource = readFileSync(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(paneSource, /agent-pane-supervisor-summary/);
  assert.doesNotMatch(paneSource, /agent-supervisor-banner-title/);
});

test("supervisor body does not render an empty banner shell", () => {
  const paneSource = readFileSync(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(paneSource, /agent-supervisor-banner/);
});

test("supervisor objective dialog styles support modal layout and textarea sizing", () => {
  const styleSource = readFileSync(
    new URL("../apps/web/src/styles/app.css", import.meta.url),
    "utf8",
  );

  assert.match(styleSource, /\.supervisor-objective-dialog-card\s*\{/);
  assert.match(styleSource, /\.supervisor-objective-dialog-textarea\s*\{/);
  assert.match(styleSource, /\.supervisor-objective-dialog-preview\s*\{/);
  assert.match(styleSource, /\.supervisor-objective-dialog-preview-label\s*\{/);
  assert.match(styleSource, /\.supervisor-objective-dialog-preview-code\s*\{/);
  assert.match(styleSource, /\.agent-pane-supervisor\s*\{/);
  assert.match(styleSource, /\.agent-pane-supervisor-card\s*\{/);
  assert.match(styleSource, /\.agent-pane-supervisor-card\[data-state="paused"\]\s*\{/);
  assert.match(styleSource, /\.agent-pane-supervisor-card\[data-state="error"\]\s*\{/);
  assert.match(styleSource, /\.agent-pane-supervisor-card\[data-state="evaluating"\]\s*\{/);
  assert.match(styleSource, /\.agent-pane-supervisor-label\s*\{/);
  assert.doesNotMatch(styleSource, /\.agent-pane-supervisor-summary\s*\{/);
  assert.match(styleSource, /\.agent-pane-supervisor-actions\s*\{/);
  assert.match(styleSource, /min-height:\s*120px/);
  assert.match(styleSource, /border:\s*1px solid var\(--border-subtle\)/);
  assert.match(styleSource, /border-radius:\s*10px/);
  assert.match(styleSource, /background:\s*var\(--surface-chip\)/);
});

# Agent Panel Token Trend Design

## Goal

Add a compact token consumption trend chart to the AGENT.MD sidebar panel. The chart shows the current project's token consumption over the most recent 24 hours and appears at the top of the expanded panel content.

## Placement

Render the chart as the first content block inside `AgentInstructionsSection` when the AGENT.MD panel is expanded. It appears above the existing "项目 AGENT.MD" status group and above the "系统 AGENT.MD" group.

The outer AGENT.MD header remains unchanged. Collapsing the panel hides the chart together with the rest of the panel body.

## Data Flow

Use the existing work-analysis dashboard command from the web client:

```ts
dispatch("work.analysis.dashboard.get", {
  workspacePaths: [workspace.path],
  timeRange: { preset: "24h" },
});
```

Read token trend data from `result.data.dashboard.trends.tokenHourly`. This avoids adding a new server command because the required 24-hour token data already exists.

The chart only runs when `workspace.path` is available. If the workspace cannot be resolved, the chart does not render and does not dispatch.

## UI States

The chart block has four states:

- Loading: show a compact muted skeleton sized like the final chart.
- Ready with data: render an ECharts line/area chart using hourly token totals.
- Empty: show "最近 24 小时暂无 token 数据".
- Error: show a low-emphasis inline message and keep the existing Agent.md controls usable.

The chart header shows:

- Title: `Token 消耗趋势`
- Subtitle: `当前项目 · 最近 24 小时`
- Summary metric: total tokens across the 24-hour points

The chart footer shows peak hourly token usage and total session count when data exists.

## Visual Direction

Keep the visual language aligned with the existing sidebar:

- Use `workspace-agent-instructions__*` CSS classes.
- Use existing theme tokens for text, borders, surfaces, and status colors.
- Keep the chart compact so it does not dominate the sidebar.
- Avoid introducing new global visual patterns or new chart dependencies.

## Component Boundaries

Add `agent-instructions-token-trend.tsx` beside `agent-instructions-section.tsx` to keep the existing Agent.md actions readable.

The child component is responsible for:

- Dispatching the 24-hour work-analysis query for the current workspace path.
- Normalizing hourly points for display.
- Rendering loading, ready, empty, and error states.
- Disposing the ECharts instance on unmount.

`AgentInstructionsSection` remains responsible for panel state, Agent.md status, generation, and edit actions.

## Testing

Add focused tests for `agent-instructions-token-trend.tsx` plus one placement assertion in `AgentInstructionsSection` tests. Verify:

- It dispatches `work.analysis.dashboard.get` with the current workspace path and `24h` time range.
- It renders the chart block before the existing project Agent.md group.
- It renders the empty state when `tokenHourly` has no token/session data.
- It renders an error state without hiding existing Agent.md controls.

Run focused web tests for the touched component and a typecheck or broader verification command before handoff.

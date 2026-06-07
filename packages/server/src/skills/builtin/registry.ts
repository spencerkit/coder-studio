export interface BuiltinSkillDefinition {
  slug: string;
  displayName: string;
  description: string;
  version: string;
  defaultEnabled: boolean;
  autoMountInMvp: boolean;
  content: string;
}

const AUTOMATION_SKILL = `---
name: coder-studio-automation
description: Use when running inside Coder Studio and you need workspace, session, terminal, Git, or automation discovery.
---

# Coder Studio Automation

When CODER_STUDIO=1 is present:

1. Run \`coder-studio identify --json\` to inspect current context.
2. Run \`coder-studio capabilities --json\` to discover supported commands.
3. Prefer commands with \`--json\`.
4. Use current workspace and session IDs from identify instead of guessing.
5. Do not run destructive commands unless the user explicitly asked.
6. If a command returns approval_required, explain what approval is needed and wait.
`;

const BROWSER_VERIFICATION_SKILL = `---
name: coder-studio-browser-verification
description: Use after frontend, UI, CSS, route, form, or browser-visible changes to verify the app in Coder Studio's browser automation surface.
---

# Browser Verification

For browser-visible changes:

1. Use \`coder-studio identify --json\`.
2. Use \`coder-studio capabilities --json\` and find browser commands.
3. Start the dev server in a terminal when needed.
4. Open the local URL in a Coder Studio browser surface.
5. Wait for the expected text or selector.
6. Capture a screenshot.
7. Read console errors.
8. Report visible issues and fix them before final response.

If browser capabilities are not available, say so and use the best available local verification.
`;

const REVIEW_SKILL = `---
name: coder-studio-review
description: Use before finishing a coding task in Coder Studio to inspect Git changes, tests, and residual risk.
---

# Coder Studio Review

Before final response after code edits:

1. Run \`coder-studio identify --json\`.
2. Use capabilities to find Git and terminal commands.
3. Inspect Git status and diff.
4. Run relevant tests when practical.
5. Report files changed, verification run, and any remaining risk.
`;

export const BUILTIN_SKILLS: BuiltinSkillDefinition[] = [
  {
    slug: "coder-studio-automation",
    displayName: "Coder Studio Automation",
    description: "Teach agents to identify Coder Studio context and discover automation commands.",
    version: "1.0.0",
    defaultEnabled: true,
    autoMountInMvp: true,
    content: AUTOMATION_SKILL,
  },
  {
    slug: "coder-studio-browser-verification",
    displayName: "Coder Studio Browser Verification",
    description: "Teach agents to verify browser-visible changes through Coder Studio automation.",
    version: "1.0.0",
    defaultEnabled: true,
    autoMountInMvp: false,
    content: BROWSER_VERIFICATION_SKILL,
  },
  {
    slug: "coder-studio-review",
    displayName: "Coder Studio Review",
    description: "Teach agents to review Git changes, tests, and residual risk before finishing.",
    version: "1.0.0",
    defaultEnabled: true,
    autoMountInMvp: true,
    content: REVIEW_SKILL,
  },
];

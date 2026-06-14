# Common Workflows

This page describes practical ways to use Coder Studio after the first launch.

## Run An AI Task On Desktop And Check It From Phone

1. Start Coder Studio on your computer.
2. Open a workspace.
3. Start an agent session. For a first trial, Claude or Codex is the recommended path.
4. Give the agent a task.
5. Open the same Coder Studio URL from your phone.
6. Check session output, files, Git changes, and terminal state.

For remote access setup, see [Mobile and Remote Access](Mobile-and-Remote-Access.md).

## Vibe Code With A Visible Verification Loop

1. Start an agent session.
2. Describe the desired change in natural language.
3. Watch the agent's terminal output.
4. Inspect changed files and Git diffs.
5. Run tests in a shell terminal.
6. Continue prompting only after you understand the result.

This keeps vibe-coding speed inside a reviewable engineering harness.

## Use Multiple Providers Side By Side

1. Open one workspace.
2. Start one provider session for a task.
3. Start another provider session for a separate task.
4. Switch between sessions in the Agent panel.
5. Use Git diff and shell terminals to verify output.

This is useful when comparing agent behavior or splitting independent work.

## Review AI-Generated Changes

1. Let an agent finish a task.
2. Open the Git panel.
3. Review changed files.
4. Open diffs in the editor.
5. Run tests in a shell terminal.
6. Commit only after reviewing the result.

## Monitor Long-Running Work

1. Start a session with a clear task.
2. Enable Supervisor with a concrete objective.
3. Leave the task running.
4. Return later from desktop or mobile.
5. Review Supervisor state, terminal output, and Git diff.

Use Supervisor for monitoring and guidance. Keep final decisions with the human operator.

## Use A Tablet For Code Review

1. Start work on desktop.
2. Open Coder Studio from a tablet.
3. Use the larger touch screen to inspect files and diffs.
4. Leave final editing or complex terminal work to desktop if needed.

## Share A Workspace Temporarily

For a trusted demo or debugging session:

1. Set a strong Coder Studio password.
2. Use Tailscale, ngrok, or Cloudflare Tunnel.
3. Share the URL only with trusted people.
4. Stop the tunnel when finished.

Avoid exposing sensitive projects through public links.

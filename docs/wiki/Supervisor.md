# Supervisor

Supervisor helps with long-running vibe coding work by periodically evaluating an agent session against an objective. It is meant to reduce manual babysitting, not replace review.

## What Supervisor Does

Supervisor tracks a session and asks:

- Is the agent still making progress?
- Did the work stall?
- Did the output fail or require a human decision?
- Should the session continue, pause, or surface a next step?

It is useful when a vibe coding task takes multiple turns and you do not want to watch every intermediate response.

## Good Use Cases

- Keep a long refactor moving toward a stated goal.
- Monitor a test-fix loop.
- Check whether an agent is stuck after a failed command.
- Summarize progress after a long session.
- Surface when a human decision is needed.

## Poor Use Cases

- One-off questions.
- Tasks that need immediate human judgment every step.
- Fully trusted autonomous production changes.
- Replacing code review, tests, or manual verification.

## Example Objectives

```text
Keep evaluating whether this session is moving toward fixing the failing tests.
If the agent is repeating the same failure or needs a product decision, stop and summarize what happened.
```

```text
Monitor this refactor for progress. Continue only while the changes remain behavior-preserving and relevant tests pass.
Stop if the agent starts changing unrelated modules.
```

```text
Review the current work after each turn. Summarize risks, missing tests, and whether the session should continue.
```

## How To Use It

1. Start a Claude or Codex session.
2. Open the Supervisor control for that session.
3. Write a concrete objective.
4. Choose an evaluator provider if the UI asks for one.
5. Enable Supervisor and monitor its status.

Make the objective specific. "Help with this task" is weak. "Keep this session focused on fixing the failing workspace bootstrap tests and stop if unrelated refactors appear" is stronger.

## Limitations

Supervisor is only as useful as the objective and the available context. It can still miss issues, misunderstand intent, or recommend a poor next step. Treat it as a structured assistant for monitoring progress, not an authority.

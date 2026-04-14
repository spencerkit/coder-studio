# Phase 1 E2E Subagent Runbook

## Order
1. Start local server (`pnpm dev`)
2. Run functional specs (`pnpm acceptance:phase1 --grep 'F1-'`)
3. Run visual specs (`pnpm acceptance:phase1 --grep 'V1-'`)
4. Generate report (`pnpm acceptance:phase1:report`)
5. If all checks pass, notify developer to perform manual self-verification

## Team split
- setup/runner subagent: Tasks 1-4
- functional specs subagent: Task 5
- visual specs subagent: Task 6

## Rule
Human self-verification is blocked until automated acceptance is fully green.

# Conversion-First Activation Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Help users continue from desktop to phone or remote devices without overbuilding a low-value in-app assistant.

**Decision update:** The original Mobile Access Assistant mostly displayed LAN URLs and auth warnings. That is useful, but too thin to justify a dedicated feature surface right now. The higher-value user need is a clear remote-access guide that covers LAN access, auth, Tailscale, ngrok, Cloudflare Tunnel, and troubleshooting. Treat any product UI as a lightweight documentation entry point until real usage shows that a stateful assistant is needed.

**Architecture:** Phase 3 becomes documentation-first. Keep `setup.mobileAccessStatus` available as future infrastructure, but do not add `packages/web/src/features/mobile-access/*`, workspace-shell CTA, or a new setup success assistant in this phase. The product can later add a small settings/help link to the guide if the help surface supports it.

**Tech Stack:** Markdown docs, existing help center, README links

---

## Phase Scope

**Depends on:**

- Existing help center
- Existing CLI config/status commands

**Includes master task:**

- Supersedes [Task 5](./2026-05-14-conversion-first-activation.md#task-5-add-the-mobile-access-assistant-and-continue-on-phone) for now. Do not implement the full mobile assistant until this decision is revisited.

**Exit criteria:**

- mobile guide explains LAN access from phone
- guide explains why `localhost` is not reachable from another device
- guide recommends enabling password before exposing the service
- guide covers Tailscale, ngrok, and Cloudflare Tunnel at a practical level
- README/help index points users to the guide

## Deliverables

- Update `docs/help/mobile-guide.md`
- Update `docs/help/README.md`
- Update README documentation table entries
- Keep the original in-app assistant as a deferred idea, not Phase 3 scope

## Tracking Checklist

- [x] Re-evaluate the value of a dedicated Mobile Access Assistant
- [x] Change Phase 3 to documentation-first scope
- [x] Expand the mobile guide with LAN access instructions
- [x] Add Tailscale/ngrok/Cloudflare Tunnel guidance
- [x] Add security and troubleshooting notes
- [x] Update README/help links
- [ ] Commit Phase 3 documentation changes

## Files In Play

- Modify: `docs/help/mobile-guide.md`
- Modify: `docs/help/README.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-05-14-conversion-first-activation-phase-3-mobile-continuation.md`

## Verification

No code tests are required for this documentation-only phase. Verify the Markdown renders and the links point to the intended local docs and official tunnel-provider docs.

## Watchouts

- Do not reintroduce a workspace-shell `Continue on Phone` CTA without evidence that users need it.
- Do not encourage direct public port exposure.
- Keep third-party tunnel instructions practical but not exhaustive; link official docs for provider-specific details.
- If a future in-app assistant is revived, it should do more than static information display: status-aware diagnostics, copy actions, QR, and next-step fixes.

## Detailed Execution Source

The master plan Task 5 is intentionally superseded for this phase:

- [Task 5 detailed steps](./2026-05-14-conversion-first-activation.md#task-5-add-the-mobile-access-assistant-and-continue-on-phone)

## Suggested Commit Boundary

```bash
git commit -m "docs: add mobile remote access guide"
```

# Appearance Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-synced appearance personalization with shared-plus-device-override settings for background images and glass/material controls, plus runtime application across desktop and mobile shells.

**Architecture:** Extend the existing `appearance.*` settings contract with a new `appearance.personalization` subtree, hydrate it into a dedicated in-memory Web atom, resolve effective desktop/mobile values at runtime, and apply those values as document/shell CSS variables. Add a dedicated authenticated appearance asset route instead of reusing workspace uploads, then wire the appearance settings page, shared surface styles, and UI preview scenes around that model.

**Tech Stack:** React 19, TypeScript, Jotai, Fastify, Zod, existing websocket `settings.get/settings.update` flow, existing authenticated HTTP route pattern, Vitest, UI preview scene harness.

**Spec reference:** `docs/superpowers/specs/2026-05-21-appearance-personalization-design.md`

---

## File Structure

**New files:**
- `packages/web/src/appearance/personalization.ts`
- `packages/web/src/appearance/personalization.test.ts`
- `packages/web/src/appearance/assets.ts`
- `packages/web/src/appearance/assets.test.ts`
- `packages/server/src/routes/appearance-assets.ts`
- `packages/server/src/routes/appearance-assets.test.ts`
- `packages/server/src/storage/repositories/appearance-asset-repo.ts`
- `packages/server/src/storage/repositories/appearance-asset-repo.test.ts`
- `packages/web/src/appearance/index.ts`

**Modified files:**
- `packages/server/src/commands/settings.ts`
- `packages/server/src/commands/settings.test.ts`
- `packages/server/src/app.ts`
- `packages/server/src/server.ts`
- `packages/web/src/atoms/app-ui.ts`
- `packages/web/src/atoms/index.ts`
- `packages/web/src/app/providers.tsx`
- `packages/web/src/app/providers.lifecycle.test.tsx`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/styles/base.css`
- `packages/web/src/styles/base.theme.test.ts`
- `packages/web/src/styles/components.css`
- `packages/web/src/styles/components.theme.test.ts`
- `packages/web/src/locales/en.json`
- `packages/web/src/locales/zh.json`
- `packages/web/src/ui-preview/preview-store.ts`
- `packages/web/src/ui-preview/scenes/page-scenes.tsx`
- `packages/web/src/ui-preview/scene-metadata.ts`
- `packages/web/src/ui-preview/scene-metadata.test.ts`

**Likely no changes in this plan:**
- `packages/web/src/theme/registry.ts`
- `packages/web/src/theme/resolve.ts`
- `packages/web/src/features/terminal-panel/preferences.ts`
- `packages/server/src/routes/uploads.ts`

**Boundary decisions locked in by this plan:**
- The source of truth for personalization is the server-backed `appearance.*` settings tree, not localStorage.
- The Web client still keeps a live in-memory atom for immediate rendering and optimistic UI.
- The background asset route returns `assetId`, `url`, `mime`, and `size`; image dimensions are not parsed on the server in phase 1 because the repo has no existing image-size dependency.
- The route stores assets under a service-instance-scoped appearance bucket. This preserves the spec’s explicit “single user / single subject” assumption without pretending to be fully user-scoped.

## Task 1: Add The Server-Side Personalization Settings Contract

**Files:**
- Create: `packages/web/src/appearance/personalization.ts`
- Create: `packages/web/src/appearance/personalization.test.ts`
- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/settings.test.ts`
- Modify: `packages/web/src/atoms/app-ui.ts`
- Modify: `packages/web/src/atoms/index.ts`
- Test: `packages/server/src/commands/settings.test.ts`
- Test: `packages/web/src/appearance/personalization.test.ts`

- [ ] **Step 1: Write the failing normalization and settings-schema tests**

Create `packages/web/src/appearance/personalization.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE_PERSONALIZATION,
  resolveAppearancePersonalizationSetting,
  resolveAppearancePersonalizationForViewport,
} from "./personalization";

describe("appearance personalization", () => {
  it("falls back to the default contract when settings omit personalization", () => {
    expect(resolveAppearancePersonalizationSetting({})).toEqual(
      DEFAULT_APPEARANCE_PERSONALIZATION
    );
  });

  it("ignores invalid numeric and enum values from server settings", () => {
    expect(
      resolveAppearancePersonalizationSetting({
        "appearance.personalization.common.backgroundMode": "video",
        "appearance.personalization.common.backgroundBlur": 99,
        "appearance.personalization.common.surfaceOpacity": -1,
      })
    ).toEqual(DEFAULT_APPEARANCE_PERSONALIZATION);
  });

  it("merges common values with desktop overrides only for the supported fields", () => {
    const personalization = resolveAppearancePersonalizationSetting({
      "appearance.personalization.common.backgroundMode": "image",
      "appearance.personalization.common.backgroundAssetId": "asset-common",
      "appearance.personalization.common.glassEnabled": false,
      "appearance.personalization.desktop.backgroundAssetId": "asset-desktop",
      "appearance.personalization.desktop.glassEnabled": true,
    });

    expect(resolveAppearancePersonalizationForViewport(personalization, "desktop")).toMatchObject({
      backgroundMode: "image",
      backgroundAssetId: "asset-desktop",
      glassEnabled: true,
    });
    expect(resolveAppearancePersonalizationForViewport(personalization, "mobile")).toMatchObject({
      backgroundMode: "image",
      backgroundAssetId: "asset-common",
      glassEnabled: false,
    });
  });
});
```

Add these tests to `packages/server/src/commands/settings.test.ts`:

```ts
it("settings.update persists appearance.personalization common and device override keys", async () => {
  expect(true).toBe(false);
});

it("settings.update rejects appearance.personalization values outside the supported ranges", async () => {
  expect(true).toBe(false);
});

it("settings.get returns persisted appearance.personalization keys unchanged", async () => {
  expect(true).toBe(false);
});
```

- [ ] **Step 2: Run the focused schema tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts
pnpm --filter @coder-studio/web exec vitest run src/appearance/personalization.test.ts
```

Expected:
- FAIL because `appearance.personalization` is not defined in the server schema
- FAIL because the Web normalization module does not exist yet

- [ ] **Step 3: Implement the shared personalization model and Web-side resolvers**

Create `packages/web/src/appearance/personalization.ts` with:

```ts
export type AppearanceViewport = "desktop" | "mobile";
export type AppearanceBackgroundMode = "none" | "image";
export type AppearanceBackgroundFit = "cover" | "contain";

export interface AppearancePersonalizationCommon {
  backgroundMode: AppearanceBackgroundMode;
  backgroundAssetId: string | null;
  backgroundFit: AppearanceBackgroundFit;
  backgroundDimness: number;
  backgroundBlur: number;
  glassEnabled: boolean;
  glassIntensity: number;
  surfaceOpacity: number;
}

export interface AppearancePersonalizationOverrides {
  backgroundAssetId?: string | null;
  backgroundDimness?: number;
  backgroundBlur?: number;
  glassEnabled?: boolean;
  glassIntensity?: number;
  surfaceOpacity?: number;
}

export interface AppearancePersonalization {
  version: 1;
  common: AppearancePersonalizationCommon;
  desktop: AppearancePersonalizationOverrides;
  mobile: AppearancePersonalizationOverrides;
}

export const DEFAULT_APPEARANCE_PERSONALIZATION: AppearancePersonalization = {
  version: 1,
  common: {
    backgroundMode: "none",
    backgroundAssetId: null,
    backgroundFit: "cover",
    backgroundDimness: 24,
    backgroundBlur: 0,
    glassEnabled: false,
    glassIntensity: 24,
    surfaceOpacity: 96,
  },
  desktop: {},
  mobile: {},
};
```

Also implement:

```ts
export function resolveAppearancePersonalizationSetting(
  settings: Record<string, unknown>
): AppearancePersonalization;

export function resolveAppearancePersonalizationForViewport(
  personalization: AppearancePersonalization,
  viewport: AppearanceViewport
): AppearancePersonalizationCommon;
```

In `packages/web/src/atoms/app-ui.ts`, add:

```ts
import type { AppearancePersonalization } from "../appearance";
import { DEFAULT_APPEARANCE_PERSONALIZATION } from "../appearance";

export const appearancePersonalizationAtom = atom<AppearancePersonalization>(
  DEFAULT_APPEARANCE_PERSONALIZATION
);
```

Export the new atom through `packages/web/src/atoms/index.ts` and add an `index.ts` barrel for `packages/web/src/appearance`.

- [ ] **Step 4: Extend the server settings schema and persistence tests**

In `packages/server/src/commands/settings.ts`, add:

```ts
const PersonalizationOverridesSchema = z.object({
  backgroundAssetId: z.string().min(1).nullable().optional(),
  backgroundDimness: z.number().int().min(0).max(100).optional(),
  backgroundBlur: z.number().int().min(0).max(40).optional(),
  glassEnabled: z.boolean().optional(),
  glassIntensity: z.number().int().min(0).max(100).optional(),
  surfaceOpacity: z.number().int().min(0).max(100).optional(),
});
```

and inside `appearance`:

```ts
personalization: z
  .object({
    version: z.literal(1).optional(),
    common: z
      .object({
        backgroundMode: z.enum(["none", "image"]).optional(),
        backgroundAssetId: z.string().min(1).nullable().optional(),
        backgroundFit: z.enum(["cover", "contain"]).optional(),
        backgroundDimness: z.number().int().min(0).max(100).optional(),
        backgroundBlur: z.number().int().min(0).max(40).optional(),
        glassEnabled: z.boolean().optional(),
        glassIntensity: z.number().int().min(0).max(100).optional(),
        surfaceOpacity: z.number().int().min(0).max(100).optional(),
      })
      .optional(),
    desktop: PersonalizationOverridesSchema.optional(),
    mobile: PersonalizationOverridesSchema.optional(),
  })
  .optional(),
```

Replace the placeholder server tests with concrete assertions like:

```ts
expect(settingsRepo.get("appearance.personalization.common.backgroundMode")).toBe("image");
expect(settingsRepo.get("appearance.personalization.desktop.glassEnabled")).toBe(true);
expect(settingsRepo.get("appearance.personalization.mobile.surfaceOpacity")).toBe(88);
```

and for the rejection case:

```ts
expect(result.ok).toBe(false);
expect(result.error?.code).toBe("validation_error");
expect(settingsRepo.get("appearance.personalization.common.backgroundBlur")).toBeUndefined();
```

- [ ] **Step 5: Re-run the focused schema tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts
pnpm --filter @coder-studio/web exec vitest run src/appearance/personalization.test.ts
```

Expected:
- PASS with the new `appearance.personalization` schema and normalization helpers covered

- [ ] **Step 6: Commit the settings-contract slice**

```bash
git add \
  packages/server/src/commands/settings.ts \
  packages/server/src/commands/settings.test.ts \
  packages/web/src/appearance/index.ts \
  packages/web/src/appearance/personalization.ts \
  packages/web/src/appearance/personalization.test.ts \
  packages/web/src/atoms/app-ui.ts \
  packages/web/src/atoms/index.ts
git commit -m "feat: add appearance personalization settings contract"
```

## Task 2: Add The Dedicated Appearance Asset Repository And Route

**Files:**
- Create: `packages/server/src/storage/repositories/appearance-asset-repo.ts`
- Create: `packages/server/src/storage/repositories/appearance-asset-repo.test.ts`
- Create: `packages/server/src/routes/appearance-assets.ts`
- Create: `packages/server/src/routes/appearance-assets.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/server.ts`
- Test: `packages/server/src/storage/repositories/appearance-asset-repo.test.ts`
- Test: `packages/server/src/routes/appearance-assets.test.ts`

- [ ] **Step 1: Write the failing repository and route tests**

Create `packages/server/src/storage/repositories/appearance-asset-repo.test.ts` with:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppearanceAssetRepo } from "./appearance-asset-repo.js";

describe("AppearanceAssetRepo", () => {
  let tempDir: string;
  let repo: AppearanceAssetRepo;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "appearance-asset-repo-"));
    repo = new AppearanceAssetRepo({ filePath: join(tempDir, "appearance-assets.json") });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores, reads, and deletes service-scoped appearance asset metadata", () => {
    expect(true).toBe(false);
  });
});
```

Create `packages/server/src/routes/appearance-assets.test.ts` with tests that assert:

```ts
it("uploads a png appearance asset and returns asset metadata", () => {
  expect(true).toBe(false);
});

it("rejects non-image appearance uploads", () => {
  expect(true).toBe(false);
});

it("serves an uploaded asset back through GET /api/appearance-assets/:assetId", () => {
  expect(true).toBe(false);
});

it("deletes an asset and removes both metadata and file contents", () => {
  expect(true).toBe(false);
});
```

- [ ] **Step 2: Run the focused appearance-asset tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/storage/repositories/appearance-asset-repo.test.ts \
  src/routes/appearance-assets.test.ts
```

Expected:
- FAIL because the repository and route do not exist

- [ ] **Step 3: Implement the appearance asset metadata repository**

Create `packages/server/src/storage/repositories/appearance-asset-repo.ts` with:

```ts
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface AppearanceAssetRecord {
  id: string;
  fileName: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  size: number;
  storagePath: string;
  createdAt: number;
}

interface AppearanceAssetFileRecord {
  version: 1;
  assets: Record<string, AppearanceAssetRecord>;
}

export class AppearanceAssetRepo {
  constructor(private readonly options: { filePath: string }) {}

  get(id: string): AppearanceAssetRecord | undefined;
  set(record: AppearanceAssetRecord): void;
  delete(id: string): void;
  list(): AppearanceAssetRecord[];
}
```

Make the repository store a flat `Record<string, AppearanceAssetRecord>` keyed by `assetId`, mirroring the style of `SettingsRepo`.

- [ ] **Step 4: Implement the authenticated appearance asset route and register it**

Create `packages/server/src/routes/appearance-assets.ts` with:

```ts
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppearanceAssetRepo } from "../storage/repositories/appearance-asset-repo.js";

const ALLOWED_APPEARANCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const APPEARANCE_ASSET_BUCKET = "appearance/default";
```

Implement:

- `POST /api/appearance-assets`
  - require multipart
  - accept a single `file` part
  - reject non-`png/jpeg/webp`
  - write to `${uploadsDir}/appearance/default/<yyyy-mm-dd>/<assetId>-<safeName>`
  - store metadata in `AppearanceAssetRepo`
  - respond with:

```ts
{
  ok: true,
  asset: {
    assetId,
    url: `/api/appearance-assets/${assetId}`,
    mime,
    size
  }
}
```

- `GET /api/appearance-assets/:assetId`
  - read metadata from the repo
  - stream the file with `Cache-Control: no-store`

- `DELETE /api/appearance-assets/:assetId`
  - remove the file and repo entry
  - return `{ ok: true }`

In `packages/server/src/server.ts`, construct:

```ts
const appearanceAssetRepo = new AppearanceAssetRepo({
  filePath: join(stateRoot, "state", "appearance-assets.json"),
});
```

Pass it through `buildFastifyApp`, then register the route in `packages/server/src/app.ts` next to the existing file and upload routes.

- [ ] **Step 5: Replace the placeholder tests with concrete route assertions**

In `packages/server/src/routes/appearance-assets.test.ts`, use the same `Fastify + multipart + app.inject + FormData` pattern as `uploads.test.ts`, and assert:

```ts
expect(res.statusCode).toBe(200);
expect(res.json().asset.mime).toBe("image/png");
expect(res.json().asset.url).toMatch(/^\/api\/appearance-assets\//);
```

For the GET assertion:

```ts
expect(getRes.statusCode).toBe(200);
expect(getRes.headers["content-type"]).toBe("image/png");
```

For the DELETE assertion:

```ts
expect(deleteRes.statusCode).toBe(200);
expect(repo.list()).toEqual([]);
```

- [ ] **Step 6: Re-run the focused appearance-asset tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/storage/repositories/appearance-asset-repo.test.ts \
  src/routes/appearance-assets.test.ts
```

Expected:
- PASS with the dedicated appearance asset storage and route fully covered

- [ ] **Step 7: Commit the asset-route slice**

```bash
git add \
  packages/server/src/storage/repositories/appearance-asset-repo.ts \
  packages/server/src/storage/repositories/appearance-asset-repo.test.ts \
  packages/server/src/routes/appearance-assets.ts \
  packages/server/src/routes/appearance-assets.test.ts \
  packages/server/src/app.ts \
  packages/server/src/server.ts
git commit -m "feat: add appearance asset upload route"
```

## Task 3: Hydrate And Apply Effective Appearance Personalization At Runtime

**Files:**
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`
- Modify: `packages/web/src/atoms/app-ui.ts`
- Modify: `packages/web/src/atoms/index.ts`
- Modify: `packages/web/src/styles/base.css`
- Modify: `packages/web/src/styles/base.theme.test.ts`
- Test: `packages/web/src/app/providers.lifecycle.test.tsx`
- Test: `packages/web/src/styles/base.theme.test.ts`

- [ ] **Step 1: Add failing lifecycle and base-style tests for personalization hydration**

Add these tests to `packages/web/src/app/providers.lifecycle.test.tsx`:

```ts
it("hydrates appearance.personalization from settings.get into the in-memory atom", async () => {
  expect(true).toBe(false);
});

it("applies effective desktop personalization as document CSS variables", async () => {
  expect(true).toBe(false);
});

it("weakens personalization when the active theme is high contrast", async () => {
  expect(true).toBe(false);
});
```

Add this test to `packages/web/src/styles/base.theme.test.ts`:

```ts
it("defines app-shell background variables and appearance-aware loading shell hooks", () => {
  expect(true).toBe(false);
});
```

- [ ] **Step 2: Run the focused lifecycle and base-style tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/app/providers.lifecycle.test.tsx \
  src/styles/base.theme.test.ts
```

Expected:
- FAIL because providers do not hydrate personalization
- FAIL because base.css does not expose the `--app-*` background/material variables

- [ ] **Step 3: Extend providers with personalization hydration and CSS-variable application**

In `packages/web/src/app/providers.tsx`, import:

```ts
import {
  appearancePersonalizationAtom,
  themeAtom,
} from "../atoms/app-ui";
import {
  DEFAULT_APPEARANCE_PERSONALIZATION,
  resolveAppearancePersonalizationForViewport,
  resolveAppearancePersonalizationSetting,
  type AppearanceViewport,
} from "../appearance";
```

Extend the version tracker:

```ts
interface AppearanceSelectionVersion {
  theme: number;
  personalization: number;
}
```

Add helpers:

```ts
function resolveCurrentAppearanceViewport(): AppearanceViewport {
  return window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop";
}

function applyAppearancePersonalizationToDocument(
  effective: ReturnType<typeof resolveAppearancePersonalizationForViewport>,
  themeId: string
) {
  const root = document.documentElement;
  const isHighContrast = themeId.startsWith("hc-");
  const glassEnabled = !isHighContrast && effective.glassEnabled;
  const clampedBlur = isHighContrast ? 0 : Math.min(effective.backgroundBlur, 24);
  const clampedOpacity = isHighContrast ? 100 : effective.surfaceOpacity;

  root.style.setProperty(
    "--app-bg-image",
    effective.backgroundMode === "image" && effective.backgroundAssetId
      ? `url(/api/appearance-assets/${effective.backgroundAssetId})`
      : "none"
  );
  root.style.setProperty("--app-bg-fit", effective.backgroundFit);
  root.style.setProperty("--app-bg-dim", `${effective.backgroundDimness / 100}`);
  root.style.setProperty("--app-bg-blur", `${clampedBlur}px`);
  root.style.setProperty("--app-surface-opacity", `${clampedOpacity / 100}`);
  root.style.setProperty(
    "--app-surface-backdrop-filter",
    glassEnabled ? `blur(${Math.max(0, Math.min(effective.glassIntensity, 40))}px)` : "none"
  );
  root.setAttribute("data-appearance-glass", glassEnabled ? "on" : "off");
}
```

Hydrate in the existing `settings.get` flow:

```ts
const resolvedPersonalization = resolveAppearancePersonalizationSetting(settings);
store.set(appearancePersonalizationAtom, resolvedPersonalization);
applyAppearancePersonalizationToDocument(
  resolveAppearancePersonalizationForViewport(
    resolvedPersonalization,
    resolveCurrentAppearanceViewport()
  ),
  store.get(themeAtom)
);
```

Also subscribe to both `themeAtom` and `appearancePersonalizationAtom` so changes re-apply CSS variables after user edits.

- [ ] **Step 4: Add the shell-level background/material variables in base.css**

In `packages/web/src/styles/base.css`, add root-level defaults:

```css
body {
  background-color: var(--bg-page);
  background-image: none;
}

.app {
  position: relative;
  display: flex;
  min-height: 100dvh;
  flex-direction: column;
  background: var(--surface-page-bg);
  isolation: isolate;
}

.app::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -2;
  background-image: var(--app-bg-image, none);
  background-position: center;
  background-repeat: no-repeat;
  background-size: var(--app-bg-fit, cover);
  filter: blur(var(--app-bg-blur, 0px));
  transform: scale(1.04);
  pointer-events: none;
}

.app::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background: color-mix(in srgb, var(--surface-page-bg) calc(var(--app-bg-dim, 0) * 100%), transparent);
  pointer-events: none;
}

.app-loading-shell {
  background: color-mix(
    in srgb,
    var(--surface-page-bg) calc(var(--app-surface-opacity, 0.96) * 100%),
    transparent
  );
  backdrop-filter: var(--app-surface-backdrop-filter, none);
}
```

Also update the new base theme test to assert the presence of `--app-bg-image`, `--app-bg-blur`, and `backdrop-filter: var(--app-surface-backdrop-filter`.

- [ ] **Step 5: Re-run the focused lifecycle and base-style tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/app/providers.lifecycle.test.tsx \
  src/styles/base.theme.test.ts
```

Expected:
- PASS with server hydration and document variable application covered

- [ ] **Step 6: Commit the runtime-hydration slice**

```bash
git add \
  packages/web/src/app/providers.tsx \
  packages/web/src/app/providers.lifecycle.test.tsx \
  packages/web/src/atoms/app-ui.ts \
  packages/web/src/atoms/index.ts \
  packages/web/src/styles/base.css \
  packages/web/src/styles/base.theme.test.ts
git commit -m "feat: hydrate appearance personalization at runtime"
```

## Task 4: Build The Appearance Settings UI And Asset Client

**Files:**
- Create: `packages/web/src/appearance/assets.ts`
- Create: `packages/web/src/appearance/assets.test.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Test: `packages/web/src/appearance/assets.test.ts`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`

- [ ] **Step 1: Add failing asset-client and settings-page tests**

Create `packages/web/src/appearance/assets.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAppearanceAsset, uploadAppearanceAsset } from "./assets";

describe("appearance asset client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads a file to /api/appearance-assets and returns the server asset payload", async () => {
    expect(true).toBe(false);
  });

  it("throws a typed error when the upload fails", async () => {
    expect(true).toBe(false);
  });
});
```

Add these tests to `packages/web/src/features/settings/components/settings-page.test.tsx`:

```ts
it("hydrates appearance personalization controls from settings.get", async () => {
  expect(true).toBe(false);
});

it("saves shared glass and surface settings through settings.update", async () => {
  expect(true).toBe(false);
});

it("reveals device override controls only when the override switch is enabled", async () => {
  expect(true).toBe(false);
});

it("uploads a background image and persists the returned assetId", async () => {
  expect(true).toBe(false);
});

it("removes the persisted background asset when the user clears the background", async () => {
  expect(true).toBe(false);
});
```

- [ ] **Step 2: Run the focused settings and asset-client tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/appearance/assets.test.ts \
  src/features/settings/components/settings-page.test.tsx
```

Expected:
- FAIL because the client helper does not exist
- FAIL because the appearance page still only exposes theme, locale, and terminal font size

- [ ] **Step 3: Implement the asset client helper**

Create `packages/web/src/appearance/assets.ts` with:

```ts
export interface AppearanceAssetPayload {
  assetId: string;
  url: string;
  mime: string;
  size: number;
}

export class AppearanceAssetError extends Error {
  override name = "AppearanceAssetError";

  constructor(
    readonly code: string,
    readonly status: number,
    message?: string
  ) {
    super(message ?? code);
  }
}

export async function uploadAppearanceAsset(file: File): Promise<AppearanceAssetPayload> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/appearance-assets", { method: "POST", body: form });
  const body = (await response.json()) as {
    ok?: boolean;
    asset?: AppearanceAssetPayload;
    error?: string;
  };
  if (!response.ok || !body.ok || !body.asset) {
    throw new AppearanceAssetError(body.error ?? `http_${response.status}`, response.status);
  }
  return body.asset;
}

export async function deleteAppearanceAsset(assetId: string): Promise<void> {
  const response = await fetch(`/api/appearance-assets/${assetId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new AppearanceAssetError(`http_${response.status}`, response.status);
  }
}
```

- [ ] **Step 4: Extend AppearanceSettings with shared controls, override toggles, and upload flow**

In `packages/web/src/features/settings/components/settings-page.tsx`:

1. Extend the page state with:

```ts
const [personalization, setPersonalization] = useAtom(appearancePersonalizationAtom);
```

2. Extend `appearanceSelectionVersionRef` with:

```ts
personalization: 0,
```

3. Hydrate from `settings.get` using:

```ts
const resolvedPersonalization = resolveAppearancePersonalizationSetting(settings);
if (
  appearanceSelectionVersionRef.current.personalization ===
  appearanceSelectionVersionAtRequestStart.personalization
) {
  setPersonalization(resolvedPersonalization);
}
```

4. Expand `AppearanceSettingsProps` with:

```ts
personalization: AppearancePersonalization;
setPersonalization: (value: AppearancePersonalization) => void;
```

5. Add a local save helper:

```ts
const savePersonalization = async (next: AppearancePersonalization) => {
  setPersonalization(next);
  appearanceSelectionVersionRef.current.personalization += 1;
  await dispatch("settings.update", {
    settings: {
      appearance: {
        personalization: next,
      },
    },
  });
};
```

6. Render these controls:
- `Select` for background mode
- hidden `input[type="file"]` for uploads
- `Button` actions for upload/replace/remove
- `Input type="number"` for dimness, blur, glass intensity, surface opacity
- `Switch` for glass enabled
- `Switch` pairs for `Override desktop` and `Override mobile`

Use helper updaters like:

```ts
function updateCommon<K extends keyof AppearancePersonalization["common"]>(
  key: K,
  value: AppearancePersonalization["common"][K]
) {
  return {
    ...personalization,
    common: {
      ...personalization.common,
      [key]: value,
    },
  };
}
```

and:

```ts
function updateOverride(
  target: "desktop" | "mobile",
  key: keyof AppearancePersonalization["desktop"],
  value: string | number | boolean | null | undefined
) {
  return {
    ...personalization,
    [target]: {
      ...personalization[target],
      [key]: value,
    },
  };
}
```

7. On successful upload:

```ts
const uploaded = await uploadAppearanceAsset(file);
await savePersonalization(
  updateCommon("backgroundAssetId", uploaded.assetId)
);
```

8. On remove:

```ts
if (personalization.common.backgroundAssetId) {
  await deleteAppearanceAsset(personalization.common.backgroundAssetId);
}
await savePersonalization(
  updateCommon("backgroundAssetId", null)
);
```

- [ ] **Step 5: Add the required localization keys**

In `packages/web/src/locales/en.json`, add:

```json
"appearance_background_material": "Background & Material",
"appearance_background_mode": "Background",
"appearance_background_mode_off": "Off",
"appearance_background_mode_image": "Image",
"appearance_background_upload": "Upload image",
"appearance_background_replace": "Replace image",
"appearance_background_remove": "Remove image",
"appearance_background_fit": "Image fit",
"appearance_background_fit_cover": "Cover",
"appearance_background_fit_contain": "Contain",
"appearance_background_dimness": "Background dimness",
"appearance_background_blur": "Background blur",
"appearance_glass_enabled": "Enable glass",
"appearance_glass_intensity": "Glass intensity",
"appearance_surface_opacity": "Surface opacity",
"appearance_override_desktop": "Override desktop",
"appearance_override_mobile": "Override mobile",
"appearance_uses_shared_value": "Using shared value",
"appearance_asset_upload_failed": "Background upload failed"
```

Mirror the Chinese translations in `packages/web/src/locales/zh.json`.

- [ ] **Step 6: Re-run the focused settings and asset-client tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/appearance/assets.test.ts \
  src/features/settings/components/settings-page.test.tsx
```

Expected:
- PASS with upload, remove, shared settings, and override toggles covered

- [ ] **Step 7: Commit the settings-UI slice**

```bash
git add \
  packages/web/src/appearance/assets.ts \
  packages/web/src/appearance/assets.test.ts \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: add appearance personalization settings UI"
```

## Task 5: Apply Material Styling To Shared Surfaces And Add Preview Coverage

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`
- Modify: `packages/web/src/ui-preview/preview-store.ts`
- Modify: `packages/web/src/ui-preview/scenes/page-scenes.tsx`
- Modify: `packages/web/src/ui-preview/scene-metadata.ts`
- Modify: `packages/web/src/ui-preview/scene-metadata.test.ts`
- Test: `packages/web/src/styles/components.theme.test.ts`
- Test: `packages/web/src/ui-preview/scene-metadata.test.ts`

- [ ] **Step 1: Add failing shared-surface and preview-scene tests**

Add these tests to `packages/web/src/styles/components.theme.test.ts`:

```ts
it("routes settings and workspace shared surfaces through appearance-aware background tokens", () => {
  expect(true).toBe(false);
});

it("keeps workbench backdrops and overlay cards on fallback-safe backdrop filters", () => {
  expect(true).toBe(false);
});
```

Add this test to `packages/web/src/ui-preview/scene-metadata.test.ts`:

```ts
it("registers appearance review coverage for both route-backed settings and workspace shells", () => {
  expect(true).toBe(false);
});
```

- [ ] **Step 2: Run the focused style and preview tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/components.theme.test.ts \
  src/ui-preview/scene-metadata.test.ts
```

Expected:
- FAIL because the current surfaces still use raw theme surfaces without the new appearance overlay variables
- FAIL because there are no personalization-specific preview cases in metadata

- [ ] **Step 3: Make shared surfaces and governed overlays consume the appearance variables**

In `packages/web/src/styles/components.css`, update:

```css
.settings-content {
  background: color-mix(
    in srgb,
    var(--surface-page-bg) calc(var(--app-surface-opacity, 0.96) * 100%),
    transparent
  );
}

.settings-content-surface,
.session-card,
.workspace-bottom-panel > .bottom-terminal,
.workspace-sidebar-panel,
.app-topbar {
  background: color-mix(
    in srgb,
    var(--surface-overlay-bg) calc(var(--app-surface-opacity, 0.96) * 100%),
    transparent
  );
  backdrop-filter: var(--app-surface-backdrop-filter, none);
}
```

Keep the fallback-safe behavior explicit for governed overlays by updating:

- `packages/web/src/components/ui/workbench-layer/index.module.css`
- or, if you want to keep the primitive untouched, assert the shared appearance vars through the existing `color-mix` and `backdrop-filter` rules in `components.css`

The key contract is:
- no dark-only hardcoded RGBA glass colors
- `backdrop-filter` always has a `none` fallback path
- high contrast remains controlled by the provider-applied variables from Task 3

- [ ] **Step 4: Seed UI preview with appearance personalization data and add a concrete review scene**

In `packages/web/src/ui-preview/scenes/page-scenes.tsx`, extend `buildSettingsSeed` and `buildWorkspaceSeed` with:

```ts
"appearance.personalization.version": 1,
"appearance.personalization.common.backgroundMode": "image",
"appearance.personalization.common.backgroundAssetId": "preview-background",
"appearance.personalization.common.backgroundFit": "cover",
"appearance.personalization.common.backgroundDimness": 36,
"appearance.personalization.common.backgroundBlur": 8,
"appearance.personalization.common.glassEnabled": true,
"appearance.personalization.common.glassIntensity": 18,
"appearance.personalization.common.surfaceOpacity": 90,
"appearance.personalization.mobile.surfaceOpacity": 96,
```

In `packages/web/src/ui-preview/preview-store.ts`, mock the asset route behavior for preview by ensuring the document can resolve:

```ts
window.document.documentElement.style.setProperty(
  "--app-bg-image",
  "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...)"
);
```

If you prefer not to touch runtime preview injection, keep the scene metadata and seed focused on the settings state only, and add one metadata assertion that `settings-appearance` stays route-backed with deterministic personalization settings.

At minimum, update `packages/web/src/ui-preview/scene-metadata.test.ts` to assert:

```ts
expect(UI_PREVIEW_SCENE_METADATA.map((scene) => scene.id)).toEqual(
  expect.arrayContaining(["settings-appearance", "workspace-desktop", "workspace-mobile"])
);
```

and add a new metadata description that calls out appearance-personalization coverage.

- [ ] **Step 5: Re-run the focused style and preview tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/components.theme.test.ts \
  src/ui-preview/scene-metadata.test.ts
```

Expected:
- PASS with shared-surface styling and preview coverage assertions updated

- [ ] **Step 6: Run the final cross-slice verification set**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/commands/settings.test.ts \
  src/storage/repositories/appearance-asset-repo.test.ts \
  src/routes/appearance-assets.test.ts

pnpm --filter @coder-studio/web exec vitest run \
  src/appearance/personalization.test.ts \
  src/appearance/assets.test.ts \
  src/app/providers.lifecycle.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/styles/base.theme.test.ts \
  src/styles/components.theme.test.ts \
  src/ui-preview/scene-metadata.test.ts
```

Expected:
- PASS across settings schema, appearance asset route, runtime hydration, settings UI, and style/preview coverage

- [ ] **Step 7: Commit the styling-and-verification slice**

```bash
git add \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/ui-preview/preview-store.ts \
  packages/web/src/ui-preview/scenes/page-scenes.tsx \
  packages/web/src/ui-preview/scene-metadata.ts \
  packages/web/src/ui-preview/scene-metadata.test.ts
git commit -m "feat: apply appearance personalization to shared surfaces"
```

## Self-Review Notes

Spec coverage checklist:

- `appearance.personalization` config model: Task 1
- dedicated appearance asset route: Task 2
- runtime effective desktop/mobile resolution and CSS variables: Task 3
- settings page shared-plus-override interaction: Task 4
- shared surface styling, high-contrast weakening, preview/test coverage: Task 5

Intentional phase-1 simplifications retained in the plan:

- service-instance-scoped assets instead of true user-scoped ownership
- route payload returns `assetId/url/mime/size` only, not server-parsed dimensions
- `backgroundMode` and `backgroundFit` remain shared rather than per-device

No-placeholder scan:

- No `TODO` / `TBD` placeholders left
- Every task includes concrete file paths, test commands, and implementation snippets
- Property names are kept consistent across tasks: `appearance.personalization`, `backgroundAssetId`, `glassEnabled`, `surfaceOpacity`

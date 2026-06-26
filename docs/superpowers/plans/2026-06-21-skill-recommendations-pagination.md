# Skill Recommendations Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add true paginated skill recommendations with a default first page of 20 results and automatic next-page loading when the recommendations footer enters the workspace sidebar scroll viewport.

**Architecture:** Extend the shared skill recommendation contract to return a paginated page object, update the server recommendation command to slice a fully ranked recommendation set by `offset` and `limit`, and teach the web skills panel to manage first-page and next-page loading separately while observing a bottom sentinel inside the existing sidebar scroll container.

**Tech Stack:** TypeScript, Zod, React 19, Jotai, Vitest, Testing Library

---

### Task 1: Add Shared Recommendation Page Types

**Files:**
- Modify: `packages/core/src/domain/skill-management.ts`
- Modify: `packages/core/src/domain/skill-management.test.ts`
- Test: `packages/core/src/domain/skill-management.test.ts`

- [ ] **Step 1: Write the failing shared-type test**

Add a new shape assertion beside the existing recommendation entry test:

```ts
  it("exports a stable skill recommendation page shape", () => {
    const page: SkillRecommendationPage = {
      entries: [
        {
          slug: "code-review",
          displayName: "Code Review",
          description: "Reviews code changes",
          reason: "Matches the workspace test workflow",
          sourceQuery: "test workflow",
          score: 42,
          installed: false,
        },
      ],
      hasMore: true,
    };

    expect(page.entries[0]?.slug).toBe("code-review");
    expect(page.hasMore).toBe(true);
  });
```

- [ ] **Step 2: Run the core test to verify it fails**

Run: `pnpm --filter @coder-studio/core test -- packages/core/src/domain/skill-management.test.ts`

Expected: FAIL because `SkillRecommendationPage` does not exist yet.

- [ ] **Step 3: Add the minimal shared type**

Update `packages/core/src/domain/skill-management.ts` with:

```ts
export interface SkillRecommendationPage {
  entries: SkillRecommendationEntry[];
  hasMore: boolean;
}
```

Place it immediately after `SkillRecommendationEntry` so the related contract stays grouped.

- [ ] **Step 4: Run the core test to verify it passes**

Run: `pnpm --filter @coder-studio/core test -- packages/core/src/domain/skill-management.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/skill-management.ts packages/core/src/domain/skill-management.test.ts
git commit -m "test: add shared skill recommendation page contract"
```

### Task 2: Add Server Pagination Contract and Command Behavior

**Files:**
- Modify: `packages/server/src/commands/skills/query.ts`
- Modify: `packages/server/src/skills/recommendation.ts`
- Modify: `packages/server/src/__tests__/skills/commands.test.ts`
- Test: `packages/server/src/__tests__/skills/commands.test.ts`

- [ ] **Step 1: Write the failing server pagination test**

Replace the existing recommend assertion in `packages/server/src/__tests__/skills/commands.test.ts` with a page-shaped expectation and add a second pagination test. Use concrete data so the command behavior is explicit:

```ts
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        entries: [
          expect.objectContaining({
            slug: "vite-testing",
            installed: false,
            reason: expect.any(String),
            sourceQuery: expect.any(String),
          }),
        ],
        hasMore: false,
      });
```

Add a new test for offset slicing:

```ts
  it("returns paginated recommendations with hasMore", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "skills-recommend-page-"));
    try {
      await writeFile(
        join(workspaceRoot, "package.json"),
        JSON.stringify(
          {
            dependencies: { react: "^19.0.0" },
            scripts: { test: "vitest run" },
          },
          null,
          2
        )
      );

      const ctx = createBaseContext({
        workspaceMgr: {
          get: vi.fn(() => ({ id: "ws-1", path: workspaceRoot })),
        } as never,
        skillLibraryRepo: { get: vi.fn(() => undefined) } as never,
        skillMountRepo: { listBySkillSlug: vi.fn(() => []) } as never,
        skillsHubClient: {
          search: vi.fn(async (query: string) =>
            query.includes("React")
              ? [
                  { slug: "skill-a", displayName: "Skill A", description: "A" },
                  { slug: "skill-b", displayName: "Skill B", description: "B" },
                  { slug: "skill-c", displayName: "Skill C", description: "C" },
                ]
              : []
          ),
        } as never,
      });

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-recommend-page-1",
          op: "skills.recommend",
          args: { workspaceId: "ws-1", limit: 2, offset: 1 },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        entries: [
          expect.objectContaining({ slug: "skill-b" }),
          expect.objectContaining({ slug: "skill-c" }),
        ],
        hasMore: false,
      });
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run the server test to verify it fails**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/skills/commands.test.ts`

Expected: FAIL because `skills.recommend` still returns an array and does not accept `offset`.

- [ ] **Step 3: Add paginated recommendation builder output**

Refactor `packages/server/src/skills/recommendation.ts` minimally:

1. Introduce a new default page size constant:

```ts
const DEFAULT_RECOMMENDATION_LIMIT = 20;
```

2. Split the current builder into:

```ts
export async function buildSkillRecommendationEntries(input: {
  intelligence: WorkspaceIntelligenceSummary;
  search: (query: string) => Promise<SkillRecommendationSearchResult[]>;
  isInstalled: (slug: string) => boolean;
}): Promise<SkillRecommendationEntry[]> { ... }

export async function buildSkillRecommendations(input: {
  intelligence: WorkspaceIntelligenceSummary;
  search: (query: string) => Promise<SkillRecommendationSearchResult[]>;
  isInstalled: (slug: string) => boolean;
  limit?: number;
  offset?: number;
}): Promise<SkillRecommendationPage> {
  const entries = await buildSkillRecommendationEntries(input);
  const offset = input.offset ?? 0;
  const limit = input.limit ?? DEFAULT_RECOMMENDATION_LIMIT;
  const pageEntries = entries.slice(offset, offset + limit);

  return {
    entries: pageEntries,
    hasMore: offset + pageEntries.length < entries.length,
  };
}
```

3. Keep the current sort and score logic inside `buildSkillRecommendationEntries()` unchanged.

- [ ] **Step 4: Update the command schema and return shape**

Update `packages/server/src/commands/skills/query.ts`:

```ts
    z.object({
      workspaceId: z.string().trim().min(1),
      limit: z.number().int().positive().max(20).optional(),
      offset: z.number().int().min(0).optional(),
    }),
```

and pass both values through:

```ts
      return buildSkillRecommendations({
        intelligence,
        search: (query) => ctx.skillsHubClient.search(query),
        isInstalled: (slug) => Boolean(ctx.skillLibraryRepo.get(slug)),
        limit: args.limit,
        offset: args.offset,
      });
```

- [ ] **Step 5: Run the server test to verify it passes**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/skills/commands.test.ts`

Expected: PASS with page-shaped `skills.recommend` responses.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/commands/skills/query.ts packages/server/src/skills/recommendation.ts packages/server/src/__tests__/skills/commands.test.ts
git commit -m "feat: paginate skill recommendations on the server"
```

### Task 3: Update Preview Store and Consumer Types for Paginated Recommendations

**Files:**
- Modify: `packages/web/src/ui-preview/preview-store.ts`
- Modify: `packages/web/src/features/workspace/actions/use-skills-panel.ts`
- Test: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

- [ ] **Step 1: Write the failing web request-shape test**

Update the existing expectations in `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx` so the first recommendation request expects pagination args:

```ts
    expect(sendCommand).toHaveBeenCalledWith(
      "skills.recommend",
      { workspaceId: "ws-1", limit: 20, offset: 0 },
      undefined
    );
```

Also change the mock result shape used by recommendation tests to:

```ts
      if (op === "skills.recommend") {
        return {
          entries: [
            {
              slug: "vite-testing",
              displayName: "Vite Testing",
              description: "Testing Vite apps with a description long enough that it should be constrained to a single visible line.",
              reason: "Matches Vite and test scripts with a reason long enough that it should use the same one-line presentation.",
              sourceQuery: "Vite",
              score: 10,
              installed: false,
            },
          ],
          hasMore: false,
        };
      }
```

- [ ] **Step 2: Run the web test to verify it fails**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

Expected: FAIL because the panel still requests `{ workspaceId }` and expects an array result.

- [ ] **Step 3: Add the paginated preview command shape**

Update `packages/web/src/ui-preview/preview-store.ts` imports and command typing:

```ts
  SkillRecommendationPage,
```

```ts
  skillsRecommendations?: SkillRecommendationPage;
```

Update the command handler:

```ts
    if (op === "skills.recommend") {
      return ok(
        (commands.skillsRecommendations ?? { entries: [], hasMore: false }) as unknown as T
      );
    }
```

This keeps preview mode compatible after the shared contract changes.

- [ ] **Step 4: Update `useSkillsPanel` to request the first page contract**

At the top of `packages/web/src/features/workspace/actions/use-skills-panel.ts`, switch the recommendation import to:

```ts
  type SkillRecommendationEntry,
  type SkillRecommendationPage,
```

Then update the first-page fetch path in `refreshRecommendations()` to:

```ts
    const result = await dispatch<SkillRecommendationPage>("skills.recommend", {
      workspaceId,
      limit: 20,
      offset: 0,
    });
```

and set:

```ts
    setRecommendations(result.data.entries);
```

This step only handles the first-page contract change; next-page behavior is added in Task 4.

- [ ] **Step 5: Run the web test to verify it passes**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

Expected: PASS for the updated request and paginated first-page handling.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/ui-preview/preview-store.ts packages/web/src/features/workspace/actions/use-skills-panel.ts packages/web/src/features/workspace/views/shared/skills-panel.test.tsx
git commit -m "refactor: consume paginated skill recommendation responses"
```

### Task 4: Add Recommendation Pagination State and Refresh Semantics

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-skills-panel.ts`
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

- [ ] **Step 1: Write the failing refresh and append tests**

Add two tests to `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`.

First, append behavior with duplicate filtering:

```ts
  it("appends the next recommendation page without duplicating slugs", async () => {
    const originalIntersectionObserver = global.IntersectionObserver;
    const instances: Array<{ callback: IntersectionObserverCallback }> = [];

    class IntersectionObserverMock {
      readonly observe = vi.fn();
      readonly unobserve = vi.fn();
      readonly disconnect = vi.fn();

      constructor(callback: IntersectionObserverCallback) {
        instances.push({ callback });
      }

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    global.IntersectionObserver =
      IntersectionObserverMock as unknown as typeof IntersectionObserver;

    const sendCommand = vi
      .fn()
      .mockImplementationOnce(async (op: string) => {
        if (op === "skills.library.list") return [];
        if (op === "skills.health.scan") return { targets: [], mounts: [] };
        if (op === "skills.recommend") {
          return {
            entries: Array.from({ length: 20 }, (_, index) => ({
              slug: `skill-${index + 1}`,
              displayName: `Skill ${index + 1}`,
              reason: "reason",
              sourceQuery: "React",
              score: 100 - index,
              installed: false,
            })),
            hasMore: true,
          };
        }
        return [];
      })
      .mockImplementationOnce(async (op: string, args?: { offset?: number }) => {
        if (op === "skills.recommend") {
          expect(args).toMatchObject({ workspaceId: "ws-1", limit: 20, offset: 20 });
          return {
            entries: [
              {
                slug: "skill-20",
                displayName: "Skill 20",
                reason: "reason",
                sourceQuery: "React",
                score: 80,
                installed: false,
              },
              {
                slug: "skill-21",
                displayName: "Skill 21",
                reason: "reason",
                sourceQuery: "React",
                score: 79,
                installed: false,
              },
            ],
            hasMore: false,
          };
        }
        if (op === "skills.library.list") return [];
        if (op === "skills.health.scan") return { targets: [], mounts: [] };
        return [];
      });

    renderPanel(sendCommand);
    await screen.findByText("Skill 20");

    await waitFor(() => expect(instances.length).toBeGreaterThan(0));
    await waitFor(() => {
      instances[0]?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
      expect(screen.getByText("Skill 21")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Skill 20")).toHaveLength(1);
    global.IntersectionObserver = originalIntersectionObserver;
  });
```

Second, refresh reset behavior:

```ts
  it("reloads recommendations from the first page when the panel refresh token changes", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") return [];
      if (op === "skills.health.scan") return { targets: [], mounts: [] };
      if (op === "skills.recommend") {
        return { entries: [], hasMore: false };
      }
      return [];
    });

    const { rerender, store } = renderPanelWithProps(sendCommand, 0);

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "skills.recommend",
        { workspaceId: "ws-1", limit: 20, offset: 0 },
        undefined
      );
    });

    rerender(
      <Provider store={store}>
        <SkillsPanel workspaceId="ws-1" refreshToken={1} />
      </Provider>
    );

    await waitFor(() => {
      expect(
        sendCommand.mock.calls.filter(
          ([op, args]) =>
            op === "skills.recommend" &&
            args?.workspaceId === "ws-1" &&
            args?.limit === 20 &&
            args?.offset === 0
        ).length
      ).toBeGreaterThan(1);
    });
  });
```

- [ ] **Step 2: Run the web test to verify it fails**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

Expected: FAIL because there is no next-page loader, no duplicate filtering, and no separate page state.

- [ ] **Step 3: Add pagination state and helpers to `useSkillsPanel`**

Extend the hook state in `packages/web/src/features/workspace/actions/use-skills-panel.ts`:

```ts
  const [recommendationsHasMore, setRecommendationsHasMore] = useState(false);
  const [loadingRecommendationPage, setLoadingRecommendationPage] = useState(false);
  const recommendationPageLoadingRef = useRef(false);
```

Add constants near the imports or top of the module:

```ts
const RECOMMENDATIONS_PAGE_SIZE = 20;
```

Add a helper for dedupe:

```ts
function appendUniqueRecommendations(
  current: SkillRecommendationEntry[],
  incoming: SkillRecommendationEntry[]
) {
  const seen = new Set(current.map((entry) => entry.slug));
  const appended = incoming.filter((entry) => !seen.has(entry.slug));
  return appended.length > 0 ? [...current, ...appended] : current;
}
```

- [ ] **Step 4: Implement `refreshRecommendations()` and `loadMoreRecommendations()`**

Update `refreshRecommendations()` to:

```ts
  const refreshRecommendations = useCallback(async () => {
    recommendationPageLoadingRef.current = false;
    setLoadingRecommendationPage(false);
    setLoadingRecommendations(true);
    const result = await dispatch<SkillRecommendationPage>("skills.recommend", {
      workspaceId,
      limit: RECOMMENDATIONS_PAGE_SIZE,
      offset: 0,
    });
    setLoadingRecommendations(false);
    if (!result.ok || !result.data) {
      setErrorMessage(result.error?.message ?? "Failed to load skill recommendations");
      return;
    }

    setRecommendations(result.data.entries);
    setRecommendationsHasMore(result.data.hasMore);
    setErrorMessage(null);
  }, [dispatch, workspaceId]);
```

Add:

```ts
  const loadMoreRecommendations = useCallback(async () => {
    if (
      loadingRecommendations ||
      recommendationPageLoadingRef.current ||
      !recommendationsHasMore ||
      panelState.recommendationsCollapsed
    ) {
      return;
    }

    recommendationPageLoadingRef.current = true;
    setLoadingRecommendationPage(true);
    const result = await dispatch<SkillRecommendationPage>("skills.recommend", {
      workspaceId,
      limit: RECOMMENDATIONS_PAGE_SIZE,
      offset: recommendations.length,
    });
    recommendationPageLoadingRef.current = false;
    setLoadingRecommendationPage(false);

    if (!result.ok || !result.data) {
      setErrorMessage(result.error?.message ?? "Failed to load skill recommendations");
      return;
    }

    setRecommendations((current) => appendUniqueRecommendations(current, result.data.entries));
    setRecommendationsHasMore(result.data.hasMore);
    setErrorMessage(null);
  }, [
    dispatch,
    loadingRecommendations,
    panelState.recommendationsCollapsed,
    recommendations.length,
    recommendationsHasMore,
    workspaceId,
  ]);
```

Export `loadMoreRecommendations`, `loadingRecommendationPage`, and `recommendationsHasMore` from the hook return object.

- [ ] **Step 5: Re-run the web test to verify it passes**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

Expected: PASS for refreshed first-page requests and duplicate-safe append behavior.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/workspace/actions/use-skills-panel.ts packages/web/src/features/workspace/views/shared/skills-panel.test.tsx
git commit -m "feat: add paginated recommendation state to skills panel"
```

### Task 5: Add Recommendation Sentinel Observation in the Skills Panel View

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

- [ ] **Step 1: Write the failing observer lifecycle tests**

Extend `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx` with:

1. A test that verifies the observer is not used while recommendations are collapsed.
2. A test that verifies next-page loading text renders only at the list footer when `hasMore` and the page load are active.

Use the existing `GitPanel` pattern to stub `IntersectionObserver`. Example collapsed-state test:

```ts
  it("does not observe the recommendation sentinel while recommendations are collapsed", async () => {
    const observe = vi.fn();
    class IntersectionObserverMock {
      readonly unobserve = vi.fn();
      readonly disconnect = vi.fn();

      constructor() {}

      observe = observe;

      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    const originalIntersectionObserver = global.IntersectionObserver;
    global.IntersectionObserver =
      IntersectionObserverMock as unknown as typeof IntersectionObserver;

    const sendCommand = vi.fn(async (op: string) => {
      if (op === "skills.library.list") return [];
      if (op === "skills.health.scan") return { targets: [], mounts: [] };
      if (op === "skills.recommend") {
        return {
          entries: [{ slug: "skill-1", displayName: "Skill 1", reason: "reason", sourceQuery: "React", score: 1, installed: false }],
          hasMore: true,
        };
      }
      return [];
    });

    renderPanel(sendCommand);
    const toggle = await screen.findByRole("button", { name: "Collapse Recommendations" });
    fireEvent.click(toggle);

    await waitFor(() => expect(observe).not.toHaveBeenCalled());
    global.IntersectionObserver = originalIntersectionObserver;
  });
```

- [ ] **Step 2: Run the web test to verify it fails**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

Expected: FAIL because the panel view has no sentinel, no observer wiring, and no footer loading state.

- [ ] **Step 3: Add sentinel refs and observer effect to `skills-panel.tsx`**

At the top of the component, extend the hook destructuring:

```ts
    loadingRecommendationPage,
    loadMoreRecommendations,
    recommendationsHasMore,
```

Add refs:

```ts
  const recommendationsLoadSentinelRef = useRef<HTMLDivElement | null>(null);
  const recommendationsScrollRootRef = useRef<HTMLDivElement | null>(null);
```

Attach the scroll root ref to the existing sidebar body:

```tsx
        <div
          ref={recommendationsScrollRootRef}
          className="workspace-sidebar-panel__body workspace-sidebar-panel__body--stacked skills-panel__body"
        >
```

Add an effect modeled after `git-panel.tsx`:

```ts
  useEffect(() => {
    if (
      panelState.recommendationsCollapsed ||
      !recommendationsHasMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const root = recommendationsScrollRootRef.current;
    const sentinel = recommendationsLoadSentinelRef.current;
    if (!root || !sentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreRecommendations();
        }
      },
      {
        root,
        rootMargin: "120px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    loadMoreRecommendations,
    panelState.recommendationsCollapsed,
    recommendationsHasMore,
  ]);
```

- [ ] **Step 4: Render the sentinel and footer loading state**

Inside the recommendations section render path, append after the mapped cards:

```tsx
                  <>
                    {sortedRecommendations.map((item) => (
                      <article
                        key={item.slug}
                        className="skills-panel__list-item skills-panel__list-item--recommendation workspace-sidebar-row"
                      >
                        ...
                      </article>
                    ))}
                    {loadingRecommendationPage ? (
                      <p className="workspace-search-panel__state">{t("common.loading")}</p>
                    ) : null}
                    {recommendationsHasMore ? (
                      <div
                        ref={recommendationsLoadSentinelRef}
                        data-testid="skills-recommendations-sentinel"
                        aria-hidden="true"
                      />
                    ) : null}
                  </>
```

Keep the first-page empty/loading branches unchanged.

- [ ] **Step 5: Run the web test to verify it passes**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

Expected: PASS with observer-based next-page loading and collapsed-state guard behavior.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/workspace/views/shared/skills-panel.tsx packages/web/src/features/workspace/views/shared/skills-panel.test.tsx
git commit -m "feat: load more skill recommendations on scroll"
```

### Task 6: Full Regression Verification

**Files:**
- Modify: none
- Test: `packages/core/src/domain/skill-management.test.ts`
- Test: `packages/server/src/__tests__/skills/commands.test.ts`
- Test: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

- [ ] **Step 1: Run the focused core test suite**

Run: `pnpm --filter @coder-studio/core test -- packages/core/src/domain/skill-management.test.ts`

Expected: PASS.

- [ ] **Step 2: Run the focused server test suite**

Run: `pnpm --filter @coder-studio/server test -- packages/server/src/__tests__/skills/commands.test.ts`

Expected: PASS.

- [ ] **Step 3: Run the focused web test suite**

Run: `pnpm --filter @coder-studio/web test -- packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`

Expected: PASS.

- [ ] **Step 4: Run repository verification if time and scope allow**

Run: `pnpm ci:test`

Expected: PASS, or document any unrelated failures precisely before handoff.

- [ ] **Step 5: Commit verification-state updates only if needed**

```bash
git status --short
```

Expected: no uncommitted changes after verification. Do not create an extra commit if verification produced no file changes.

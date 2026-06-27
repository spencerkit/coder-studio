import {
  type AgentSkillTargetEntry,
  type SkillInstallJobSnapshot,
  type SkillLibraryEntry,
  type SkillMountRelation,
  type SkillRecommendationEntry,
  type SkillRecommendationPage,
  type SkillVersionCheckEntry,
  Topics,
} from "@coder-studio/core";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dispatchCommandAtom, wsClientAtom } from "../../../atoms/connection";
import { skillsPanelStateAtomFamily } from "../atoms/skills";

const RECOMMENDATIONS_PAGE_SIZE = 20;

export interface SkillSearchResultItem {
  slug: string;
  displayName: string;
  description?: string;
  version?: string;
  installed: boolean;
  installedVersion?: string;
  mountedProviderIds: string[];
}

export interface SkillLibraryListItem extends SkillLibraryEntry {
  mountedProviderIds: string[];
  mountStatus: "unmounted" | "partially_mounted" | "fully_mounted" | "error";
  errorCount: number;
}

export interface SkillInfoItem {
  slug: string;
  displayName: string;
  description?: string;
  version?: string;
  installed: boolean;
  libraryEntry?: SkillLibraryEntry;
  mounts: SkillMountRelation[];
}

interface SkillsHealthScanResult {
  targets: Array<AgentSkillTargetEntry & { mountedSkillCount: number }>;
  mounts: SkillMountRelation[];
}

function appendUniqueRecommendations(
  current: SkillRecommendationEntry[],
  incoming: SkillRecommendationEntry[]
) {
  const seen = new Set(current.map((entry) => entry.slug));
  const appended = incoming.filter((entry) => !seen.has(entry.slug));
  return appended.length > 0 ? [...current, ...appended] : current;
}

export function useSkillsPanel(workspaceId: string) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const wsClient = useAtomValue(wsClientAtom);
  const [panelState, setPanelState] = useAtom(skillsPanelStateAtomFamily(workspaceId));
  const [searchResults, setSearchResults] = useState<SkillSearchResultItem[]>([]);
  const [recommendations, setRecommendations] = useState<SkillRecommendationEntry[]>([]);
  const [library, setLibrary] = useState<SkillLibraryListItem[]>([]);
  const [skillInfoBySlug, setSkillInfoBySlug] = useState<Record<string, SkillInfoItem>>({});
  const [versionChecksBySlug, setVersionChecksBySlug] = useState<
    Record<string, SkillVersionCheckEntry>
  >({});
  const [targets, setTargets] = useState<
    Array<AgentSkillTargetEntry & { mountedSkillCount: number }>
  >([]);
  const [mountsBySkillSlug, setMountsBySkillSlug] = useState<Record<string, SkillMountRelation[]>>(
    {}
  );
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [recommendationsHasMore, setRecommendationsHasMore] = useState(false);
  const [loadingRecommendationPage, setLoadingRecommendationPage] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [checkingVersions, setCheckingVersions] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recommendationCycleRef = useRef(0);
  const recommendationPageLoadingRef = useRef(false);

  const refreshLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    const result = await dispatch<SkillLibraryListItem[]>("skills.library.list", { workspaceId });
    setLoadingLibrary(false);
    if (!result.ok || !result.data) {
      setErrorMessage(result.error?.message ?? "Failed to load skills");
      return;
    }
    setLibrary(result.data);
  }, [dispatch]);

  const runSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      setPanelState((current) => ({ ...current, query, resolvedQuery: trimmed }));
      if (!trimmed) {
        setSearchResults([]);
        return;
      }

      setLoadingSearch(true);
      const result = await dispatch<SkillSearchResultItem[]>("skills.search", {
        workspaceId,
        query: trimmed,
      });
      setLoadingSearch(false);
      if (!result.ok || !result.data) {
        setErrorMessage(result.error?.message ?? "Failed to search skills");
        return;
      }
      setErrorMessage(null);
      setSearchResults(result.data);
    },
    [dispatch, setPanelState]
  );

  const refreshRecommendations = useCallback(async () => {
    const cycle = recommendationCycleRef.current + 1;
    recommendationCycleRef.current = cycle;
    recommendationPageLoadingRef.current = false;
    setLoadingRecommendationPage(false);
    setLoadingRecommendations(true);
    const result = await dispatch<SkillRecommendationPage>("skills.recommend", {
      workspaceId,
      limit: RECOMMENDATIONS_PAGE_SIZE,
      offset: 0,
    });
    if (recommendationCycleRef.current !== cycle) {
      return;
    }
    setLoadingRecommendations(false);
    if (!result.ok || !result.data) {
      setErrorMessage(result.error?.message ?? "Failed to load skill recommendations");
      return;
    }

    setRecommendations(result.data.entries);
    setRecommendationsHasMore(result.data.hasMore);
    setErrorMessage(null);
  }, [dispatch, workspaceId]);

  const loadMoreRecommendations = useCallback(async () => {
    if (
      loadingRecommendations ||
      recommendationPageLoadingRef.current ||
      panelState.recommendationsCollapsed ||
      !recommendationsHasMore
    ) {
      return;
    }

    const cycle = recommendationCycleRef.current;
    recommendationPageLoadingRef.current = true;
    setLoadingRecommendationPage(true);
    const result = await dispatch<SkillRecommendationPage>("skills.recommend", {
      workspaceId,
      limit: RECOMMENDATIONS_PAGE_SIZE,
      offset: recommendations.length,
    });
    if (recommendationCycleRef.current !== cycle) {
      return;
    }
    recommendationPageLoadingRef.current = false;
    setLoadingRecommendationPage(false);

    if (!result.ok || !result.data) {
      setErrorMessage(result.error?.message ?? "Failed to load skill recommendations");
      return;
    }

    setRecommendations((current) => appendUniqueRecommendations(current, result.data!.entries));
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

  const checkSkillVersions = useCallback(async () => {
    setCheckingVersions(true);
    const result = await dispatch<SkillVersionCheckEntry[]>("skills.versions.check", {
      workspaceId,
    });
    setCheckingVersions(false);
    if (!result.ok || !result.data) {
      setErrorMessage(result.error?.message ?? "Failed to check skill versions");
      return false;
    }

    setVersionChecksBySlug(Object.fromEntries(result.data.map((entry) => [entry.slug, entry])));
    setErrorMessage(null);
    return true;
  }, [dispatch]);

  const loadSkillInfo = useCallback(
    async (slug: string) => {
      const result = await dispatch<SkillInfoItem>("skills.info", { workspaceId, slug });
      if (!result.ok || !result.data) {
        setErrorMessage(result.error?.message ?? "Failed to load skill details");
        return null;
      }

      setSkillInfoBySlug((current) => ({
        ...current,
        [slug]: result.data!,
      }));
      setErrorMessage(null);
      return result.data;
    },
    [dispatch]
  );

  const refreshHealth = useCallback(async () => {
    const result = await dispatch<SkillsHealthScanResult>("skills.health.scan", { workspaceId });
    if (!result.ok || !result.data) {
      setErrorMessage(result.error?.message ?? "Failed to scan skills");
      return false;
    }

    const mountMap = result.data.mounts.reduce<Record<string, SkillMountRelation[]>>(
      (acc, mount) => {
        acc[mount.skillSlug] = [...(acc[mount.skillSlug] ?? []), mount];
        return acc;
      },
      {}
    );

    setTargets(result.data.targets);
    setMountsBySkillSlug(mountMap);
    setErrorMessage(null);
    await refreshLibrary();
    return true;
  }, [dispatch, refreshLibrary]);

  useEffect(() => {
    void refreshLibrary();
    void refreshHealth();
  }, [refreshHealth, refreshLibrary]);

  useEffect(() => {
    if (!wsClient || typeof wsClient.subscribe !== "function") {
      return;
    }

    return wsClient.subscribe([Topics.skillLibraryChanged], () => {
      void refreshHealth();
    });
  }, [refreshHealth, wsClient]);

  useEffect(() => {
    const jobIds = Object.entries(panelState.installJobIdBySlug);
    if (jobIds.length === 0) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void Promise.all(
        jobIds.map(async ([slug, jobId]) => {
          const result = await dispatch<SkillInstallJobSnapshot>("skills.install.get", {
            workspaceId,
            jobId,
          });
          if (cancelled || !result.ok || !result.data) {
            return;
          }

          if (result.data.status === "succeeded" || result.data.status === "failed") {
            setPanelState((current) => {
              const next = { ...current.installJobIdBySlug };
              delete next[slug];
              return {
                ...current,
                installJobIdBySlug: next,
              };
            });
            if (panelState.resolvedQuery) {
              void runSearch(panelState.resolvedQuery);
            }
            void refreshRecommendations();
            void refreshLibrary();
            void refreshHealth();
            void checkSkillVersions();
          }
        })
      );
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    dispatch,
    panelState.installJobIdBySlug,
    panelState.resolvedQuery,
    refreshHealth,
    refreshLibrary,
    refreshRecommendations,
    runSearch,
    checkSkillVersions,
    setPanelState,
  ]);

  const installSkill = useCallback(
    async (slug: string) => {
      const result = await dispatch<SkillInstallJobSnapshot>("skills.install.start", {
        workspaceId,
        slug,
      });
      if (!result.ok || !result.data) {
        setErrorMessage(result.error?.message ?? "Failed to install skill");
        return false;
      }

      setPanelState((current) => ({
        ...current,
        installJobIdBySlug: {
          ...current.installJobIdBySlug,
          [slug]: result.data!.jobId,
        },
      }));
      setErrorMessage(null);
      return true;
    },
    [dispatch, setPanelState]
  );

  const createCustomSkill = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return null;
      }

      const result = await dispatch<SkillLibraryEntry>("skills.custom.create", {
        workspaceId,
        name: trimmed,
      });
      if (!result.ok || !result.data) {
        setErrorMessage(result.error?.message ?? "Failed to create custom skill");
        return null;
      }

      setErrorMessage(null);
      await refreshLibrary();
      await refreshHealth();
      return result.data;
    },
    [dispatch, refreshHealth, refreshLibrary]
  );

  const setSkillMountEnabled = useCallback(
    async (skillSlug: string, providerIds: string[], enabled: boolean) => {
      if (providerIds.length === 0) {
        return true;
      }

      const failures: string[] = [];

      for (const providerId of providerIds) {
        const result = enabled
          ? await dispatch<SkillMountRelation>("skills.mount", {
              workspaceId,
              providerId,
              skillSlug,
              enabled: true,
            })
          : await dispatch("skills.unmount", {
              workspaceId,
              providerId,
              skillSlug,
            });

        if (!result.ok) {
          failures.push(result.error?.message ?? "Failed to update skill mount state");
        }
      }

      if (panelState.resolvedQuery) {
        await runSearch(panelState.resolvedQuery);
      }
      await refreshHealth();

      if (failures.length > 0) {
        setErrorMessage(failures[0] ?? "Failed to update skill mount state");
        return false;
      }

      setErrorMessage(null);
      return true;
    },
    [dispatch, panelState.resolvedQuery, refreshHealth, runSearch]
  );

  const setBuiltinMountEnabled = useCallback(
    async (skillSlug: string, providerIds: string[], enabled: boolean) => {
      if (providerIds.length === 0) {
        return true;
      }

      const failures: string[] = [];

      for (const providerId of providerIds) {
        const result = await dispatch("skills.builtin.setMountEnabled", {
          workspaceId,
          providerId,
          skillSlug,
          enabled,
        });
        if (!result.ok) {
          failures.push(result.error?.message ?? "Failed to update built-in skill mount setting");
        }
        if (!enabled) {
          const unmountResult = await dispatch("skills.unmount", {
            workspaceId,
            providerId,
            skillSlug,
          });
          if (!unmountResult.ok) {
            failures.push(unmountResult.error?.message ?? "Failed to unmount built-in skill");
          }
        }
      }

      if (panelState.resolvedQuery) {
        await runSearch(panelState.resolvedQuery);
      }
      await refreshHealth();
      await refreshRecommendations();

      if (failures.length > 0) {
        setErrorMessage(failures[0] ?? "Failed to update built-in skill mount setting");
        return false;
      }

      setErrorMessage(null);
      return true;
    },
    [dispatch, panelState.resolvedQuery, refreshHealth, refreshRecommendations, runSearch]
  );

  const uninstallSkill = useCallback(
    async (slug: string, force = false) => {
      const result = await dispatch("skills.uninstall", { workspaceId, slug, force });
      if (!result.ok) {
        setErrorMessage(result.error?.message ?? "Failed to uninstall skill");
        return false;
      }
      setErrorMessage(null);
      if (panelState.resolvedQuery) {
        await runSearch(panelState.resolvedQuery);
      }
      await refreshLibrary();
      await refreshHealth();
      await refreshRecommendations();
      return true;
    },
    [
      dispatch,
      panelState.resolvedQuery,
      refreshHealth,
      refreshLibrary,
      refreshRecommendations,
      runSearch,
    ]
  );

  const updateSkill = useCallback(
    async (slug: string) => {
      const result = await dispatch<SkillInstallJobSnapshot>("skills.update.start", {
        workspaceId,
        slug,
      });
      if (!result.ok || !result.data) {
        setErrorMessage(result.error?.message ?? "Failed to update skill");
        return false;
      }

      setPanelState((current) => ({
        ...current,
        installJobIdBySlug: {
          ...current.installJobIdBySlug,
          [slug]: result.data!.jobId,
        },
      }));
      setErrorMessage(null);
      return true;
    },
    [dispatch, setPanelState]
  );

  const installingSkillSlugs = useMemo(
    () => new Set(Object.keys(panelState.installJobIdBySlug)),
    [panelState.installJobIdBySlug]
  );

  return {
    errorMessage,
    checkSkillVersions,
    checkingVersions,
    createCustomSkill,
    installSkill,
    installingSkillSlugs,
    library,
    loadSkillInfo,
    loadingLibrary,
    loadingRecommendationPage,
    loadingRecommendations,
    loadingSearch,
    loadMoreRecommendations,
    mountsBySkillSlug,
    panelState,
    refreshHealth,
    refreshRecommendations,
    setSkillMountEnabled,
    setBuiltinMountEnabled,
    recommendations,
    recommendationsHasMore,
    runSearch,
    searchResults,
    setPanelState,
    targets,
    skillInfoBySlug,
    uninstallSkill,
    updateSkill,
    versionChecksBySlug,
  };
}

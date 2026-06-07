import type {
  AgentSkillTargetEntry,
  SkillInstallJobSnapshot,
  SkillLibraryEntry,
  SkillMountRelation,
} from "@coder-studio/core";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { skillsPanelStateAtomFamily } from "../atoms/skills";

export interface SkillSearchResultItem {
  slug: string;
  displayName: string;
  description?: string;
  installed: boolean;
  installedVersion?: string;
  mountedProviderIds: string[];
}

export interface SkillLibraryListItem extends SkillLibraryEntry {
  mountedProviderIds: string[];
  mountStatus: "unmounted" | "partially_mounted" | "fully_mounted" | "error";
  errorCount: number;
}

interface SkillsHealthScanResult {
  targets: Array<AgentSkillTargetEntry & { mountedSkillCount: number }>;
  mounts: SkillMountRelation[];
}

export function useSkillsPanel(workspaceId: string) {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [panelState, setPanelState] = useAtom(skillsPanelStateAtomFamily(workspaceId));
  const [searchResults, setSearchResults] = useState<SkillSearchResultItem[]>([]);
  const [library, setLibrary] = useState<SkillLibraryListItem[]>([]);
  const [targets, setTargets] = useState<
    Array<AgentSkillTargetEntry & { mountedSkillCount: number }>
  >([]);
  const [mountsBySkillSlug, setMountsBySkillSlug] = useState<Record<string, SkillMountRelation[]>>(
    {}
  );
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    setLoadingLibrary(true);
    const result = await dispatch<SkillLibraryListItem[]>("skills.library.list", {});
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
      const result = await dispatch<SkillSearchResultItem[]>("skills.search", { query: trimmed });
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

  const refreshHealth = useCallback(async () => {
    const result = await dispatch<SkillsHealthScanResult>("skills.health.scan", {});
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
    const jobIds = Object.entries(panelState.installJobIdBySlug);
    if (jobIds.length === 0) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void Promise.all(
        jobIds.map(async ([slug, jobId]) => {
          const result = await dispatch<SkillInstallJobSnapshot>("skills.install.get", { jobId });
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
            void refreshLibrary();
            void refreshHealth();
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
    runSearch,
    setPanelState,
  ]);

  const installSkill = useCallback(
    async (slug: string) => {
      const result = await dispatch<SkillInstallJobSnapshot>("skills.install.start", { slug });
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

  const mountSkill = useCallback(
    async (providerId: string, skillSlug: string) => {
      const result = await dispatch<SkillMountRelation>("skills.mount", {
        providerId,
        skillSlug,
        enabled: true,
      });
      if (!result.ok) {
        setErrorMessage(result.error?.message ?? "Failed to mount skill");
        return false;
      }
      setErrorMessage(null);
      if (panelState.resolvedQuery) {
        await runSearch(panelState.resolvedQuery);
      }
      await refreshHealth();
      return true;
    },
    [dispatch, panelState.resolvedQuery, refreshHealth, runSearch]
  );

  const unmountSkill = useCallback(
    async (providerId: string, skillSlug: string) => {
      const result = await dispatch("skills.unmount", {
        providerId,
        skillSlug,
      });
      if (!result.ok) {
        setErrorMessage(result.error?.message ?? "Failed to unmount skill");
        return false;
      }
      setErrorMessage(null);
      if (panelState.resolvedQuery) {
        await runSearch(panelState.resolvedQuery);
      }
      await refreshHealth();
      return true;
    },
    [dispatch, panelState.resolvedQuery, refreshHealth, runSearch]
  );

  const repairSkill = useCallback(
    async (providerId: string, skillSlug: string) => {
      const result = await dispatch<SkillMountRelation>("skills.repair", {
        providerId,
        skillSlug,
      });
      if (!result.ok) {
        setErrorMessage(result.error?.message ?? "Failed to repair skill mount");
        return false;
      }
      setErrorMessage(null);
      if (panelState.resolvedQuery) {
        await runSearch(panelState.resolvedQuery);
      }
      await refreshHealth();
      return true;
    },
    [dispatch, panelState.resolvedQuery, refreshHealth, runSearch]
  );

  const uninstallSkill = useCallback(
    async (slug: string, force = false) => {
      const result = await dispatch("skills.uninstall", { slug, force });
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
      return true;
    },
    [dispatch, panelState.resolvedQuery, refreshHealth, refreshLibrary, runSearch]
  );

  const installingSkillSlugs = useMemo(
    () => new Set(Object.keys(panelState.installJobIdBySlug)),
    [panelState.installJobIdBySlug]
  );

  return {
    errorMessage,
    installSkill,
    installingSkillSlugs,
    library,
    loadingLibrary,
    loadingSearch,
    mountSkill,
    mountsBySkillSlug,
    panelState,
    refreshHealth,
    repairSkill,
    runSearch,
    searchResults,
    setPanelState,
    targets,
    uninstallSkill,
    unmountSkill,
  };
}

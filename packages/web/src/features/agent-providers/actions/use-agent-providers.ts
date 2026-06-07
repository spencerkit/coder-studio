import type { ProviderListItem } from "@coder-studio/core";
import { useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { providerListAtom } from "../../../atoms/providers";
import { useTranslation } from "../../../lib/i18n";

interface UseAgentProvidersResult {
  providers: ProviderListItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

function normalizeProviders(providers: ProviderListItem[]): ProviderListItem[] {
  return providers.map((provider) => ({
    ...provider,
    capabilities: provider.capabilities.map((capability) => ({ ...capability })),
    requiredCommands: [...provider.requiredCommands],
  }));
}

export function useAgentProviders(): UseAgentProvidersResult {
  const t = useTranslation();
  const [dispatch] = useAtom(dispatchCommandAtom);
  const [providers, setProviders] = useAtom(providerListAtom);
  const [isLoading, setIsLoading] = useState(providers.length === 0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const result = await dispatch<ProviderListItem[]>("provider.list", {});
    if (!result.ok || !result.data) {
      setError(result.error?.message ?? t("provider.load_failed"));
      setIsLoading(false);
      return;
    }

    setProviders(normalizeProviders(result.data));
    setError(null);
    setIsLoading(false);
  }, [dispatch, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    providers,
    isLoading,
    error,
    refresh,
  };
}

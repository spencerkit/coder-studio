import type { ProviderListItem } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";
import { useTranslation } from "../../../lib/i18n";

interface UseAgentProvidersResult {
  providers: ProviderListItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAgentProviders(): UseAgentProvidersResult {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const result = await dispatch<ProviderListItem[]>("provider.list", {});
    if (!result.ok || !result.data) {
      setProviders([]);
      setError(result.error?.message ?? t("provider.load_failed"));
      setIsLoading(false);
      return;
    }

    setProviders(result.data);
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

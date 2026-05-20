import type { ProviderListItem } from "@coder-studio/core";
import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";
import { dispatchCommandAtom } from "../../../atoms/connection";

interface UseAgentProvidersResult {
  providers: ProviderListItem[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAgentProviders(): UseAgentProvidersResult {
  const dispatch = useAtomValue(dispatchCommandAtom);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);

    const result = await dispatch<ProviderListItem[]>("provider.list", {});
    if (!result.ok || !result.data) {
      setProviders([]);
      setError(result.error?.message ?? "Failed to load providers");
      setIsLoading(false);
      return;
    }

    setProviders(result.data);
    setError(null);
    setIsLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, [dispatch]);

  return {
    providers,
    isLoading,
    error,
    refresh,
  };
}

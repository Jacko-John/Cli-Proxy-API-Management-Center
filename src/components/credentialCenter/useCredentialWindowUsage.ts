import { useEffect, useState } from 'react';
import { usageApi, type CredentialWindowQuery } from '@/services/api/usage';
import type { CredentialWindowUsageSummary } from '@/utils/credentialUsage';

export function useCredentialWindowUsage(queries: CredentialWindowQuery[]) {
  const [summaries, setSummaries] = useState<Record<string, CredentialWindowUsageSummary>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!queries.length) {
      setSummaries({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void usageApi
        .getCredentialWindows(queries)
        .then((response) => {
          if (cancelled) return;
          const next: Record<string, CredentialWindowUsageSummary> = {};
          Object.entries(response.windows ?? {}).forEach(([id, value]) => {
            next[id] = {
              requests: value.requests,
              successCount: value.success_count,
              failureCount: value.failure_count,
              tokens: value.tokens,
              cost: value.cost,
            };
          });
          setSummaries(next);
        })
        .catch(() => {
          if (!cancelled) setSummaries({});
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 50);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [queries]);

  return { summaries, loading };
}

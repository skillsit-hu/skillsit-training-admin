import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionInfo } from '@infra/core/api';
import { api } from '@/lib/api';

interface SessionState {
  session: SessionInfo | null;
  loading: boolean;
  refresh: () => Promise<unknown>;
}

const SessionContext = createContext<SessionState>({ session: null, loading: true, refresh: async () => {} });

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['session'], queryFn: () => api.me().catch(() => null), staleTime: Infinity });

  useEffect(() => {
    const onExpired = () => queryClient.setQueryData(['session'], null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [queryClient]);

  return (
    <SessionContext.Provider value={{ session: query.data ?? null, loading: query.isLoading, refresh: query.refetch }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}

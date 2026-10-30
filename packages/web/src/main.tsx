import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppLayout } from '@/components/app-layout';
import { SessionProvider, useSession } from '@/lib/session';
import { ConfigPage } from '@/pages/config';
import { DashboardPage } from '@/pages/dashboard';
import { JobDetailPage, JobsPage } from '@/pages/jobs';
import { LoginPage } from '@/pages/login';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});

function Routed() {
  const { session, loading } = useSession();
  if (loading) return null;
  if (!session) return <LoginPage />;
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardPage />} />
        <Route path="config" element={<ConfigPage />} />
        <Route path="jobs" element={<JobsPage />} />
        <Route path="jobs/:id" element={<JobDetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BrowserRouter>
            <SessionProvider>
              <Routed />
            </SessionProvider>
          </BrowserRouter>
        </TooltipProvider>
        <Toaster richColors position="top-right" />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

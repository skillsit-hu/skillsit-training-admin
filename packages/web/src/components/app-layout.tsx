import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, LayoutDashboard, LogOut, Moon, Server, Settings, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { JobStatusBadge } from '@/components/job-status-badge';
import { api } from '@/lib/api';
import { OPERATION_LABELS } from '@/lib/labels';
import { useSession } from '@/lib/session';

const NAV = [
  { to: '/', label: 'Áttekintés', icon: LayoutDashboard, end: true },
  { to: '/config', label: 'Konfiguráció', icon: Settings, end: false },
  { to: '/jobs', label: 'Futtatások', icon: History, end: false },
];

function NavItems() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {NAV.map(({ to, label, icon: Icon, end }) => (
        <SidebarMenuItem key={to}>
          <SidebarMenuButton asChild isActive={end ? pathname === to : pathname.startsWith(to)} tooltip={label}>
            <NavLink to={to} end={end} onClick={() => setOpenMobile(false)}>
              <Icon />
              <span>{label}</span>
            </NavLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" aria-label="Téma váltása" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
      {resolvedTheme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

export function AppLayout() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 10_000 });
  const running = status.data?.runningJob;

  const logout = async () => {
    await api.logout();
    queryClient.clear();
    queryClient.setQueryData(['session'], null);
  };

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <NavLink to="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Server className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">Infra Admin</span>
                    <span className="truncate text-xs text-muted-foreground">{session?.domain}</span>
                  </div>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <NavItems />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={logout} tooltip="Kijelentkezés">
                <LogOut />
                <span>Kijelentkezés ({session?.username})</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          {session?.dryRun && <Badge variant="outline">DRY RUN</Badge>}
          {running && (
            <NavLink to={`/jobs/${running.id}`} className="flex min-w-0 items-center gap-2 text-sm">
              <JobStatusBadge status="running" />
              <span className="truncate">{OPERATION_LABELS[running.operation].title}</span>
            </NavLink>
          )}
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Ban, Building2, Play, RefreshCw, Rocket, Square, Trash2, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ContainerStatus, OperationName } from '@infra/core/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { JobLog } from '@/components/job-log';
import { JobStatusBadge } from '@/components/job-status-badge';
import { ConfirmOperation } from '@/components/run-operation';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { OPERATION_LABELS } from '@/lib/labels';
import { cn } from '@/lib/utils';

const ICONS: Partial<Record<OperationName, LucideIcon>> = {
  init: Rocket,
  start: Play,
  stop: Square,
  clean: Trash2,
  disableCompetitorLogins: Ban,
  setupOrgs: Building2,
};

function groupByStack(containers: ContainerStatus[]) {
  const groups = new Map<string, ContainerStatus[]>();
  for (const c of containers) {
    const key = c.stack ?? 'egyéb';
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function StackCard({ stack, containers }: { stack: string; containers: ContainerStatus[] }) {
  const up = containers.filter((c) => c.state === 'running').length;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="font-mono text-sm">{stack}</CardTitle>
        <CardAction>
          <Badge variant={up === containers.length ? 'secondary' : up === 0 ? 'destructive' : 'outline'}>
            {up}/{containers.length}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-1">
        {containers.map((c) => (
          <div key={c.name} className="flex items-center gap-2 text-xs" title={c.status}>
            <span className={cn('size-2 shrink-0 rounded-full', c.state === 'running' ? 'bg-emerald-500' : 'bg-zinc-400')} />
            <span className="truncate">{c.name}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">{c.state}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const operations = useQuery({ queryKey: ['operations'], queryFn: api.operations, staleTime: Infinity });
  const status = useQuery({ queryKey: ['status'], queryFn: api.status, refetchInterval: 10_000 });
  const running = status.data?.runningJob ?? null;
  const stream = useJobStream(running?.id ?? null);
  const stacks = groupByStack(status.data?.containers ?? []);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Áttekintés</h1>
        <p className="text-sm text-muted-foreground">A versenykörnyezet állapota és műveletei.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Műveletek</CardTitle>
          <CardDescription>Egyszerre egy művelet futhat. A versenyzők hozzáadása a Konfiguráció oldalon történik.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {operations.data
            ?.filter((op) => op.args.length === 0)
            .map((op) => {
              const Icon = ICONS[op.name] ?? Play;
              return (
                <ConfirmOperation key={op.name} name={op.name} destructive={op.destructive}>
                  {(open) => (
                    <button
                      type="button"
                      onClick={open}
                      disabled={!!running}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50',
                        op.destructive && 'border-destructive/40',
                      )}
                    >
                      <Icon className={cn('mt-0.5 size-5 shrink-0', op.destructive && 'text-destructive')} />
                      <span className="grid gap-0.5">
                        <span className="text-sm font-medium">{OPERATION_LABELS[op.name].title}</span>
                        <span className="text-xs text-muted-foreground">{OPERATION_LABELS[op.name].description}</span>
                      </span>
                    </button>
                  )}
                </ConfirmOperation>
              );
            })}
        </CardContent>
      </Card>

      {running && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {OPERATION_LABELS[running.operation].title}
              <JobStatusBadge status={stream.job?.status ?? running.status} />
            </CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/jobs/${running.id}`}>Részletek</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <JobLog lines={stream.lines} className="h-72 md:h-80" />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Konténerek</h2>
          <Button variant="ghost" size="sm" onClick={() => status.refetch()} disabled={status.isFetching}>
            <RefreshCw className={cn(status.isFetching && 'animate-spin')} />
            Frissítés
          </Button>
        </div>
        {status.isError && <p className="text-sm text-destructive">{(status.error as Error).message}</p>}
        {status.data && stacks.length === 0 && <p className="text-sm text-muted-foreground">Nincs futó vagy leállított konténer.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {stacks.map(([stack, containers]) => (
            <StackCard key={stack} stack={stack} containers={containers} />
          ))}
        </div>
      </div>
    </div>
  );
}

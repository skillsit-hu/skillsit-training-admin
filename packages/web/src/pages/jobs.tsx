import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, Square } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { JobLog } from '@/components/job-log';
import { JobStatusBadge } from '@/components/job-status-badge';
import { useJobStream } from '@/hooks/use-job-stream';
import { api } from '@/lib/api';
import { OPERATION_LABELS, duration, formatTime } from '@/lib/labels';

export function JobsPage() {
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: api.jobs, refetchInterval: 5_000 });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Futtatások</h1>
        <p className="text-sm text-muted-foreground">Az utolsó 50 művelet a szerver újraindításáig. A teljes logok a data-admin/jobs könyvtárban maradnak meg.</p>
      </div>
      <Card>
        <CardContent>
          {jobs.data?.length === 0 && <p className="text-sm text-muted-foreground">Még nem futott művelet.</p>}

          <div className="grid gap-2 md:hidden">
            {jobs.data?.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`} className="grid gap-1 rounded-lg border p-3 hover:bg-muted">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{OPERATION_LABELS[job.operation].title}</span>
                  <JobStatusBadge status={job.status} />
                </div>
                {job.label && <span className="truncate font-mono text-xs text-muted-foreground">{job.label}</span>}
                <span className="text-xs text-muted-foreground">
                  {formatTime(job.startedAt)} · {duration(job.startedAt, job.finishedAt)}
                </span>
              </Link>
            ))}
          </div>

          {!!jobs.data?.length && (
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Művelet</TableHead>
                    <TableHead>Paraméterek</TableHead>
                    <TableHead>Állapot</TableHead>
                    <TableHead>Indítva</TableHead>
                    <TableHead>Időtartam</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.data.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Link to={`/jobs/${job.id}`} className="font-medium underline-offset-4 hover:underline">
                          {OPERATION_LABELS[job.operation].title}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-56 truncate font-mono text-xs">{job.label}</TableCell>
                      <TableCell>
                        <JobStatusBadge status={job.status} />
                      </TableCell>
                      <TableCell>{formatTime(job.startedAt)}</TableCell>
                      <TableCell>{duration(job.startedAt, job.finishedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function JobDetailPage() {
  const { id = '' } = useParams();
  const initial = useQuery({ queryKey: ['job', id], queryFn: () => api.job(id), retry: false });
  const { lines, job: live } = useJobStream(initial.data ? id : null);
  const job = live ?? initial.data;

  const download = () => {
    const text = lines.map((l) => `${l.time} ${l.stream === 'error' ? 'ERR' : '   '} ${l.text}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${id}.log` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const cancel = async () => {
    try {
      await api.cancelJob(id);
      toast.info('Megszakítás kérve');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="grid gap-4">
      <Button variant="ghost" size="sm" className="w-fit" asChild>
        <Link to="/jobs">
          <ArrowLeft />
          Futtatások
        </Link>
      </Button>
      {initial.isError && <p className="text-sm text-destructive">{(initial.error as Error).message}</p>}
      {job && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {OPERATION_LABELS[job.operation].title}
              <JobStatusBadge status={job.status} />
            </CardTitle>
            <CardDescription className="grid gap-0.5">
              {job.label && <span className="font-mono">{job.label}</span>}
              <span>
                {formatTime(job.startedAt)} · {duration(job.startedAt, job.finishedAt)}
              </span>
              {job.error && <span className="text-destructive">{job.error}</span>}
            </CardDescription>
            <CardAction className="flex gap-2">
              {job.status === 'running' && (
                <Button variant="destructive" size="sm" onClick={cancel}>
                  <Square />
                  <span className="hidden sm:inline">Megszakítás</span>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={download} disabled={lines.length === 0}>
                <Download />
                <span className="hidden sm:inline">Letöltés</span>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <JobLog lines={lines} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

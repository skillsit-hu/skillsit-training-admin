import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {
  OperationError,
  giveToRepoOwner,
  runOperation,
  writeRepoFile,
  type JobDetail,
  type JobEvent,
  type JobSummary,
  type LogLine,
  type LogStream,
  type OperationName,
} from '@infra/core';

const HISTORY = 50;

interface Job {
  summary: JobSummary;
  lines: LogLine[];
  controller: AbortController;
  events: EventEmitter;
  logFile: string;
}

export class BusyError extends Error {
  constructor(public readonly running: JobSummary) {
    super(`Operation '${running.operation}' is already running`);
  }
}

function describeArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  return Object.entries(args)
    .filter(([key, value]) => key !== 'password' && value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

/**
 * Runs one operation at a time (they all drive the same Docker host) and keeps the log of the last
 * jobs in memory. Every log is also written to <logDir>/<id>.log.
 */
export class JobManager {
  private jobs = new Map<string, Job>();
  private current: Job | null = null;

  constructor(private readonly repoDir: string, private readonly logDir: string, private readonly dryRun: boolean) {
    // mkdir returns the first directory it had to create; hand every new level back to the repo owner.
    const created = fs.mkdirSync(logDir, { recursive: true });
    if (created) {
      for (let dir = logDir; dir.length >= created.length; dir = path.dirname(dir)) giveToRepoOwner(repoDir, dir);
    }
  }

  list(): JobSummary[] {
    return [...this.jobs.values()].map((j) => j.summary).reverse();
  }

  get(id: string): JobDetail | null {
    const job = this.jobs.get(id);
    return job ? { ...job.summary, lines: job.lines } : null;
  }

  running(): JobSummary | null {
    return this.current?.summary ?? null;
  }

  start(operation: OperationName, args: unknown): JobSummary {
    if (this.current) throw new BusyError(this.current.summary);

    const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;
    const job: Job = {
      summary: {
        id,
        operation,
        label: describeArgs(args),
        status: 'running',
        startedAt: new Date().toISOString(),
        lineCount: 0,
      },
      lines: [],
      controller: new AbortController(),
      events: new EventEmitter(),
      logFile: path.join(this.logDir, `${id}.log`),
    };
    job.events.setMaxListeners(100);
    writeRepoFile(this.repoDir, job.logFile, '');
    this.jobs.set(id, job);
    this.current = job;
    this.prune();

    const write = (stream: LogStream, text: string) => {
      const line: LogLine = { seq: job.lines.length, time: new Date().toISOString(), stream, text };
      job.lines.push(line);
      job.summary.lineCount = job.lines.length;
      fs.appendFile(job.logFile, `${line.time} ${stream === 'error' ? 'ERR' : '   '} ${text}\n`, () => {});
      job.events.emit('event', { type: 'line', line } satisfies JobEvent);
    };

    const ctx = {
      repoDir: this.repoDir,
      signal: job.controller.signal,
      dryRun: this.dryRun,
      log: { info: (m: string) => write('info', m), error: (m: string) => write('error', m) },
    };

    write('info', `▶ ${operation} ${job.summary.label}`.trim());
    runOperation(ctx, operation, args)
      .then(() => this.finish(job, 'succeeded'))
      .catch((err: unknown) => {
        if (job.controller.signal.aborted) return this.finish(job, 'cancelled');
        const message = err instanceof OperationError ? err.message : String((err as Error)?.stack ?? err);
        write('error', message);
        this.finish(job, 'failed', message);
      });

    return job.summary;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.summary.status !== 'running') return false;
    job.controller.abort();
    return true;
  }

  subscribe(id: string, listener: (event: JobEvent) => void): (() => void) | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.events.on('event', listener);
    return () => job.events.off('event', listener);
  }

  private finish(job: Job, status: JobSummary['status'], error?: string): void {
    job.summary.status = status;
    job.summary.finishedAt = new Date().toISOString();
    if (error) job.summary.error = error;
    if (this.current === job) this.current = null;
    job.events.emit('event', { type: 'status', job: job.summary } satisfies JobEvent);
  }

  private prune(): void {
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= HISTORY) break;
      if (job.summary.status !== 'running') this.jobs.delete(id);
    }
  }
}

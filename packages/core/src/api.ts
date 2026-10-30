// REST API payloads shared by the server and the web UI.
import type { LogStream } from './context.js';
import type { OperationName } from './ops/index.js';

export type { ContainerStatus } from './status.js';
export type { OperationInfo, OperationName } from './ops/index.js';

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface LogLine {
  /** Sequence number within the job, starting at 0. */
  seq: number;
  time: string;
  stream: LogStream;
  text: string;
}

export interface JobSummary {
  id: string;
  operation: OperationName;
  /** Human readable argument summary (passwords omitted). */
  label: string;
  status: JobStatus;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  lineCount: number;
}

export interface JobDetail extends JobSummary {
  lines: LogLine[];
}

/** Server-sent events on GET /api/jobs/:id/events */
export type JobEvent =
  | { type: 'line'; line: LogLine }
  | { type: 'status'; job: JobSummary };

export interface SessionInfo {
  username: string;
  dryRun: boolean;
  domain: string;
}

export interface ApiError {
  error: string;
  issues?: { path: (string | number)[]; message: string }[];
}

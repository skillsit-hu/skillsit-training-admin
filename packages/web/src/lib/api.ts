import type { ApiError, ContainerStatus, JobDetail, JobSummary, OperationInfo, OperationName, SessionInfo } from '@infra/core/api';
import type { MainConfig } from '@infra/core/schema';

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly body: ApiError) {
    super(body.error);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    throw new HttpError(res.status, data as ApiError);
  }
  return data as T;
}

export interface StatusResponse {
  containers: ContainerStatus[];
  runningJob: JobSummary | null;
}

export const api = {
  me: () => request<SessionInfo>('GET', '/auth/me'),
  login: (username: string, password: string) => request<SessionInfo>('POST', '/auth/login', { username, password }),
  logout: () => request<void>('POST', '/auth/logout'),
  config: () => request<MainConfig>('GET', '/config'),
  saveConfig: (config: MainConfig) => request<MainConfig>('PUT', '/config', config),
  operations: () => request<OperationInfo[]>('GET', '/operations'),
  runOperation: (name: OperationName, args: Record<string, unknown> = {}) => request<JobSummary>('POST', `/operations/${name}`, args),
  jobs: () => request<JobSummary[]>('GET', '/jobs'),
  job: (id: string) => request<JobDetail>('GET', `/jobs/${id}`),
  cancelJob: (id: string) => request<void>('POST', `/jobs/${id}/cancel`),
  status: () => request<StatusResponse>('GET', '/status'),
};

export type LogStream = 'info' | 'error';

export interface Logger {
  info(message: string): void;
  error(message: string): void;
}

export interface OpContext {
  /** Repository root; compose files and config paths are relative to it. */
  repoDir: string;
  log: Logger;
  signal?: AbortSignal;
  /** Log commands instead of executing them (local development without Docker). */
  dryRun?: boolean;
}

/** Thrown where the shell scripts used to `exit 1`. */
export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationError';
  }
}

export function consoleLogger(): Logger {
  return {
    info: (message) => console.log(message),
    error: (message) => console.error(message),
  };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new OperationError('Cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new OperationError('Cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new OperationError('Cancelled');
}

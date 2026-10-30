import { spawn } from 'node:child_process';
import { OperationError, type OpContext } from './context.js';

export interface RunOptions {
  env?: Record<string, string>;
  /** Working directory relative to the repository root. */
  cwd?: string;
  input?: string;
  /** Don't forward output to the log. */
  quiet?: boolean;
  /** Collect stdout instead of logging it. */
  capture?: boolean;
  /** Throw if the command fails. */
  check?: boolean;
  /** Command arguments that must not appear in the log. */
  secrets?: string[];
}

export interface RunResult {
  ok: boolean;
  stdout: string;
}

function mask(text: string, secrets: string[] = []): string {
  return secrets.filter(Boolean).reduce((out, s) => out.replaceAll(s, '***'), text);
}

function forwardLines(write: (line: string) => void) {
  let pending = '';
  return {
    push(chunk: string) {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) write(line);
    },
    flush() {
      if (pending) write(pending);
      pending = '';
    },
  };
}

export function run(ctx: OpContext, cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const { env, cwd, input, quiet = false, capture = false, check = false, secrets } = opts;
  const printable = mask(`$ ${[cmd, ...args].join(' ')}`, secrets);

  if (ctx.dryRun) {
    ctx.log.info(`[dry-run] ${printable}`);
    return Promise.resolve({ ok: true, stdout: '' });
  }
  if (!quiet) ctx.log.info(printable);

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: cwd ? `${ctx.repoDir}/${cwd}` : ctx.repoDir,
      env: { ...process.env, ...env },
      signal: ctx.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    const out = forwardLines((line) => ctx.log.info(mask(line, secrets)));
    const err = forwardLines((line) => ctx.log.error(mask(line, secrets)));
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (capture) stdout += chunk;
      if (!quiet && !capture) out.push(chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      if (!quiet) err.push(chunk);
    });
    child.stdin.end(input);

    let failure: Error | undefined;
    child.on('error', (e) => {
      failure = e;
    });
    child.on('close', (code) => {
      out.flush();
      err.flush();
      if (ctx.signal?.aborted) return reject(new OperationError('Cancelled'));
      if (failure) {
        const message = `Failed to run ${cmd}: ${failure.message}`;
        if (check) return reject(new OperationError(message));
        ctx.log.error(message);
        return resolve({ ok: false, stdout });
      }
      if (check && code !== 0) return reject(new OperationError(`Command failed (${code}): ${printable.slice(2)}`));
      resolve({ ok: code === 0, stdout });
    });
  });
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function giteaCli(ctx: OpContext, args: string[], opts?: RunOptions): Promise<RunResult> {
  const command = ['/app/gitea/gitea', ...args].map(shQuote).join(' ');
  return run(ctx, 'docker', ['exec', 'gitea', 'su', '-c', command, 'git'], opts);
}

/** Fails fast with a readable message instead of letting every docker call fail one by one. */
export async function ensureDocker(ctx: OpContext): Promise<void> {
  if (ctx.dryRun) return;
  const res = await run(ctx, 'docker', ['version', '--format', '{{.Server.Version}}'], { capture: true, quiet: true });
  if (!res.ok || !res.stdout.trim()) {
    throw new OperationError(
      `The Docker daemon is not reachable (platform: ${process.platform}). Is Docker running, and is this process on the same host as the daemon?`,
    );
  }
}

export function compose(ctx: OpContext, file: string, args: string[], env: Record<string, string>): Promise<RunResult> {
  return run(ctx, 'docker', ['compose', '-f', file, ...args], { env });
}

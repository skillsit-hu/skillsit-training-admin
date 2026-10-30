import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  OperationError,
  configSchema,
  containerStatus,
  consoleLogger,
  isOperationName,
  listOperations,
  readConfig,
  writeConfig,
  type ApiError,
  type JobEvent,
  type SessionInfo,
} from '@infra/core';
import { checkCredentials, clearSession, issueSession, loginLimiter, requireAuth, sessionUser } from './auth.js';
import { BusyError, JobManager } from './jobs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(process.env.REPO_DIR ?? path.join(here, '../../../..'));
const webDist = path.resolve(process.env.WEB_DIST ?? path.join(here, '../../web/dist'));
const port = Number(process.env.ADMIN_PORT ?? 8090);
const host = process.env.ADMIN_HOST ?? '0.0.0.0';
const dryRun = process.env.DRY_RUN === '1';

const jobs = new JobManager(repoDir, path.resolve(process.env.JOB_LOG_DIR ?? path.join(repoDir, 'data-admin/jobs')), dryRun);
const limiter = loginLimiter();

const app = express();
// Exactly one proxy (Traefik) in front: req.ip is the client Traefik saw, req.secure follows X-Forwarded-Proto.
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

const api = express.Router();

api.post('/auth/login', (req, res) => {
  const ip = req.ip ?? 'unknown';
  if (limiter.blocked(ip)) {
    res.status(429).json({ error: 'Too many failed attempts, try again later' } satisfies ApiError);
    return;
  }
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !checkCredentials(repoDir, username, password)) {
    limiter.fail(ip);
    res.status(401).json({ error: 'Invalid username or password' } satisfies ApiError);
    return;
  }
  limiter.succeed(ip);
  issueSession(res, repoDir, username, req.secure);
  res.json(session(username));
});

api.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.status(204).end();
});

api.get('/auth/me', (req, res) => {
  const user = sessionUser(req, repoDir);
  if (!user) {
    res.status(401).json({ error: 'Not logged in' } satisfies ApiError);
    return;
  }
  res.json(session(user));
});

api.use(requireAuth(repoDir));

api.get('/config', (_req, res) => {
  res.json(readConfig(repoDir));
});

api.put('/config', (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid configuration',
      issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
    } satisfies ApiError);
    return;
  }
  writeConfig(repoDir, parsed.data);
  res.json(parsed.data);
});

api.get('/operations', (_req, res) => {
  res.json(listOperations());
});

api.post('/operations/:name', (req, res) => {
  const { name } = req.params;
  if (!isOperationName(name)) {
    res.status(404).json({ error: `Unknown operation '${name}'` } satisfies ApiError);
    return;
  }
  try {
    res.status(202).json(jobs.start(name, req.body ?? {}));
  } catch (err) {
    if (err instanceof BusyError) {
      res.status(409).json({ error: err.message } satisfies ApiError);
      return;
    }
    throw err;
  }
});

api.get('/jobs', (_req, res) => {
  res.json(jobs.list());
});

api.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' } satisfies ApiError);
    return;
  }
  res.json(job);
});

api.post('/jobs/:id/cancel', (req, res) => {
  if (!jobs.cancel(req.params.id)) {
    res.status(409).json({ error: 'Job is not running' } satisfies ApiError);
    return;
  }
  res.status(202).json({ ok: true });
});

// Replays the lines after ?after=<seq>, then streams new lines and status changes.
api.get('/jobs/:id/events', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' } satisfies ApiError);
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: JobEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const after = Number(req.query.after ?? -1);
  // Subscribe before replaying so no line is lost in between; duplicates are filtered by seq.
  let lastSeq = after;
  const unsubscribe = jobs.subscribe(job.id, (event) => {
    if (event.type === 'line') {
      if (event.line.seq <= lastSeq) return;
      lastSeq = event.line.seq;
    }
    send(event);
  });
  for (const line of job.lines) {
    if (line.seq > lastSeq) {
      lastSeq = line.seq;
      send({ type: 'line', line });
    }
  }
  send({ type: 'status', job: jobs.get(job.id)! });
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(keepAlive);
    unsubscribe?.();
  });
});

api.get('/status', async (_req, res) => {
  const ctx = { repoDir, dryRun, log: { info: () => {}, error: () => {} } };
  res.json({ containers: await containerStatus(ctx), runningJob: jobs.running() });
});

api.use((_req, res) => {
  res.status(404).json({ error: 'Not found' } satisfies ApiError);
});

app.use('/api', api);

if (fs.existsSync(webDist)) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = err instanceof OperationError ? err.message : 'Internal server error';
  if (!(err instanceof OperationError)) console.error(err);
  res.status(500).json({ error: message } satisfies ApiError);
});

function session(username: string): SessionInfo {
  let domain = '';
  try {
    domain = readConfig(repoDir).domain;
  } catch {
    // shown as empty in the UI
  }
  return { username, dryRun, domain };
}

app.listen(port, host, () => {
  const log = consoleLogger();
  log.info(`Infra admin listening on http://${host}:${port} (repo: ${repoDir}${dryRun ? ', DRY RUN' : ''})`);
  if (!fs.existsSync(webDist)) log.info(`No web build at ${webDist}; API only.`);
});

import fs from 'node:fs';
import path from 'node:path';
import type { OpContext } from '../context.js';
import { loadConfig } from '../config.js';
import { compose, ensureBaseLayer, run } from '../exec.js';
import { BASE_FILES, CLEAN_FILES, START_FILES, STOP_FILES } from '../compose-files.js';
import { FRAMEWORKS } from '../gitea.js';

/** Restarts the stopped environment. */
export async function start(ctx: OpContext): Promise<void> {
  const { domain, registryPort } = loadConfig(ctx.repoDir);
  for (const file of START_FILES) {
    if (BASE_FILES.includes(file)) {
      // `up` instead of `start`, so a missing Traefik comes back too
      await ensureBaseLayer(ctx);
      await compose(ctx, file, ['up', '-d'], { GITEA_HOSTNAME: domain, REGISTRY_PORT: registryPort });
    } else {
      await compose(ctx, file, ['start'], { GITEA_HOSTNAME: domain });
    }
  }
}

/** `down` on a compose file without services acts on the whole project, so such files are skipped. */
export function hasServices(repoDir: string, file: string): boolean {
  let lines: string[];
  try {
    lines = fs.readFileSync(path.join(repoDir, file), 'utf8').split(/\r?\n/);
  } catch {
    return false;
  }
  const at = lines.findIndex((l) => /^services:/.test(l));
  if (at < 0 || /^services:\s*\{\s*\}/.test(lines[at])) return false;
  const next = lines.slice(at + 1).find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  return next !== undefined && /^\s/.test(next);
}

/** Stops the environment without removing containers or data. */
export async function stop(ctx: OpContext): Promise<void> {
  const { domain } = loadConfig(ctx.repoDir);
  for (const file of STOP_FILES) await compose(ctx, file, ['stop'], { GITEA_HOSTNAME: domain });
}

/** Tears the environment down completely: containers, data volumes, competitor images and framework clones. */
export async function clean(ctx: OpContext): Promise<void> {
  const { domain, competitors } = loadConfig(ctx.repoDir);

  // -v removes the stacks' named volumes (databases, registry cache, runner state)
  for (const file of CLEAN_FILES) {
    if (hasServices(ctx.repoDir, file)) await compose(ctx, file, ['down', '-v'], { GITEA_HOSTNAME: domain });
    else ctx.log.info(`Skipping ${file}: no services`);
  }

  // Leftover from before the named volumes, when the stacks bind-mounted ./data (written as root)
  if (fs.existsSync(path.join(ctx.repoDir, 'data'))) {
    if (process.getuid?.() === 0) {
      ctx.log.info('Removing ./data');
      if (!ctx.dryRun) fs.rmSync(path.join(ctx.repoDir, 'data'), { recursive: true, force: true });
    } else {
      await run(ctx, 'sudo', ['rm', '-rf', './data']);
    }
  }

  const images = (await run(ctx, 'docker', ['images', '--format', '{{.Repository}}:{{.Tag}} {{.ID}}'], { capture: true }))
    .stdout.split('\n')
    .filter(Boolean)
    .map((line) => line.split(' '));
  for (const { username } of competitors) {
    ctx.log.info(username);
    const ids = [...new Set(images.filter(([ref]) => ref.includes(`/${username}/`)).map(([, id]) => id))];
    if (ids.length) await run(ctx, 'docker', ['rmi', '-f', ...ids]);
  }

  for (const [name] of FRAMEWORKS) {
    if (!ctx.dryRun) fs.rmSync(path.join(ctx.repoDir, name), { recursive: true, force: true });
  }
  ctx.log.info('Environment cleaned.');
}

import fs from 'node:fs';
import path from 'node:path';
import type { OpContext } from '../context.js';
import { loadConfig } from '../config.js';
import { compose, run } from '../exec.js';
import { CLEAN_FILES, START_FILES, STOP_FILES } from '../compose-files.js';
import { FRAMEWORKS } from '../gitea.js';

/** Restarts the stopped environment. */
export async function start(ctx: OpContext): Promise<void> {
  const { domain } = loadConfig(ctx.repoDir);
  for (const file of START_FILES) await compose(ctx, file, ['start'], { GITEA_HOSTNAME: domain });
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
  for (const file of CLEAN_FILES) await compose(ctx, file, ['down', '-v'], { GITEA_HOSTNAME: domain });

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

import path from 'node:path';
import { sleep, throwIfAborted, type OpContext } from '../context.js';
import { loadConfig } from '../config.js';
import { compose, run } from '../exec.js';
import { writeRepoFile } from '../files.js';
import { competitorImage, competitorRoutes, syncedCompetitorsYaml, type CompetitorRepo } from '../generate.js';
import { giteaList } from '../gitea.js';

export const COMPETITORS_COMPOSE = 'competitors.yaml';
export const COMPETITOR_ROUTES = 'config/traefik/competitors.yaml';

/**
 * Brings the competitor containers in line with the competitors' Gitea repositories. Run by the repository
 * webhook (a repo was created or deleted) and from the UI. Port of the former infra-updater service:
 * 1. regenerates competitors.yaml (one Sablier-managed container per repository) and the Traefik routes;
 * 2. pushes an nginx placeholder image for repositories that have no image yet;
 * 3. creates the containers; Sablier starts them on the first request.
 */
export async function syncCompetitors(ctx: OpContext): Promise<void> {
  const cfg = loadConfig(ctx.repoDir);
  const basic: [string, string] = [cfg.username, cfg.password];

  const repos: CompetitorRepo[] = [];
  const withImage = new Set<string>();
  for (const { username } of cfg.competitors) {
    throwIfAborted(ctx.signal);
    const own = (await giteaList(ctx, '/user/repos', { basic, sudo: username }))
      .filter((r) => r?.owner?.username?.toLowerCase() === username.toLowerCase())
      .map((r): CompetitorRepo => ({ owner: r.owner.username, repo: r.name }));
    const packages = await giteaList(ctx, `/packages/${encodeURIComponent(username)}?type=container`, { basic, sudo: username });
    for (const p of packages) withImage.add(`${username.toLowerCase()}/${String(p.name).toLowerCase()}`);
    ctx.log.info(`${username}: ${own.length} repositories, ${packages.length} container images`);
    repos.push(...own);
  }

  writeRepoFile(ctx.repoDir, path.join(ctx.repoDir, COMPETITORS_COMPOSE), syncedCompetitorsYaml(cfg.domain, repos));
  writeRepoFile(ctx.repoDir, path.join(ctx.repoDir, COMPETITOR_ROUTES), competitorRoutes(cfg, repos));
  ctx.log.info(`Wrote ${COMPETITORS_COMPOSE} and ${COMPETITOR_ROUTES} (${repos.length} repositories).`);
  if (repos.length === 0) return;

  const missing = repos.filter((r) => !withImage.has(`${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`));
  if (missing.length) {
    await run(ctx, 'docker', ['login', '-u', cfg.username, '--password-stdin', `git.${cfg.domain}`], { input: cfg.password, quiet: true });
    await run(ctx, 'docker', ['pull', 'nginx:latest'], { quiet: true });
    for (const r of missing) {
      throwIfAborted(ctx.signal);
      const image = competitorImage(cfg.domain, r);
      ctx.log.info(`Pushing placeholder image ${image}`);
      await run(ctx, 'docker', ['tag', 'nginx:latest', `${image}:latest`]);
      await run(ctx, 'docker', ['push', image]);
    }
    // Gives Gitea time to update the image manifest
    await sleep(5_000, ctx.signal);
  }

  await compose(ctx, COMPETITORS_COMPOSE, ['create'], { GITEA_HOSTNAME: cfg.domain });
}

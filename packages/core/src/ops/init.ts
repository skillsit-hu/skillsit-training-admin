import fs from 'node:fs';
import path from 'node:path';
import { throwIfAborted, type OpContext } from '../context.js';
import { loadConfig, writePulldeckEnv } from '../config.js';
import { compose, giteaCli, run } from '../exec.js';
import { INIT_LATE, INIT_POST, INIT_PRE_GITEA, INIT_RUNNERS } from '../compose-files.js';
import { competitorsSql, competitorsYaml, dotEnv } from '../generate.js';
import {
  COMPETITOR_TEAM,
  FRAMEWORKS,
  FRAMEWORK_ORG,
  addUserToTeam,
  createOrg,
  createPat,
  createTeam,
  createWebhook,
  importFramework,
  setCompetitorSecrets,
  waitForGitea,
} from '../gitea.js';

/** Provisions the competition environment from config/main-config.json. */
export async function init(ctx: OpContext): Promise<void> {
  const cfg = loadConfig(ctx.repoDir);
  const secrets = [cfg.password, ...cfg.competitors.map((c) => c.password)];
  const composeEnv: Record<string, string> = {
    GITEA_HOSTNAME: cfg.domain,
    ENABLE_HTTPS: cfg.enableHttps,
    MYSQL_ROOT_PASSWORD: cfg.password,
    ENTRYPOINT: cfg.entrypoint,
    GITEA_PROTOCOL: cfg.protocol,
    REGISTRY_PORT: cfg.registryPort,
    DOMAIN: cfg.domain,
    USERNAME: cfg.username,
    PASSWORD: cfg.password,
  };
  const up = (file: string, ...extra: string[]) => {
    throwIfAborted(ctx.signal);
    return compose(ctx, file, ['up', '-d', ...extra], composeEnv);
  };

  const [traefik, giteaFile] = INIT_PRE_GITEA;
  await up(traefik, '--remove-orphans');
  await up(giteaFile);

  await waitForGitea(ctx);

  await giteaCli(ctx, ['admin', 'user', 'create', '--username', cfg.username, '--password', cfg.password,
    '--email', `${cfg.username}@example.com`, '--admin'], { secrets });

  const registrationToken = (await giteaCli(ctx, ['actions', 'generate-runner-token'], { capture: true })).stdout.trim();
  ctx.log.info(`Registration Token: ${registrationToken}`);
  composeEnv.REGISTRATION_TOKEN = registrationToken;
  await up(INIT_RUNNERS);

  const pulldeckBaseUrl = `${cfg.protocol}://clara.${cfg.domain}`;
  const pulldeckToken = ctx.dryRun ? 'dry-run' : writePulldeckEnv(ctx.repoDir, cfg);

  const token = await createPat(ctx, cfg.username, cfg.password);

  await createOrg(ctx, token, 'images');
  await createOrg(ctx, token, FRAMEWORK_ORG);
  await createTeam(ctx, token, FRAMEWORK_ORG, COMPETITOR_TEAM, false);

  const importCtx = { token, username: cfg.username, password: cfg.password, domain: cfg.domain };
  for (const [name, url] of FRAMEWORKS) {
    throwIfAborted(ctx.signal);
    await importFramework(ctx, importCtx, name, url);
  }

  await run(ctx, 'docker', ['pull', 'nginx:latest'], { quiet: true });
  await run(ctx, 'docker', ['login', '-u', cfg.username, '--password-stdin', `git.${cfg.domain}`], {
    input: cfg.password,
    quiet: true,
  });

  for (const { username: user, password: pass } of cfg.competitors) {
    throwIfAborted(ctx.signal);
    await giteaCli(ctx, ['admin', 'user', 'create', '--username', user, '--password', pass,
      '--email', `${user}@example.com`, '--must-change-password=false'], { secrets });
    await addUserToTeam(ctx, token, FRAMEWORK_ORG, COMPETITOR_TEAM, user);
    await setCompetitorSecrets(ctx, user, pass, pulldeckBaseUrl, pulldeckToken);

    for (const module of cfg.modules) {
      ctx.log.info(`Processing module: ${module} for ${user}`);
      ctx.log.info('pushing inital container');
      const image = `git.${cfg.domain}/${user}/${module}`;
      await run(ctx, 'docker', ['tag', 'nginx:latest', `${image}:latest`]);
      await run(ctx, 'docker', ['push', image]);
    }
  }

  fs.writeFileSync(path.join(ctx.repoDir, 'competitors.yaml'), competitorsYaml(cfg));
  fs.writeFileSync(path.join(ctx.repoDir, 'config/mysql/competitors.sql'), competitorsSql(cfg));

  const [mysql, packagist, verdaccio] = INIT_POST;
  await up(mysql);
  // Packagist mirror for Laravel vendor package caching
  await up(packagist);
  await up(verdaccio);
  // Verdaccio needs write access to its storage to accept package uploads
  await run(ctx, 'chmod', ['-R', '777', './data/verdaccio']);
  const [competitors, pulldeck, sablier, infraUpdater] = INIT_LATE;
  await up(competitors);
  // Pulldeck lets the Gitea Actions redeploy competitors' containers
  await up(pulldeck);
  // Sablier starts competitors' containers on demand (used by infra-updater's Traefik routes)
  await up(sablier);
  await up(infraUpdater);

  await createWebhook(ctx, cfg.domain, cfg.username, cfg.password);

  fs.writeFileSync(path.join(ctx.repoDir, '.env'), dotEnv({
    DOMAIN: cfg.domain,
    ENABLE_HTTPS: cfg.enableHttps,
    USERNAME: cfg.username,
    PASSWORD: cfg.password,
    MODULES: cfg.modules.join(' '),
    GITEA_HOSTNAME: cfg.domain,
    MYSQL_ROOT_PASSWORD: cfg.password,
    ENTRYPOINT: cfg.entrypoint,
    GITEA_PROTOCOL: cfg.protocol,
    REGISTRY_PORT: cfg.registryPort,
    REGISTRATION_TOKEN: registrationToken,
  }));

  ctx.log.info('..all done!');
}

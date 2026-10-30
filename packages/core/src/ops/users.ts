import fs from 'node:fs';
import path from 'node:path';
import { OperationError, type OpContext } from '../context.js';
import { CONFIG_FILE, configSchema, deriveConfig, readConfig, readPulldeckToken, writeConfig, type MainConfig } from '../config.js';
import { giteaCli, run } from '../exec.js';
import { newUserSql } from '../generate.js';
import { COMPETITOR_TEAM, FRAMEWORK_ORG, addUserToTeam, createOrg, createPat, gitea, setCompetitorSecrets } from '../gitea.js';

export interface CreateUserArgs {
  username: string;
  password: string;
  /** Defaults to the username, as create_user.sh did. */
  subdomain?: string;
  name?: string;
}

/**
 * Adds the competitor to config/main-config.json unless an identical entry is already there
 * (the UI may have saved it first). Returns the updated config.
 */
export function addCompetitorToConfig(repoDir: string, args: CreateUserArgs): MainConfig {
  const raw = readConfig(repoDir);
  const existing = raw.competitors.find((c) => c.username === args.username);
  if (existing) {
    if (existing.password !== args.password) throw new OperationError(`User '${args.username}' already exists in ${CONFIG_FILE}`);
    return raw;
  }
  const competitor = { ...(args.name ? { name: args.name } : {}), username: args.username, password: args.password, subdomain: args.subdomain ?? args.username };
  const updated = configSchema.safeParse({ ...raw, competitors: [...raw.competitors, competitor] });
  if (!updated.success) throw new OperationError(updated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  writeConfig(repoDir, updated.data);
  return updated.data;
}

/** Adds a competitor to an already initialised environment. */
export async function createUser(ctx: OpContext, args: CreateUserArgs): Promise<void> {
  const { username: user, password: pass } = args;
  const cfg = deriveConfig(addCompetitorToConfig(ctx.repoDir, args));
  const pulldeckToken = readPulldeckToken(ctx.repoDir);

  await giteaCli(ctx, ['admin', 'user', 'create', '--username', user, '--password', pass,
    '--email', `${user}@example.com`, '--must-change-password=false'], { secrets: [pass] });

  const token = await createPat(ctx, cfg.username, cfg.password);
  await addUserToTeam(ctx, token, FRAMEWORK_ORG, COMPETITOR_TEAM, user);
  await setCompetitorSecrets(ctx, user, pass, `${cfg.protocol}://clara.${cfg.domain}`, pulldeckToken);

  const sql = newUserSql(user, pass);
  fs.appendFileSync(path.join(ctx.repoDir, 'config/mysql/competitors.sql'), sql);
  await run(ctx, 'docker', ['compose', '-f', 'mysql.yaml', 'exec', 'competitor_db', 'mysql',
    `--user=${cfg.username}`, `--password=${cfg.password}`, '-e', sql.replaceAll('\n', '')], { secrets: [cfg.password, pass] });
  ctx.log.info(`User '${user}' created.`);
}

/** Disables the Gitea accounts of all competitors in config/main-config.json (e.g. at the end of a competition). */
export async function disableCompetitorLogins(ctx: OpContext): Promise<void> {
  const cfg = deriveConfig(readConfig(ctx.repoDir));
  const basic: [string, string] = [cfg.username, cfg.password];

  for (const { username } of cfg.competitors) {
    const userPath = `/admin/users/${encodeURIComponent(username)}`;
    const current = await gitea(ctx, 'GET', `/users/${encodeURIComponent(username)}`, { basic });
    if (!current.ok) {
      ctx.log.error(`Failed to retrieve details for user '${username}' (HTTP ${current.status}).`);
      continue;
    }
    if (current.json.active === false) {
      ctx.log.info(`User '${username}' is already disabled.`);
      continue;
    }

    const res = await gitea(ctx, 'PATCH', userPath, {
      basic,
      body: { login_name: current.json.login_name ?? username, source_id: current.json.source_id ?? 0, active: false },
    });
    if (res.status === 200) ctx.log.info(`User '${username}' has been disabled successfully.`);
    else ctx.log.error(`Failed to disable user '${username}'. HTTP status code: ${res.status}`);
  }
}

/** Creates the base Gitea organisations using the root credentials from config/main-config.json. */
export async function setupOrgs(ctx: OpContext): Promise<void> {
  const cfg = deriveConfig(readConfig(ctx.repoDir));
  const token = await createPat(ctx, cfg.username, cfg.password);
  for (const org of ['images', FRAMEWORK_ORG, 'competitionc']) {
    await createOrg(ctx, token, org);
  }
}

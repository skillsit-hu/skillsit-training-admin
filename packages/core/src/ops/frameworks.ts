import { throwIfAborted, type OpContext } from '../context.js';
import { loadConfig } from '../config.js';
import { FRAMEWORK_ORG, createOrg, createPat, gitea, giteaList, importFramework } from '../gitea.js';

/**
 * Brings the Gitea "frameworks" organisation in line with the template list in main-config.json, in a running
 * environment: imports the templates that are missing and deletes the repositories that are no longer listed.
 * Existing templates are left as they are. Repositories competitors created from a template are independent
 * copies, so deleting the template does not affect them.
 */
export async function syncFrameworks(ctx: OpContext): Promise<void> {
  const cfg = loadConfig(ctx.repoDir);
  const token = await createPat(ctx, cfg.username, cfg.password);

  const org = await gitea(ctx, 'GET', `/orgs/${FRAMEWORK_ORG}`, { token });
  if (org.status === 404) await createOrg(ctx, token, FRAMEWORK_ORG);

  const existing = new Set((await giteaList(ctx, `/orgs/${FRAMEWORK_ORG}/repos`, { token })).map((r) => String(r.name).toLowerCase()));
  const wanted = new Set(cfg.frameworks.map((f) => f.name));

  const importCtx = { token, username: cfg.username, password: cfg.password, domain: cfg.domain };
  let imported = 0;
  for (const framework of cfg.frameworks) {
    throwIfAborted(ctx.signal);
    if (existing.has(framework.name)) {
      ctx.log.info(`${framework.name}: already in Gitea, skipped.`);
      continue;
    }
    await importFramework(ctx, importCtx, framework);
    imported++;
  }

  let deleted = 0;
  for (const name of existing) {
    if (wanted.has(name)) continue;
    throwIfAborted(ctx.signal);
    const res = await gitea(ctx, 'DELETE', `/repos/${FRAMEWORK_ORG}/${encodeURIComponent(name)}`, { token });
    if (res.ok || ctx.dryRun) {
      ctx.log.info(`${name}: no longer in the list, deleted from Gitea.`);
      deleted++;
    } else {
      ctx.log.error(`Deleting ${FRAMEWORK_ORG}/${name} failed (HTTP ${res.status}): ${res.text}`);
    }
  }

  ctx.log.info(`Framework templates synced: ${imported} imported, ${deleted} deleted, ${cfg.frameworks.length - imported} unchanged.`);
}

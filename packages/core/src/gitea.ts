import fs from 'node:fs';
import path from 'node:path';
import { OperationError, sleep, type OpContext } from './context.js';
import { run } from './exec.js';

// API calls stay on the local Gitea port. The public hostname goes through
// Traefik, which can hang once the runners start.
export const GITEA_API = process.env.GITEA_API_URL ?? 'http://127.0.0.1:3000';
export const FRAMEWORK_ORG = 'frameworks';
export const COMPETITOR_TEAM = 'competitors';

// [repo name, template source]; the repo name is also the local clone directory.
export const FRAMEWORKS: [string, string][] = [
  ['laravel', 'https://github.com/sitc2026-templates/ws26-laravel.git'],
  ['vanilla', 'https://github.com/sitc2026-templates/ws26-vanilla.git'],
  ['nuxtjs', 'https://github.com/sitc2026-templates/ws26-nuxtjs.git'],
  ['nextjs', 'https://github.com/sitc2026-templates/ws26-nextjs.git'],
  ['nextjs-prisma', 'https://github.com/sitc2026-templates/ws26-nextjs-prisma.git'],
  ['expressjs', 'https://github.com/sitc2026-templates/ws26-expressjs.git'],
  ['prisma', 'https://github.com/sitc2026-templates/ws26-prisma.git'],
  ['zurb-foundation', 'https://github.com/sitc2026-templates/ws26-zurb-foundation.git'],
  ['vuejs', 'https://github.com/sitc2026-templates/ws26-vuejs.git'],
  ['reactjs', 'https://github.com/sitc2026-templates/ws26-reactjs.git'],
  ['bootstrap', 'https://github.com/sitc2026-templates/ws26-bootstrap.git'],
  ['angular', 'https://github.com/sitc2026-templates/ws26-angular.git'],
  ['tailwindcss', 'https://github.com/sitc2026-templates/ws26-tailwindcss.git'],
];

const TOKEN_NAME = 'CreateOrganizationScript';
// Must match WEBHOOK_SECRET in infra-updater.yaml
const WEBHOOK_SECRET = 'GFW8Mq5ANOsK';
const WORKFLOW_FILE = '.gitea/workflows/docker-ci.yaml';
const TEMPLATE_REGISTRY_HOST = 'git.sitc.skillsit.eu';
const TEMPLATE_PULLDECK_URL = 'https://pulldeck.sitc.skillsit.eu';

export interface GiteaResponse {
  ok: boolean;
  status: number;
  json: any;
  text: string;
}

interface GiteaRequest {
  token?: string;
  basic?: [string, string];
  body?: unknown;
  timeout?: number;
}

export async function gitea(
  ctx: OpContext,
  method: string,
  apiPath: string,
  { token, basic, body, timeout = 60_000 }: GiteaRequest = {},
): Promise<GiteaResponse> {
  if (ctx.dryRun) {
    ctx.log.info(`[dry-run] ${method} ${GITEA_API}/api/v1${apiPath}`);
    return { ok: true, status: 200, json: { id: 1, sha1: 'dry-run-token', active: true, data: [] }, text: '' };
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `token ${token}`;
  if (basic) headers.Authorization = `Basic ${Buffer.from(`${basic[0]}:${basic[1]}`).toString('base64')}`;
  const signals = [AbortSignal.timeout(timeout), ...(ctx.signal ? [ctx.signal] : [])];
  try {
    const res = await fetch(`${GITEA_API}/api/v1${apiPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any(signals),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // non-JSON response
    }
    return { ok: res.ok, status: res.status, json, text };
  } catch (err) {
    if (ctx.signal?.aborted) throw new OperationError('Cancelled');
    return { ok: false, status: 0, json: null, text: (err as Error).message };
  }
}

function reportFailure(ctx: OpContext, what: string, res: GiteaResponse): void {
  ctx.log.error(`${what} failed (HTTP ${res.status}): ${res.text}`);
}

export async function waitForGitea(ctx: OpContext): Promise<void> {
  const retries = 10;
  for (let count = 0; ; count++) {
    const res = await gitea(ctx, 'GET', '/version', { timeout: 5_000 });
    if (res.status !== 0) return;
    if (count >= retries) throw new OperationError('Gitea did not become ready in time.');
    ctx.log.info('Waiting for Gitea to be ready...');
    await sleep(5_000, ctx.signal);
  }
}

export async function createPat(ctx: OpContext, username: string, password: string): Promise<string> {
  ctx.log.info('Creating Gitea access token...');
  const basic: [string, string] = [username, password];
  await gitea(ctx, 'DELETE', `/users/${encodeURIComponent(username)}/tokens/${TOKEN_NAME}`, { basic, timeout: 30_000 });
  const res = await gitea(ctx, 'POST', `/users/${encodeURIComponent(username)}/tokens`, {
    basic,
    timeout: 30_000,
    body: {
      name: TOKEN_NAME,
      scopes: ['read:admin', 'write:organization', 'write:repository', 'write:user'],
    },
  });
  // Gitea 1.21 returns the secret in "sha1".
  const token = String(res.json?.sha1 ?? res.json?.token ?? '').trim();
  if (!token) throw new OperationError(`Failed to create Gitea access token. Response: ${res.text}`);
  return token;
}

export async function createOrg(ctx: OpContext, token: string, name: string): Promise<void> {
  const res = await gitea(ctx, 'POST', '/orgs', { token, body: { username: name, full_name: name } });
  if (res.ok) ctx.log.info(`Organization '${name}' created.`);
  else reportFailure(ctx, `Creating organization '${name}'`, res);
}

export async function createTeam(ctx: OpContext, token: string, org: string, name: string, canCreateOrgRepo: boolean): Promise<void> {
  const res = await gitea(ctx, 'POST', `/orgs/${org}/teams`, {
    token,
    body: {
      name,
      can_create_org_repo: canCreateOrgRepo,
      units_map: {
        'repo.actions': 'read',
        'repo.packages': 'none',
        'repo.code': 'write',
        'repo.issues': 'write',
        'repo.ext_issues': 'none',
        'repo.wiki': 'admin',
        'repo.pulls': 'owner',
        'repo.releases': 'none',
        'repo.projects': 'none',
        'repo.ext_wiki': 'none',
      },
    },
  });
  if (res.ok && res.json?.id) ctx.log.info(`Created team ID: ${res.json.id}`);
  else reportFailure(ctx, `Creating team '${name}'`, res);
}

export async function addUserToTeam(ctx: OpContext, token: string, org: string, teamName: string, user: string): Promise<void> {
  const search = await gitea(ctx, 'GET', `/orgs/${org}/teams/search?q=${encodeURIComponent(teamName)}`, { token });
  const team = search.json?.data?.find((t: { name: string }) => t.name === teamName) ?? (ctx.dryRun ? { id: 1 } : undefined);
  if (!team) {
    reportFailure(ctx, `Looking up team '${teamName}' in '${org}'`, search);
    return;
  }
  const res = await gitea(ctx, 'PUT', `/teams/${team.id}/members/${encodeURIComponent(user)}`, { token });
  if (res.status === 204 || ctx.dryRun) ctx.log.info(`User '${user}' added to team '${teamName}' in organization '${org}'.`);
  else reportFailure(ctx, `Adding '${user}' to team '${teamName}'`, res);
}

async function setUserSecret(ctx: OpContext, user: string, pass: string, name: string, value: string): Promise<boolean> {
  const res = await gitea(ctx, 'PUT', `/user/actions/secrets/${name}`, { basic: [user, pass], body: { data: value } });
  if (!res.ok) reportFailure(ctx, `Setting secret ${name} for ${user}`, res);
  return res.ok;
}

export async function setCompetitorSecrets(
  ctx: OpContext,
  user: string,
  pass: string,
  pulldeckBaseUrl: string,
  pulldeckToken: string,
): Promise<void> {
  ctx.log.info(`Creating user-level secrets for ${user}...`);
  if ((await setUserSecret(ctx, user, pass, 'USER', user)) && (await setUserSecret(ctx, user, pass, 'PASS', pass))) {
    ctx.log.info(`✓ Created USER and PASS secrets for ${user}`);
  }
  if ((await setUserSecret(ctx, user, pass, 'PULLDECK_BASE_URL', pulldeckBaseUrl))
    && (await setUserSecret(ctx, user, pass, 'PULLDECK_TOKEN', pulldeckToken))) {
    ctx.log.info(`✓ Created Pulldeck secrets for ${user}`);
  }
}

export async function createWebhook(ctx: OpContext, domain: string, username: string, password: string): Promise<void> {
  const res = await gitea(ctx, 'POST', '/admin/hooks', {
    basic: [username, password],
    body: {
      type: 'gitea',
      branch_filter: '*',
      config: {
        content_type: 'json',
        url: `https://infra-updater.${domain}/update`,
        secret: WEBHOOK_SECRET,
        is_system_webhook: 'true',
      },
      events: ['repository'],
      authorization_header: '',
      active: true,
    },
  });
  if (res.ok) ctx.log.info('Infra updater webhook created.');
  else reportFailure(ctx, 'Creating infra updater webhook', res);
}

export interface ImportContext {
  token: string;
  username: string;
  password: string;
  domain: string;
}

export async function importFramework(ctx: OpContext, { token, username, password, domain }: ImportContext, name: string, githubUrl: string): Promise<void> {
  const giteaHost = `git.${domain}`;
  const dir = path.join(ctx.repoDir, name);
  // A previous failed import leaves this directory behind.
  if (!ctx.dryRun) fs.rmSync(dir, { recursive: true, force: true });
  if (!(await run(ctx, 'git', ['clone', githubUrl, name])).ok) return ctx.log.error(`Failed to clone ${githubUrl}.`);

  const workflowPath = path.join(dir, WORKFLOW_FILE);
  if (!ctx.dryRun) {
    if (!fs.existsSync(workflowPath)) return ctx.log.error(`Workflow file ${WORKFLOW_FILE} not found in ${name}.`);
    // The pulldeck URL comes from each user's PULLDECK_BASE_URL secret.
    const workflow = fs
      .readFileSync(workflowPath, 'utf8')
      .replaceAll(TEMPLATE_REGISTRY_HOST, () => giteaHost)
      .replaceAll(TEMPLATE_PULLDECK_URL, () => '${{ secrets.PULLDECK_BASE_URL }}');
    fs.writeFileSync(workflowPath, workflow);
  }

  const git = (...args: string[]) => run(ctx, 'git', args, { cwd: name });
  await git('config', 'user.name', 'Digitalent');
  await git('config', 'user.email', 'info@skillsit.hu');
  await git('add', WORKFLOW_FILE);
  await git('commit', '-m', 'Update Docker registry URL in Gitea Action');

  const res = await gitea(ctx, 'POST', `/orgs/${FRAMEWORK_ORG}/repos`, {
    token,
    body: { name, private: false, template: true },
  });
  if (!res.json?.id) return reportFailure(ctx, `Creating repository ${name} on Gitea`, res);
  ctx.log.info(`Repository ${name} created in the ${FRAMEWORK_ORG} organization on Gitea.`);

  const remote = `https://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${giteaHost}/${FRAMEWORK_ORG}/${name}.git`;
  const secrets = [encodeURIComponent(password), password];
  await run(ctx, 'git', ['remote', 'add', 'gitea', remote], { cwd: name, secrets });
  const pushed = (await run(ctx, 'git', ['push', 'gitea', 'main'], { cwd: name, env: { GIT_TERMINAL_PROMPT: '0' }, secrets })).ok;
  if (pushed) ctx.log.info(`Repository ${name} pushed to the ${FRAMEWORK_ORG} organization on Gitea with updated GitHub Action!`);
  else ctx.log.error(`Failed to push ${name} to Gitea.`);
}

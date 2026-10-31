import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { competitorHost, configSchema, deriveConfig, readConfig, readPulldeckToken, routingEnv, writeAdminRoute, writeConfig, writePulldeckEnv } from '../src/config.js';
import { competitorRoutes, competitorsSql, competitorsYaml, syncedCompetitorsYaml } from '../src/generate.js';
import { verifyWebhookSignature, webhookSecret } from '../src/webhook.js';
import { BASE_FILES, CLEAN_FILES, STOP_FILES } from '../src/compose-files.js';
import { addCompetitorToConfig } from '../src/ops/users.js';
import { hasServices } from '../src/ops/lifecycle.js';

const sample = {
  domain: 'local.skill17.com',
  enableHttps: true,
  username: 'root',
  password: 'change-me',
  modules: ['module_a'],
  competitors: [{ username: 'comp01', password: 'test123', subdomain: 'qwer' }],
};

function tempRepo(config: unknown = sample): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infra-core-'));
  fs.mkdirSync(path.join(dir, 'config'));
  fs.writeFileSync(path.join(dir, 'config/main-config.json'), JSON.stringify(config));
  return dir;
}

describe('deriveConfig', () => {
  it('maps enableHttps to entrypoint, protocol and registry port', () => {
    expect(deriveConfig(configSchema.parse(sample))).toMatchObject({ enableHttps: 'true', entrypoint: 'websecure', protocol: 'https', registryPort: '443' });
    expect(deriveConfig(configSchema.parse({ ...sample, enableHttps: 'false' }))).toMatchObject({ enableHttps: 'false', entrypoint: 'web', protocol: 'http', registryPort: '5000' });
  });

  it("uses the Let's Encrypt resolver only with HTTPS on", () => {
    expect(deriveConfig(configSchema.parse(sample)).certResolver).toBe('');
    const le = deriveConfig(configSchema.parse({ ...sample, letsencrypt: true, acmeEmail: 'ops@example.com' }));
    expect(routingEnv(le)).toEqual({ GITEA_HOSTNAME: 'local.skill17.com', REGISTRY_PORT: '443', CERT_RESOLVER: 'letsencrypt', ACME_EMAIL: 'ops@example.com', ACME_CA_SERVER: '' });
    expect(deriveConfig(configSchema.parse({ ...sample, letsencrypt: true, enableHttps: false })).certResolver).toBe('');
    expect(configSchema.safeParse({ ...sample, acmeEmail: 'nope' }).success).toBe(false);
  });
});

describe('competitorHost', () => {
  it("builds a Let's Encrypt-valid hostname (no '_', lowercase)", () => {
    expect(competitorHost('Comp_01', 'module_a', 'example.com')).toBe('comp-01-module-a.example.com');
  });
});

describe('generated files', () => {
  it('matches the output of the original init script', () => {
    const cfg = deriveConfig(configSchema.parse(sample));
    expect(competitorsYaml(cfg)).toBe(`services:
  comp01_module_a:
    image: git.local.skill17.com/comp01/module_a:latest
    container_name: comp01_module_a
    restart: always
    networks:
      - gitea
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.comp01_module_a.rule=Host(\`comp01-module-a.local.skill17.com\`)"
      - "traefik.http.routers.comp01_module_a.entrypoints=websecure"
      - "traefik.http.routers.comp01_module_a.tls=true"
      - "traefik.http.routers.comp01_module_a.tls.certresolver="
      - "traefik.http.services.comp01_module_a.loadbalancer.server.port=80"

networks:
  gitea:
    external: true
`);
    expect(competitorsSql(cfg)).toBe(`  CREATE DATABASE IF NOT EXISTS \`comp01_module_a\`;
  CREATE USER IF NOT EXISTS 'comp01'@'%' IDENTIFIED BY 'test123';
  GRANT ALL PRIVILEGES ON *.* TO 'comp01'@'%';
`);
  });

  it('has no services without modules', () => {
    const cfg = deriveConfig(configSchema.parse({ ...sample, modules: [] }));
    expect(competitorsYaml(cfg)).toBe('services:\n\nnetworks:\n  gitea:\n    external: true\n');
  });
});

describe('config schema', () => {
  it('rejects duplicate competitors and unsafe values', () => {
    const dup = { ...sample, competitors: [sample.competitors[0], sample.competitors[0]] };
    expect(configSchema.safeParse(dup).success).toBe(false);
    expect(configSchema.safeParse({ ...sample, password: "it's" }).success).toBe(false);
    expect(configSchema.safeParse({ ...sample, modules: ['bad name'] }).success).toBe(false);
  });

  it('keeps unknown fields such as competitor names', () => {
    const parsed = configSchema.parse({ ...sample, extra: 1, competitors: [{ ...sample.competitors[0], name: 'Comp One' }] });
    expect(parsed).toMatchObject({ extra: 1, competitors: [{ name: 'Comp One' }] });
  });
});

describe('config file', () => {
  it('round-trips through writeConfig', () => {
    const dir = tempRepo();
    const cfg = readConfig(dir);
    writeConfig(dir, { ...cfg, domain: 'example.com' });
    expect(readConfig(dir).domain).toBe('example.com');
    expect(fs.readdirSync(path.join(dir, 'config'))).toEqual(['main-config.json']);
  });

  it('adds a competitor', () => {
    const dir = tempRepo();
    addCompetitorToConfig(dir, { username: 'comp02', password: 'pw' });
    expect(readConfig(dir).competitors.at(-1)).toEqual({ username: 'comp02', password: 'pw' });
  });

  it('accepts a competitor already saved with the same password, rejects a different one', () => {
    const dir = tempRepo();
    expect(() => addCompetitorToConfig(dir, { username: 'comp01', password: 'test123' })).not.toThrow();
    expect(readConfig(dir).competitors).toHaveLength(1);
    expect(() => addCompetitorToConfig(dir, { username: 'comp01', password: 'other' })).toThrow(/already exists/);
  });
});

describe('compose stacks', () => {
  it('never stops or removes the base layer', () => {
    for (const file of BASE_FILES) {
      expect(STOP_FILES).not.toContain(file);
      expect(CLEAN_FILES).not.toContain(file);
    }
    expect([...STOP_FILES, ...CLEAN_FILES]).not.toContain('admin.yaml');
  });
});

describe('pulldeck env', () => {
  it('generates the token once and follows the root credentials', () => {
    const dir = tempRepo();
    fs.writeFileSync(path.join(dir, 'pulldeck.env'), 'DOCKER_USERNAME=old\nDOCKER_PASSWORD=stale\nEXTRA=1\n');
    const token = writePulldeckEnv(dir, deriveConfig(configSchema.parse(sample)));
    expect(token).toMatch(/^[\w-]{20,}$/);
    expect(writePulldeckEnv(dir, deriveConfig(configSchema.parse(sample)))).toBe(token);
    expect(readPulldeckToken(dir)).toBe(token);
    const env = fs.readFileSync(path.join(dir, 'pulldeck.env'), 'utf8');
    expect(env).toContain('DOCKER_USERNAME=root\n');
    expect(env).toContain('DOCKER_PASSWORD=change-me\n');
    expect(env).toContain('EXTRA=1\n');
    expect(env).toContain('DOCKER_MANAGER_RUNNING_IN_CONTAINER=true\n');
  });
});

describe('hasServices', () => {
  it('treats compose files without services as empty (down would hit the whole project)', () => {
    const dir = tempRepo();
    const write = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);
    write('empty-generated.yaml', competitorsYaml(deriveConfig(configSchema.parse({ ...sample, modules: [] }))));
    write('empty-braces.yaml', 'services: {}\nnetworks:\n  gitea:\n    external: true\n');
    write('real.yaml', competitorsYaml(deriveConfig(configSchema.parse(sample))));
    expect(hasServices(dir, 'empty-generated.yaml')).toBe(false);
    expect(hasServices(dir, 'empty-braces.yaml')).toBe(false);
    expect(hasServices(dir, 'missing.yaml')).toBe(false);
    expect(hasServices(dir, 'real.yaml')).toBe(true);
  });
});

describe('syncCompetitors output', () => {
  const repos = [{ owner: 'Comp01', repo: 'module_a' }];

  it('writes one Sablier-managed service per repository', () => {
    const yaml = syncedCompetitorsYaml('local.skill17.com', repos);
    expect(yaml).toContain('  Comp01_module_a:\n    image: git.local.skill17.com/comp01/module_a:latest\n');
    expect(yaml).toContain('"sablier.group=Comp01_module_a"');
    const dir = tempRepo();
    fs.writeFileSync(path.join(dir, 'empty.yaml'), syncedCompetitorsYaml('x.com', []));
    expect(hasServices(dir, 'empty.yaml')).toBe(false);
  });

  it('routes each repository through Sablier, with the cert resolver when Let\'s Encrypt is on', () => {
    const cfg = deriveConfig(configSchema.parse({ ...sample, letsencrypt: true }));
    const routes = JSON.parse(competitorRoutes(cfg, repos).replace(/^#.*\n/, ''));
    expect(routes.http.routers.Comp01_module_a).toEqual({
      rule: 'Host(`comp01-module-a.local.skill17.com`)',
      entryPoints: ['websecure'],
      middlewares: ['sablier-Comp01_module_a@file'],
      tls: { certResolver: 'letsencrypt' },
      service: 'Comp01_module_a',
    });
    expect(routes.http.services.Comp01_module_a.loadBalancer.servers[0].url).toBe('http://Comp01_module_a:80');
    expect(competitorRoutes(cfg, [])).toBe('');
  });
});

describe('webhook', () => {
  it('generates the secret once and verifies Gitea signatures', () => {
    const dir = tempRepo();
    const secret = webhookSecret(dir);
    expect(webhookSecret(dir)).toBe(secret);
    const body = Buffer.from('{"action":"created"}');
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyWebhookSignature(secret, body, signature)).toBe(true);
    expect(verifyWebhookSignature(secret, Buffer.from('{}'), signature)).toBe(false);
    expect(verifyWebhookSignature(secret, body, 'zz')).toBe(false);
  });
});

describe('admin route', () => {
  it('follows the domain and the Let\'s Encrypt setting', () => {
    const dir = tempRepo({ ...sample, letsencrypt: true });
    fs.mkdirSync(path.join(dir, 'config/traefik'));
    writeAdminRoute(dir);
    const route = JSON.parse(fs.readFileSync(path.join(dir, 'config/traefik/admin.yaml'), 'utf8').replace(/^#.*\n/, ''));
    expect(route.http.routers['infra-admin']).toMatchObject({ rule: 'Host(`admin.local.skill17.com`)', tls: { certResolver: 'letsencrypt' } });
    expect(route.http.services['infra-admin'].loadBalancer.servers[0].url).toBe('http://infra-admin:8090');
    writeAdminRoute(dir, deriveConfig(configSchema.parse(sample)));
    expect(fs.readFileSync(path.join(dir, 'config/traefik/admin.yaml'), 'utf8')).toContain('"tls": {}');
  });
});

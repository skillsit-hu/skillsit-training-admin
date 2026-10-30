import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configSchema, deriveConfig, readConfig, readPulldeckToken, writeConfig, writePulldeckEnv } from '../src/config.js';
import { competitorsSql, competitorsYaml } from '../src/generate.js';
import { BASE_FILES, CLEAN_FILES, STOP_FILES } from '../src/compose-files.js';
import { addCompetitorToConfig } from '../src/ops/users.js';

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
});

describe('generated files', () => {
  it('matches the output of the previous init.mjs', () => {
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
      - "traefik.http.routers.comp01_module_a.rule=Host(\`qwer-module_a.local.skill17.com\`)"
      - "traefik.http.routers.comp01_module_a.entrypoints=websecure"
      - "traefik.http.routers.comp01_module_a.tls=true"
      - "traefik.http.services.comp01_module_a.loadbalancer.server.port=80"
      - "com.centurylinklabs.watchtower.enable=true"

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

  it('adds a competitor with the username as subdomain', () => {
    const dir = tempRepo();
    addCompetitorToConfig(dir, { username: 'comp02', password: 'pw' });
    expect(readConfig(dir).competitors.at(-1)).toEqual({ username: 'comp02', password: 'pw', subdomain: 'comp02' });
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

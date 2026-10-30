import fs from 'node:fs';
import path from 'node:path';
import { OperationError } from './context.js';
import { configSchema, type Competitor, type MainConfig } from './schema.js';

export * from './schema.js';

export const CONFIG_FILE = 'config/main-config.json';

export interface DerivedConfig {
  domain: string;
  enableHttps: 'true' | 'false';
  username: string;
  password: string;
  modules: string[];
  competitors: Competitor[];
  entrypoint: 'websecure' | 'web';
  protocol: 'https' | 'http';
  registryPort: '443' | '5000';
}

export function readConfig(repoDir: string): MainConfig {
  const file = path.join(repoDir, CONFIG_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new OperationError(`Could not read ${CONFIG_FILE}: ${(err as Error).message}`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OperationError(`Invalid ${CONFIG_FILE}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

/** Writes via a temp file + rename; infra-updater mounts the whole config dir, so the new inode is picked up. */
export function writeConfig(repoDir: string, config: MainConfig): void {
  const file = path.join(repoDir, CONFIG_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function deriveConfig(config: MainConfig): DerivedConfig {
  const https = config.enableHttps === true || config.enableHttps === 'true';
  return {
    domain: config.domain,
    enableHttps: https ? 'true' : 'false',
    username: config.username,
    password: config.password,
    modules: config.modules,
    competitors: config.competitors,
    entrypoint: https ? 'websecure' : 'web',
    protocol: https ? 'https' : 'http',
    registryPort: https ? '443' : '5000',
  };
}

export function loadConfig(repoDir: string): DerivedConfig {
  return deriveConfig(readConfig(repoDir));
}

// Pulldeck is served at clara.<domain> (see pulldeck.yaml) and checks AUTH_TOKEN from .env.clara
export function readPulldeckToken(repoDir: string): string {
  let contents = '';
  try {
    contents = fs.readFileSync(path.join(repoDir, '.env.clara'), 'utf8');
  } catch {
    // handled below
  }
  const line = contents.split(/\r?\n/).find((l) => l.startsWith('AUTH_TOKEN='));
  const token = line?.slice('AUTH_TOKEN='.length).trim();
  if (!token) throw new OperationError('AUTH_TOKEN not found in .env.clara');
  return token;
}

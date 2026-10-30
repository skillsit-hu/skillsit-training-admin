import type { OpContext } from './context.js';
import { run } from './exec.js';

export interface ContainerStatus {
  name: string;
  image: string;
  state: string;
  status: string;
  /** Compose file the container belongs to, e.g. "gitea.yaml". */
  stack: string | null;
}

export async function containerStatus(ctx: OpContext): Promise<ContainerStatus[]> {
  if (ctx.dryRun) return [];
  const res = await run(ctx, 'docker', ['ps', '-a', '--no-trunc', '--format', '{{json .}}'], { capture: true, quiet: true, check: true });
  return res.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, string>)
    .map((c) => {
      const labels = Object.fromEntries(
        (c.Labels ?? '').split(',').filter(Boolean).map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]),
      );
      const configFiles = labels['com.docker.compose.project.config_files'];
      return {
        name: c.Names,
        image: c.Image,
        state: c.State,
        status: c.Status,
        stack: configFiles ? (configFiles.split(/[\\/]/).pop() ?? null) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

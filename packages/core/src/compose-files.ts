// Every docker compose stack managed by the operations, in one place.
//
// The base layer is traefik.yaml + admin.yaml, started by install.sh. stop and clean leave it running so the
// admin UI (served through Traefik at admin.<domain>) stays reachable. admin.yaml is its own compose project
// (`name: infra-admin`), so `--remove-orphans` on the other stacks can't remove it.

/** Started by install.sh; init re-applies it so a changed HTTPS setting takes effect. */
export const BASE_FILES = ['traefik.yaml'];

/** `up -d` order used by init. traefik.yaml creates the shared `gitea` network, so it comes first. */
export const INIT_PRE_GITEA = ['traefik.yaml', 'gitea.yaml'];
export const INIT_RUNNERS = 'gitea-runner.yaml';
export const INIT_POST = ['mysql.yaml', 'packagist.yaml', 'watchtower.yaml', 'verdaccio.yaml'];
export const INIT_LATE = ['competitors.yaml', 'pulldeck.yaml', 'sablier.yaml', 'infra-updater.yaml'];

export const START_FILES = ['traefik.yaml', 'gitea.yaml', 'gitea-runner.yaml', 'mysql.yaml', 'packagist.yaml',
  'verdaccio.yaml', 'infra-updater.yaml'];

export const STOP_FILES = ['gitea-runner.yaml', 'gitea.yaml', 'watchtower.yaml', 'verdaccio.yaml',
  'packagist.yaml', 'infra-updater.yaml'];

export const CLEAN_FILES = ['watchtower.yaml', 'competitors.yaml', 'pulldeck.yaml', 'sablier.yaml', 'mysql.yaml',
  'packagist.yaml', 'gitea-runner.yaml', 'gitea.yaml', 'verdaccio.yaml', 'infra-updater.yaml'];

export const ALL_STACKS = [...new Set([...INIT_PRE_GITEA, INIT_RUNNERS, ...INIT_POST, ...INIT_LATE])];

// Every docker compose stack managed by the operations, in one place.
//
// The base layer is traefik.yaml + admin.yaml, started by install.sh. stop and clean leave it running so the
// admin UI (served through Traefik at admin.<domain>) stays reachable. Both are their own compose projects
// (infra-traefik, infra-admin): `--remove-orphans`, or `down` on a file without services (which acts on the
// whole project), on the infra stacks must not reach them.

/** Started by install.sh; init re-applies it so a changed HTTPS setting takes effect. */
export const BASE_FILES = ['traefik.yaml'];
/** Compose project of BASE_FILES (`name:` in traefik.yaml). */
export const BASE_PROJECT = 'infra-traefik';
/** Shared network; created with `docker network create` so no compose project owns (and removes) it. */
export const SHARED_NETWORK = 'gitea';

/** `up -d` order used by init. traefik.yaml creates the shared `gitea` network, so it comes first. */
export const INIT_PRE_GITEA = ['traefik.yaml', 'gitea.yaml'];
export const INIT_RUNNERS = 'gitea-runner.yaml';
export const INIT_POST = ['mysql.yaml', 'packagist.yaml', 'verdaccio.yaml'];
export const INIT_LATE = ['competitors.yaml', 'pulldeck.yaml', 'sablier.yaml', 'infra-updater.yaml'];

export const START_FILES = ['traefik.yaml', 'gitea.yaml', 'gitea-runner.yaml', 'mysql.yaml', 'packagist.yaml',
  'verdaccio.yaml', 'infra-updater.yaml'];

export const STOP_FILES = ['gitea-runner.yaml', 'gitea.yaml', 'verdaccio.yaml',
  'packagist.yaml', 'infra-updater.yaml'];

export const CLEAN_FILES = ['competitors.yaml', 'pulldeck.yaml', 'sablier.yaml', 'mysql.yaml',
  'packagist.yaml', 'gitea-runner.yaml', 'gitea.yaml', 'verdaccio.yaml', 'infra-updater.yaml'];

export const ALL_STACKS = [...new Set([...INIT_PRE_GITEA, INIT_RUNNERS, ...INIT_POST, ...INIT_LATE])];

// Every docker compose stack managed by the operations, in one place.
// admin.yaml is deliberately missing: the admin UI has to survive stop/clean.

/** `up -d` order used by init. traefik.yaml creates the shared `gitea` network, so it comes first. */
export const INIT_PRE_GITEA = ['traefik.yaml', 'gitea.yaml'];
export const INIT_RUNNERS = 'gitea-runner.yaml';
export const INIT_POST = ['mysql.yaml', 'packagist.yaml', 'watchtower.yaml', 'verdaccio.yaml'];
export const INIT_LATE = ['competitors.yaml', 'pulldeck.yaml', 'sablier.yaml', 'infra-updater.yaml'];

export const START_FILES = ['traefik.yaml', 'gitea.yaml', 'gitea-runner.yaml', 'mysql.yaml', 'packagist.yaml',
  'verdaccio.yaml', 'infra-updater.yaml'];

export const STOP_FILES = ['gitea-runner.yaml', 'gitea.yaml', 'traefik.yaml', 'watchtower.yaml', 'verdaccio.yaml',
  'packagist.yaml', 'infra-updater.yaml'];

export const CLEAN_FILES = ['watchtower.yaml', 'competitors.yaml', 'pulldeck.yaml', 'sablier.yaml', 'mysql.yaml',
  'packagist.yaml', 'gitea-runner.yaml', 'gitea.yaml', 'verdaccio.yaml', 'infra-updater.yaml', 'traefik.yaml'];

export const ALL_STACKS = [...new Set([...INIT_PRE_GITEA, INIT_RUNNERS, ...INIT_POST, ...INIT_LATE])];

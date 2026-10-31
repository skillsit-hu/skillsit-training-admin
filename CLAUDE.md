# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

This repo holds the admin app of [skillsit-training-infra](https://github.com/skillsit-hu/skillsit-training-infra): a TypeScript npm-workspaces project with the provisioning logic, an Express REST API and a React/shadcn UI.
- The infra repo holds the Docker Compose stacks, `admin.yaml` and `install.sh`.
- This app runs as the `infra-admin` container. It operates on an infra checkout that is mounted at `REPO_DIR`.
- GitHub Actions publishes the image as `ghcr.io/skillsit-hu/skillsit-training-admin` (`.github/workflows/docker.yml`).
- The app was split out of the infra repo's `app/` directory with its history. The original bash scripts that the ops port are in infra commit `bda7a60`.

## Commands

- `npm ci && npm run build`: builds core, then server, then web.
- `npm test`: Vitest tests for core (`packages/core/test`). Run a single test with `npm test -w @infra/core -- -t "<name>"`.
- `npm run typecheck`
- `npm run dev`: core `tsc --watch`, the server via `tsx watch` on :8090, and Vite on :5173 (it proxies `/api`).
  - `REPO_DIR=<infra checkout>` is required. Add `DRY_RUN=1` to log every docker/git command and Gitea request instead of executing it.
  - Run it inside WSL with a Linux Node. With the Windows Node, the Windows `docker.exe` gets spawned instead.
- shadcn components: from `packages/web`, run `npx shadcn@latest add <name>`.
- Image: `docker build .`. The build stage runs on `$BUILDPLATFORM`, because the runtime dependencies are pure JS. Only the runtime stage (the docker CLI, compose and git) is built per platform (amd64, arm64).

## Architecture

**`@infra/core`** (`packages/core`) has no Express or React dependency.
- Every operation in `src/ops/` takes an `OpContext` (`{ repoDir, log, signal?, dryRun? }`) and never calls `chdir`.
- `run()` in `exec.ts` is an async `spawn`. It streams lines to `ctx.log` and masks any value passed in `secrets`.
- `compose()` sets `INFRA_DIR=<repoDir>` and the compose project: `infra` for the stacks, and `infra-traefik` for `BASE_FILES`.
- Fatal errors throw `OperationError`.
- `ops/index.ts` holds the `OPERATIONS` registry. Each entry has a zod argument schema, the argument names in display order (`cliArgs`), a `destructive` flag, and a `docker` flag (`ensureDocker` pre-check). The server and the UI are both driven by this registry.
- `schema.ts` (config schema) and `api.ts` (REST types) are browser-safe subpath exports, used by the web app.
- `compose-files.ts` lists the infra repo's stacks in start/stop/clean/init order. Keep it in sync with the compose files there.

**`@infra/server`** (`packages/server`)
- Login checks against `username`/`password` in `<REPO_DIR>/config/main-config.json`. The session is an HMAC-signed cookie whose key includes the root password, so a password change logs everyone out.
- `trust proxy` is 1, because Traefik is the single proxy in front.
- `JobManager` runs one operation at a time (409 otherwise). It keeps the last 50 jobs in memory and also writes each job's log to `<REPO_DIR>/data-admin/jobs/<id>.log`.
- `GET /api/jobs/:id/events` is SSE: it replays the lines after `?after=<seq>`, then streams live.

**`@infra/web`** (`packages/web`) uses Vite, React 19, Tailwind v4, shadcn (radix-nova) and TanStack Query. The UI text is Hungarian; operation labels live in `src/lib/labels.ts`.

## Coupling with the infra repo

- The container mounts the infra repo at the same absolute path as on the host. `docker compose` runs inside the container, but the host daemon resolves the stacks' relative bind mounts, so the paths must match.
- It reaches Gitea at `http://gitea:3000` (`GITEA_API_URL`, over the shared `gitea` network). The public hostname goes through Traefik, which can hang once the runners start.
- Base layer: `stop` and `clean` never touch `traefik.yaml` and `admin.yaml`. `down` on a compose file without services acts on the whole project, so `clean` skips such files (`hasServices`). `COMPOSE_PROJECT_NAME` beats the top-level `name:`, so never export it.
- `ensureBaseLayer` creates the external `gitea` network and removes a Traefik container left in the old `infra` project. The infra repo's `install.sh` does the same.
- TLS: `routingEnv()` (`config.ts`) supplies the variables that the compose files interpolate for routing: `GITEA_HOSTNAME`, `REGISTRY_PORT`, `CERT_RESOLVER`, `ACME_EMAIL` and `ACME_CA_SERVER`.
  - Every `up` of `traefik.yaml` passes them: install.sh, init and start. The derivation has to match install.sh, otherwise compose recreates Traefik.
  - `CERT_RESOLVER` is `letsencrypt` only when both `enableHttps` and `letsencrypt` are on.
- Competitor hostnames come from `competitorHost()` (`schema.ts`): `<user>-<module>`, lowercase, with `_` replaced by `-`, because Let's Encrypt rejects `_`. Init's `competitorsYaml` uses it per module, `syncCompetitors` per repository. The `subdomain` field of a competitor is no longer used.
- The admin's own Traefik route: `writeAdminRoute()` (`config.ts`, content from `adminRoute()` in `generate.ts`) writes `config/traefik/admin.yaml`. It runs when the server starts, after `PUT /api/config`, and in init. `admin.yaml` has no Traefik labels, because labels would only change when install.sh recreates the container.
- Framework templates come from `frameworks` in `main-config.json` (`frameworkSchema`, defaulting to `DEFAULT_FRAMEWORKS` in `schema.ts`), and the UI edits them.
  - Init clones each template into `data-admin/frameworks/<name>` (`FRAMEWORK_CLONE_DIR`), never into the repo root, because names come from the UI.
  - It rewrites `.gitea/workflows/docker-ci.yaml` if the template has one, then pushes `HEAD` to the `frameworks` org and deletes the clone. Clean removes leftovers.
  - `syncFrameworks` (`ops/frameworks.ts`) does the same in a running environment. It imports the listed templates missing from the org and deletes the org's repos that are no longer listed. Existing ones are skipped. Repos generated from a template are independent copies, so deleting is safe.
- Competitor sync (the former infra-updater service, now `ops/sync.ts`):
  - Gitea's system webhook for repository events posts to `WEBHOOK_PATH` (`/api/hooks/gitea`) on the admin server, at `WEBHOOK_URL` (`http://infra-admin:8090`, over the shared network). `gitea.yaml` allows that private host with `GITEA__webhook__ALLOWED_HOST_LIST`.
  - The route is mounted before `express.json`, because it needs the raw body. It is authenticated by the `X-Gitea-Signature` HMAC, not the session. The secret is generated into `data-admin/webhook-secret` (600) and set on the hook by init's `createWebhook`, which also removes an old infra-updater hook.
  - Requests go through the `JobManager` like any operation. A request that arrives while a job runs sets a flag, and one more `syncCompetitors` runs when the manager is idle (`onIdle`).
  - The sync lists each competitor's repositories and container packages (admin basic auth plus a `Sudo` header). It then rewrites `competitors.yaml` (Sablier-managed services, no Traefik labels) and `config/traefik/competitors.yaml` (JSON, which is valid YAML; an empty file when there are no repos, because Traefik rejects empty sections). Next it pushes an nginx placeholder for repos without an image, and finally runs `compose create`.
- Values duplicated across the two repos:
  - the compose project names: `infra` (`exec.ts`) and `infra-traefik`;
  - the admin's container name and port in `WEBHOOK_URL` (`admin.yaml`, `ALLOWED_HOST_LIST` in `gitea.yaml`);
  - the config validation rules (`schema.ts`, `install.sh`).

## Gotchas

- The container runs as root. Write files into the infra repo with `writeRepoFile`/`appendRepoFile` (`core/src/files.ts`), which chown them to the repo directory's owner.
  - `main-config.json` is 644.
  - `pulldeck.env` is 600.
- `writeConfig` is atomic (temp file + rename).
- The config schema restricts usernames, modules and subdomains to slug characters, and passwords may not contain `'`, `\` or newlines. These values end up in hostnames, compose YAML and SQL.
- Service data lives in named volumes (`infra_<name>`), and clean removes them with `down -v`.

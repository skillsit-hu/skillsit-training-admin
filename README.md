# skillsit-training-admin

Admin UI and REST API for [skillsit-training-infra](https://github.com/skillsit-hu/skillsit-training-infra), the WorldSkills-style web development competition environment. It runs the provisioning operations (init, start, stop, clean, users) against the host's Docker daemon.

The image is published to `ghcr.io/skillsit-hu/skillsit-training-admin` by GitHub Actions (`.github/workflows/docker.yml`):

| Event | Tags |
| --- | --- |
| push to `main` | `latest`, `sha-<short>` |
| tag `vX.Y.Z` | `X.Y.Z`, `X.Y` |
| pull request | test and build only |

The image runs on `linux/amd64` and `linux/arm64`.

## Usage

You don't start the container by hand. The infra repo's `install.sh` pulls the image and starts it through `admin.yaml`. To update a running host, run this in the infra checkout:

```bash
sudo INFRA_KEEP_CONFIG=1 sh install.sh
```

The container has no Traefik labels. On start and on every config save it writes its route to `config/traefik/admin.yaml` in the infra repo.

## Development

```bash
npm ci
npm run build      # core -> server -> web
npm test           # vitest (packages/core/test)
npm run typecheck
REPO_DIR=/path/to/skillsit-training-infra DRY_RUN=1 npm run dev
```

`npm run dev` starts the API on :8090 and Vite on :5173. Vite proxies `/api` to the API.

- `REPO_DIR` is required. It points at an infra checkout that has `config/main-config.json`.
- `DRY_RUN=1` logs the docker and git commands and the Gitea requests instead of running them.
- On Windows, run it inside WSL with a Linux Node.

To build the image locally:

```bash
docker build -t ghcr.io/skillsit-hu/skillsit-training-admin:dev .
```

Then set `ADMIN_IMAGE=ghcr.io/skillsit-hu/skillsit-training-admin:dev` in the infra repo's `.admin.env`.

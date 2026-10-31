import type { DerivedConfig } from './config.js';

export function competitorService(cfg: DerivedConfig, user: string, sub: string, module: string): string {
  const id = `${user}_${module}`;
  return `  ${id}:
    image: git.${cfg.domain}/${user}/${module}:latest
    container_name: ${id}
    restart: always
    networks:
      - gitea
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.${id}.rule=Host(\`${sub}-${module}.${cfg.domain}\`)"
      - "traefik.http.routers.${id}.entrypoints=${cfg.entrypoint}"
      - "traefik.http.routers.${id}.tls=${cfg.enableHttps}"
      - "traefik.http.services.${id}.loadbalancer.server.port=80"
`;
}

export function competitorSql(user: string, pass: string, module: string): string {
  return `  CREATE DATABASE IF NOT EXISTS \`${user}_${module}\`;
  CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${pass}';
  GRANT ALL PRIVILEGES ON *.* TO '${user}'@'%';
`;
}

/** The SQL create_user appends for a competitor added to a running environment. */
export function newUserSql(user: string, pass: string): string {
  return `CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${pass}';\nGRANT ALL PRIVILEGES ON *.* TO '${user}'@'%';\n`;
}

export function competitorsYaml(cfg: DerivedConfig): string {
  let services = '';
  for (const { username, subdomain } of cfg.competitors) {
    for (const module of cfg.modules) services += competitorService(cfg, username, subdomain, module);
  }
  return `services:\n${services}\nnetworks:\n  gitea:\n    external: true\n`;
}

export function competitorsSql(cfg: DerivedConfig): string {
  let sql = '';
  for (const { username, password } of cfg.competitors) {
    for (const module of cfg.modules) sql += competitorSql(username, password, module);
  }
  return sql;
}

export function dotEnv(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => `${k}="${v}"`).join('\n') + '\n';
}

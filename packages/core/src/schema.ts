// Browser-safe: imported by the web UI for form validation.
import { z } from 'zod';

// Gitea usernames and module names end up in hostnames, image names, container names and SQL identifiers.
const slug = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Only letters, digits, "-" and "_" are allowed');
// Passwords are interpolated into SQL string literals.
const password = z.string().min(1).refine((p) => !/['\\\n]/.test(p), 'Must not contain quotes, backslashes or newlines');

export const competitorSchema = z
  .object({
    name: z.string().optional(),
    username: slug,
    password,
    /** No longer used: competitor sites are published at competitorHost(). Kept so older configs still parse. */
    subdomain: z.string().optional(),
  })
  .passthrough();

export const configSchema = z
  .object({
    domain: z.string().regex(/^[a-z0-9.-]+$/, 'Invalid domain'),
    enableHttps: z.union([z.boolean(), z.enum(['true', 'false'])]),
    /** Per-host Let's Encrypt certificates (HTTP-01); off = Traefik's built-in default certificate. */
    letsencrypt: z.boolean().default(false),
    /** Optional ACME account e-mail (expiry notices). */
    acmeEmail: z.union([z.literal(''), z.string().email('Invalid e-mail')]).optional(),
    username: slug,
    password,
    modules: z.array(slug).default([]),
    competitors: z.array(competitorSchema).default([]),
  })
  .passthrough()
  .superRefine((cfg, issue) => {
    const seen = new Set<string>();
    cfg.competitors.forEach((c, i) => {
      if (seen.has(c.username)) {
        issue.addIssue({ code: 'custom', path: ['competitors', i, 'username'], message: 'Duplicate username' });
      }
      seen.add(c.username);
    });
    if (new Set(cfg.modules).size !== cfg.modules.length) {
      issue.addIssue({ code: 'custom', path: ['modules'], message: 'Duplicate module' });
    }
  });

/**
 * Public hostname of a competitor's module (or repository, see competitorRoutes). Let's Encrypt rejects "_" in
 * hostnames, so it becomes "-".
 */
export function competitorHost(username: string, module: string, domain: string): string {
  return `${username}-${module}`.toLowerCase().replaceAll('_', '-') + '.' + domain;
}

export type Competitor = z.infer<typeof competitorSchema>;
export type MainConfig = z.infer<typeof configSchema>;

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

/** A framework template that init imports into the Gitea "frameworks" organisation as a template repository. */
export const frameworkSchema = z
  .object({
    /** Repository name in Gitea (and clone directory name). */
    name: z.string().max(100).regex(/^[a-z0-9][a-z0-9._-]*$/, 'Lowercase letters, digits, ".", "-" and "_" only'),
    /** Git URL to clone the template from. */
    url: z.string().regex(/^https?:\/\/\S+$/, 'Must be an http(s) git URL'),
  })
  .passthrough();

export const configSchema = z
  .object({
    domain: z.string().regex(/^[a-z0-9.-]+$/, 'Invalid domain'),
    enableHttps: z.union([z.boolean(), z.enum(['true', 'false'])]),
    /** Per-host Let's Encrypt certificates (TLS-ALPN-01 on port 443); off = Traefik's built-in default certificate. */
    letsencrypt: z.boolean().default(false),
    /** Optional ACME account e-mail (expiry notices). */
    acmeEmail: z.union([z.literal(''), z.string().email('Invalid e-mail')]).optional(),
    username: slug,
    password,
    modules: z.array(slug).default([]),
    competitors: z.array(competitorSchema).default([]),
    // What the file says is what init imports: no "frameworks" means no templates
    frameworks: z.array(frameworkSchema).default([]),
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
    const names = new Set<string>();
    cfg.frameworks.forEach((f, i) => {
      if (names.has(f.name)) issue.addIssue({ code: 'custom', path: ['frameworks', i, 'name'], message: 'Duplicate template name' });
      names.add(f.name);
    });
  });

/**
 * Public hostname of a competitor's module (or repository, see competitorRoutes). Let's Encrypt rejects "_" in
 * hostnames, so it becomes "-".
 */
export function competitorHost(username: string, module: string, domain: string): string {
  return `${username}-${module}`.toLowerCase().replaceAll('_', '-') + '.' + domain;
}

export type Framework = z.infer<typeof frameworkSchema>;
export type Competitor = z.infer<typeof competitorSchema>;
export type MainConfig = z.infer<typeof configSchema>;

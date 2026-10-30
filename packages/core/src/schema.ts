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
    subdomain: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Lowercase letters, digits and "-" only'),
  })
  .passthrough();

export const configSchema = z
  .object({
    domain: z.string().regex(/^[a-z0-9.-]+$/, 'Invalid domain'),
    enableHttps: z.union([z.boolean(), z.enum(['true', 'false'])]),
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

export type Competitor = z.infer<typeof competitorSchema>;
export type MainConfig = z.infer<typeof configSchema>;

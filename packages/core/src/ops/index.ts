import { z } from 'zod';
import { OperationError, type OpContext } from '../context.js';
import { competitorSchema } from '../config.js';
import { ensureDocker } from '../exec.js';
import { init } from './init.js';
import { clean, start, stop } from './lifecycle.js';
import { createUser, disableCompetitorLogins, setupOrgs } from './users.js';

export { init, start, stop, clean, createUser, disableCompetitorLogins, setupOrgs };
export { addCompetitorToConfig, type CreateUserArgs } from './users.js';

interface OperationDef<S extends z.ZodTypeAny> {
  title: string;
  description: string;
  /** Destroys or overwrites data; the UI asks for typed confirmation. */
  destructive: boolean;
  /** Checked up front with ensureDocker. */
  docker: boolean;
  args: S;
  /** CLI usage, positional arguments mapped onto the args object. */
  cliArgs: (keyof z.infer<S> & string)[];
  run: (ctx: OpContext, args: z.infer<S>) => Promise<void>;
}

const noArgs = z.object({}).strict();

function op<S extends z.ZodTypeAny>(def: OperationDef<S>): OperationDef<S> {
  return def;
}

export const OPERATIONS = {
  init: op({
    title: 'Initialize environment',
    description: 'Starts every stack, creates Gitea users, organisations and framework templates from main-config.json. Run Clean first if it was initialized before.',
    destructive: true,
    docker: true,
    args: noArgs,
    cliArgs: [],
    run: (ctx) => init(ctx),
  }),
  start: op({
    title: 'Start',
    description: 'Restarts the stopped containers.',
    destructive: false,
    docker: true,
    args: noArgs,
    cliArgs: [],
    run: (ctx) => start(ctx),
  }),
  stop: op({
    title: 'Stop',
    description: 'Stops the containers (except Traefik and the admin UI) without removing them or their data.',
    destructive: false,
    docker: true,
    args: noArgs,
    cliArgs: [],
    run: (ctx) => stop(ctx),
  }),
  clean: op({
    title: 'Clean',
    description: 'Removes every container except Traefik and the admin UI, plus ./data, competitor images and framework clones.',
    destructive: true,
    docker: true,
    args: noArgs,
    cliArgs: [],
    run: (ctx) => clean(ctx),
  }),
  createUser: op({
    title: 'Create competitor',
    description: 'Adds a competitor to the running environment (Gitea user, team, secrets, MySQL user) and to main-config.json.',
    destructive: false,
    docker: true,
    args: z.object({
      username: competitorSchema.shape.username,
      password: competitorSchema.shape.password,
      subdomain: competitorSchema.shape.subdomain.optional(),
      name: z.string().optional(),
    }),
    cliArgs: ['username', 'password'],
    run: (ctx, args) => createUser(ctx, args),
  }),
  disableCompetitorLogins: op({
    title: 'Disable competitor logins',
    description: "Deactivates every competitor's Gitea account (e.g. at the end of the competition).",
    destructive: false,
    docker: false,
    args: noArgs,
    cliArgs: [],
    run: (ctx) => disableCompetitorLogins(ctx),
  }),
  setupOrgs: op({
    title: 'Create base organisations',
    description: 'Creates the images, frameworks and competitionc Gitea organisations.',
    destructive: false,
    docker: false,
    args: noArgs,
    cliArgs: [],
    run: (ctx) => setupOrgs(ctx),
  }),
};

export type OperationName = keyof typeof OPERATIONS;

export interface OperationInfo {
  name: OperationName;
  title: string;
  description: string;
  destructive: boolean;
  args: string[];
}

export function isOperationName(name: string): name is OperationName {
  return Object.hasOwn(OPERATIONS, name);
}

export function listOperations(): OperationInfo[] {
  return (Object.keys(OPERATIONS) as OperationName[]).map((name) => {
    const { title, description, destructive, cliArgs } = OPERATIONS[name];
    return { name, title, description, destructive, args: cliArgs };
  });
}

/** Validates the arguments and runs the operation. */
export async function runOperation(ctx: OpContext, name: OperationName, args: unknown): Promise<void> {
  const def = OPERATIONS[name] as unknown as OperationDef<z.ZodTypeAny>;
  const parsed = def.args.safeParse(args ?? {});
  if (!parsed.success) {
    throw new OperationError(`Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  if (def.docker) await ensureDocker(ctx);
  await def.run(ctx, parsed.data);
}

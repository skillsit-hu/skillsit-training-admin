import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consoleLogger, OperationError, type OpContext } from './context.js';
import { OPERATIONS, runOperation, type OperationName } from './ops/index.js';

/** Entry point of the root *.mjs wrappers; `moduleUrl` is the wrapper's import.meta.url (it lives in the repo root). */
export async function runCli(name: OperationName, moduleUrl: string, argv = process.argv.slice(2)): Promise<void> {
  const repoDir = path.dirname(fileURLToPath(moduleUrl));
  const { cliArgs } = OPERATIONS[name];
  if (argv.length !== cliArgs.length) {
    console.error(`Usage: ${process.argv[1]?.split(/[\\/]/).pop()} ${cliArgs.map((a) => `<${a.toUpperCase()}>`).join(' ')}`);
    process.exit(1);
  }
  const args = Object.fromEntries(cliArgs.map((key, i) => [key, argv[i]]));
  const ctx: OpContext = { repoDir, log: consoleLogger(), dryRun: process.env.DRY_RUN === '1' };
  try {
    await runOperation(ctx, name, args);
  } catch (err) {
    console.error(err instanceof OperationError ? err.message : err);
    process.exit(1);
  }
}

// Shared entry of the root *.mjs wrappers: runs an operation from @infra/core with console output.
let core;
try {
  core = await import('./packages/core/dist/index.js');
} catch (err) {
  if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
  console.error('The scripts need a build first: cd app && npm ci && npm run build');
  process.exit(1);
}

export const runCli = core.runCli;

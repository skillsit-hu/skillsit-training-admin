import fs from 'node:fs';

// The admin container (and `sudo node …`) runs as root. Files written into the repo are handed back to the
// owner of the repo directory, so the user who cloned it can still read and edit them.

export function giveToRepoOwner(repoDir: string, file: string): void {
  if (process.getuid?.() !== 0) return;
  const { uid, gid } = fs.statSync(repoDir);
  if (uid !== 0) fs.chownSync(file, uid, gid);
}

export function writeRepoFile(repoDir: string, file: string, content: string, mode?: number): void {
  fs.writeFileSync(file, content, { mode });
  if (mode !== undefined) fs.chmodSync(file, mode); // the mode option only applies to new files
  giveToRepoOwner(repoDir, file);
}

export function appendRepoFile(repoDir: string, file: string, content: string): void {
  fs.appendFileSync(file, content);
  giveToRepoOwner(repoDir, file);
}

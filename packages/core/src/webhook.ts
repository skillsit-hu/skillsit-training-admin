import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { giveToRepoOwner, writeRepoFile } from './files.js';

/** Path of the Gitea repository webhook on the admin server; see WEBHOOK_URL in gitea.ts. */
export const WEBHOOK_PATH = '/api/hooks/gitea';

const SECRET_FILE = 'data-admin/webhook-secret';

/** The webhook's HMAC secret, generated on first use and kept next to the job logs (mode 600). */
export function webhookSecret(repoDir: string): string {
  const file = path.join(repoDir, SECRET_FILE);
  try {
    const secret = fs.readFileSync(file, 'utf8').trim();
    if (secret) return secret;
  } catch {
    // generated below
  }
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    giveToRepoOwner(repoDir, dir);
  }
  const secret = crypto.randomBytes(32).toString('base64url');
  writeRepoFile(repoDir, file, `${secret}\n`, 0o600);
  return secret;
}

/** Checks Gitea's X-Gitea-Signature header: hex HMAC-SHA256 of the raw request body. */
export function verifyWebhookSignature(secret: string, body: Buffer, signature: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

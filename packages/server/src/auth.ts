import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { readConfig } from '@infra/core';

const COOKIE = 'infra_admin_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const secret = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// The root password is part of the key, so changing it in main-config.json ends every session.
function sign(payload: string, password: string): string {
  return crypto.createHmac('sha256', `${secret}:${password}`).update(payload).digest('base64url');
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export function checkCredentials(repoDir: string, username: string, password: string): boolean {
  const cfg = readConfig(repoDir);
  // Evaluate both so the timing doesn't reveal which one was wrong.
  const userOk = safeEqual(username, cfg.username);
  const passOk = safeEqual(password, cfg.password);
  return userOk && passOk;
}

export function issueSession(res: Response, repoDir: string, username: string, secure: boolean): void {
  const { password } = readConfig(repoDir);
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + MAX_AGE_MS })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload, password)}`, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(COOKIE, { path: '/' });
}

export function sessionUser(req: Request, repoDir: string): string | null {
  const value = readCookie(req, COOKIE);
  if (!value) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  let cfg;
  try {
    cfg = readConfig(repoDir);
  } catch {
    return null;
  }
  if (!safeEqual(signature, sign(payload, cfg.password))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof exp !== 'number' || exp < Date.now() || u !== cfg.username) return null;
    return u;
  } catch {
    return null;
  }
}

export function requireAuth(repoDir: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = sessionUser(req, repoDir);
    if (!user) {
      res.status(401).json({ error: 'Not logged in' });
      return;
    }
    res.locals.user = user;
    next();
  };
}

/** Allows `limit` failed attempts per IP per window. */
export function loginLimiter(limit = 10, windowMs = 15 * 60 * 1000) {
  const failures = new Map<string, { count: number; reset: number }>();
  return {
    blocked(ip: string): boolean {
      const entry = failures.get(ip);
      if (!entry || entry.reset < Date.now()) return false;
      return entry.count >= limit;
    },
    fail(ip: string): void {
      const entry = failures.get(ip);
      if (!entry || entry.reset < Date.now()) failures.set(ip, { count: 1, reset: Date.now() + windowMs });
      else entry.count++;
    },
    succeed(ip: string): void {
      failures.delete(ip);
    },
  };
}

import express, { type Router } from 'express';
import { verifyWebhookSignature, webhookSecret, type ApiError } from '@infra/core';
import { BusyError, type JobManager } from './jobs.js';

/**
 * Runs syncCompetitors for Gitea's repository webhook. Requests that arrive while a job is running (another
 * operation, or a sync already in progress) collapse into one more sync once the job manager is idle.
 */
export function webhookRouter(repoDir: string, jobs: JobManager): Router {
  let pending = false;
  const flush = () => {
    if (!pending || jobs.running()) return;
    pending = false;
    try {
      jobs.start('syncCompetitors', {});
    } catch (err) {
      if (!(err instanceof BusyError)) throw err;
      pending = true;
    }
  };
  jobs.onIdle(flush);

  const router = express.Router();
  // Raw body: the signature is computed over the exact bytes Gitea sent.
  router.post('/', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    const signature = req.get('X-Gitea-Signature');
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!signature) {
      res.status(400).json({ error: 'Missing X-Gitea-Signature header' } satisfies ApiError);
      return;
    }
    if (!verifyWebhookSignature(webhookSecret(repoDir), body, signature)) {
      res.status(403).json({ error: 'Invalid signature' } satisfies ApiError);
      return;
    }
    pending = true;
    flush();
    res.status(202).json({ accepted: true });
  });
  return router;
}

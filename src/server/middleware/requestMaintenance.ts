import type { RequestHandler } from 'express';
import { scheduleClubMemberTags } from '../services/telegramClubMemberTags';
import { scheduleMutationReconciliation } from '../sync/scheduleReconciliation';

/** Public/static reads and identity resume must not start background writes.
 * Recover pending notification work from its authenticated poll, successful
 * mutations, or the existing explicit cron/worker entry point. */
export function requestMaintenance(workers = {
  tags: scheduleClubMemberTags,
  recover: scheduleMutationReconciliation,
}): RequestHandler {
  return (req, res, next) => {
    const path = req.originalUrl.split('?')[0].replace(/\/+$/, '');
    // An authenticated login is identity establishment, not a club mutation.
    // Starting membership/tag and notification workers on every login can
    // multiply database traffic precisely while PostgREST is degraded.
    const identityRequest = path.startsWith('/api/auth/');
    const mutation = ['POST','PUT','PATCH','DELETE'].includes(req.method) && !identityRequest;
    const notificationPoll = req.method === 'GET' && path === '/api/me/notifications';
    if (mutation || notificationPoll) res.once('finish', () => {
      if (res.statusCode >= 400) return;
      if (mutation) workers.tags();
      if (req.user) workers.recover();
    });
    next();
  };
}

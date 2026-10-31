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
    const mutation = ['POST','PUT','PATCH','DELETE'].includes(req.method);
    const notificationPoll = req.method === 'GET' && req.originalUrl.split('?')[0].replace(/\/+$/, '') === '/api/me/notifications';
    if (mutation || notificationPoll) res.once('finish', () => {
      if (res.statusCode >= 400) return;
      if (mutation) workers.tags();
      if (req.user) workers.recover();
    });
    next();
  };
}

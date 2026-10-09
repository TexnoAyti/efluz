import type { Request, Response } from 'express';
import { canUseDangerZone } from '../../lib/adminPermissions';

// Central protection applies to all routers and legacy aliases using requireAdmin.
export function isDangerZoneRequest(method: string, path: string): boolean {
  if (method === 'DELETE') return /^\/api\/admin\/(?:fixtures|users|submissions)\/[^/]+$/.test(path);
  if (method !== 'POST') return false;
  return [
    /^\/api\/admin\/users\/[^/]+\/role$/,
    /^\/api\/admin\/fixtures\/(?:reset|generate|restore-missing-pairs)$/,
    /^\/api\/competitions\/[^/]+\/(?:reset-fixtures|generate-fixtures)$/,
    /^\/api\/admin\/cups\/[^/]+\/bracket\/generate$/,
    /^\/api\/admin\/knockouts\/generate$/,
    /^\/api\/admin\/migrate-to-firestore$/,
    /^\/api\/admin\/season-ops\/(?:rollover|archive)$/,
    /^\/api\/admin\/european\/qualification\/apply$/,
  ].some(pattern => pattern.test(path));
}
export function enforceAdminDangerZone(req: Request, res: Response): boolean {
  // Express routes are case insensitive and allow a trailing slash.
  const path = decodeURIComponent(new URL(req.originalUrl, 'https://efluz.invalid').pathname).replace(/\/+$/, '').toLowerCase();
  const protectedOwner = /^\/api\/admin\/users\/user-5209126900\/(?:suspend|role)$/.test(path);
  if ((isDangerZoneRequest(req.method, path) || protectedOwner) && !canUseDangerZone(req.user)) {
    res.status(403).json({ error: 'OWNER_ONLY', message: 'Bu xavfli amal faqat asosiy admin uchun ruxsat etilgan.' });
    return false;
  }
  return true;
}

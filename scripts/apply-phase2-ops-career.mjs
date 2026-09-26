import fs from 'node:fs';

function replaceOnce(path, needle, replacement, guard) {
  const source = fs.readFileSync(path, 'utf8');
  if (guard && source.includes(guard)) return;
  if (!source.includes(needle)) throw new Error(`Patch point missing in ${path}: ${needle.slice(0, 100)}`);
  fs.writeFileSync(path, source.replace(needle, replacement));
}

// 1) Preserve smart-message rendering metadata in durable broadcast records so failed smart jobs can be retried faithfully.
{
  const path = 'src/server/services/smartNotificationService.ts';
  let s = fs.readFileSync(path, 'utf8');
  const iface = "  recipients: SmartRecipientStatus[];\n}";
  if (!s.includes('bodyIsHtml?: boolean;\n  replyMarkup?: any;\n}')) {
    if (!s.includes(iface)) throw new Error('Smart broadcast interface anchor missing');
    s = s.replace(iface, "  recipients: SmartRecipientStatus[];\n  bodyIsHtml?: boolean;\n  replyMarkup?: any;\n}");
  }
  const recordTail = "    recipients: [{\n      userId: recipient.userId,\n      username: recipient.username || 'player',\n      displayName: recipient.displayName || recipient.username || 'EFL Player',\n      status: 'PENDING',\n      retryCount: 0,\n    }],\n  };";
  if (!s.includes('bodyIsHtml: true,\n    replyMarkup: params.replyMarkup,')) {
    if (!s.includes(recordTail)) throw new Error('Smart record anchor missing');
    s = s.replace(recordTail, "    recipients: [{\n      userId: recipient.userId,\n      username: recipient.username || 'player',\n      displayName: recipient.displayName || recipient.username || 'EFL Player',\n      status: 'PENDING',\n      retryCount: 0,\n    }],\n    bodyIsHtml: true,\n    replyMarkup: params.replyMarkup,\n  };");
  }
  fs.writeFileSync(path, s);
}

// 2) Durable retry for failed Telegram recipients.
{
  const path = 'src/server/services/telegramNotificationQueue.ts';
  let s = fs.readFileSync(path, 'utf8');
  if (!s.includes('bodyIsHtml?: boolean;\n  replyMarkup?: any;\n}')) {
    const anchor = "  recipients: BroadcastRecipientStatus[];\n}";
    if (!s.includes(anchor)) throw new Error('TelegramBroadcastRecord anchor missing');
    s = s.replace(anchor, "  recipients: BroadcastRecipientStatus[];\n  bodyIsHtml?: boolean;\n  replyMarkup?: any;\n}");
  }
  if (!s.includes('export async function retryFailedBroadcastRecipients')) {
    const anchor = '/**\n * Returns single broadcast record by ID.\n */\nexport async function getBroadcastDetails';
    if (!s.includes(anchor)) throw new Error('Retry insertion anchor missing');
    const fn = `/** Retry FAILED recipients without re-sending already successful deliveries. */\nexport async function retryFailedBroadcastRecipients(\n  broadcastId: string,\n  userId?: string\n): Promise<{ retried: number; skipped: number }> {\n  const client = getUpstashClient();\n  if (!client) throw new Error('REDIS_REQUIRED');\n  const record = await getBroadcastDetails(broadcastId);\n  if (!record) throw new Error('BROADCAST_NOT_FOUND');\n\n  const directory = await client.get<RecipientDirectoryEntry[]>(\`\${RECIPIENT_DIR_KEY}:\${record.seasonId}\`);\n  const byUser = new Map((Array.isArray(directory) ? directory : []).map((entry) => [entry.userId, entry]));\n  const targets = record.recipients.filter((recipient) =>\n    recipient.status === 'FAILED' && (!userId || recipient.userId === userId)\n  );\n  if (userId && targets.length === 0) throw new Error('FAILED_RECIPIENT_NOT_FOUND');\n\n  let retried = 0;\n  let skipped = 0;\n  for (const recipient of targets) {\n    const directoryEntry = byUser.get(recipient.userId);\n    if (!directoryEntry?.messageable || !directoryEntry.telegramId) {\n      skipped++;\n      continue;\n    }\n    const now = new Date().toISOString();\n    const retryNumber = Number(recipient.retryCount || 0) + 1;\n    const job: NotificationQueueJob = {\n      jobId: \`job-retry-\${broadcastId}-\${recipient.userId}-\${Date.now()}-\${retryNumber}\`,\n      broadcastId,\n      userId: recipient.userId,\n      username: recipient.username || directoryEntry.username || 'player',\n      displayName: recipient.displayName || directoryEntry.displayName || 'EFL Player',\n      telegramId: directoryEntry.telegramId,\n      title: record.title,\n      body: record.body,\n      type: record.type,\n      status: 'QUEUED',\n      retryCount: 0,\n      maxRetries: 3,\n      createdAt: now,\n      availableAt: Date.now(),\n      bodyIsHtml: Boolean(record.bodyIsHtml),\n      replyMarkup: record.replyMarkup,\n    };\n    recipient.status = 'PENDING';\n    recipient.retryCount = retryNumber;\n    delete recipient.error;\n    delete recipient.sentAt;\n    await client.rpush(QUEUE_KEY, JSON.stringify(job));\n    retried++;\n  }\n\n  if (retried > 0) {\n    record.metrics.failedCount = Math.max(0, Number(record.metrics.failedCount || 0) - retried);\n    record.status = 'QUEUED';\n    await client.hset(BROADCASTS_KEY, { [record.id]: record });\n    memoryBroadcasts.set(record.id, record);\n    scheduleNotificationQueueDrain();\n  }\n  return { retried, skipped };\n}\n\n`;
    s = s.replace(anchor, fn + anchor);
  }
  fs.writeFileSync(path, s);
}

// 3) Admin retry endpoint.
replaceOnce(
  'src/server/routes/admin.routes.ts',
  '  getBroadcastDetails,\n  syncRecipientDirectory,',
  '  getBroadcastDetails,\n  retryFailedBroadcastRecipients,\n  syncRecipientDirectory,',
  'retryFailedBroadcastRecipients,'
);
replaceOnce(
  'src/server/routes/admin.routes.ts',
  "adminRouter.get('/telegram-notifications/broadcasts', async (req: Request, res: Response) => {",
  `adminRouter.post('/telegram-notifications/broadcasts/:broadcastId/retry-failed', async (req: Request, res: Response) => {\n  try {\n    const result = await retryFailedBroadcastRecipients(\n      req.params.broadcastId,\n      typeof req.body?.userId === 'string' ? req.body.userId : undefined\n    );\n    res.json({ success: true, ...result });\n  } catch (err: any) {\n    const status = ['BROADCAST_NOT_FOUND', 'FAILED_RECIPIENT_NOT_FOUND'].includes(err?.message) ? 404 : 500;\n    res.status(status).json({ error: err?.message || 'RETRY_FAILED' });\n  }\n});\n\nadminRouter.get('/telegram-notifications/broadcasts', async (req: Request, res: Response) => {`,
  'retry-failed'
);

// 4) API method.
replaceOnce(
  'src/lib/api.ts',
  '  async getTelegramBroadcasts(limit = 20): Promise<{ broadcasts: any[] }> {',
  `  async retryTelegramBroadcastFailures(broadcastId: string, userId?: string): Promise<{ success: boolean; retried: number; skipped: number }> {\n    return request(\`/api/admin/telegram-notifications/broadcasts/\${encodeURIComponent(broadcastId)}/retry-failed\`, {\n      method: 'POST',\n      body: JSON.stringify(userId ? { userId } : {}),\n      skipCache: true,\n    });\n  },\n\n  async getTelegramBroadcasts(limit = 20): Promise<{ broadcasts: any[] }> {`,
  'retryTelegramBroadcastFailures'
);

// 5) Admin Notification Center: aggregate queue health + retry failed.
{
  const path = 'src/components/admin/AdminTelegramTab.tsx';
  let s = fs.readFileSync(path, 'utf8');
  if (!s.includes('const [retryingBroadcastId')) {
    s = s.replace(
      '  const [selectedBroadcast, setSelectedBroadcast] = useState<BroadcastRecord | null>(null);',
      "  const [selectedBroadcast, setSelectedBroadcast] = useState<BroadcastRecord | null>(null);\n  const [retryingBroadcastId, setRetryingBroadcastId] = useState<string | null>(null);"
    );
  }
  if (!s.includes('const deliveryHealth = useMemo')) {
    const anchor = '  // Filtered visible recipients\n  const filteredRecipients = useMemo(() => {';
    if (!s.includes(anchor)) throw new Error('Telegram health anchor missing');
    const block = `  const deliveryHealth = useMemo(() => broadcasts.reduce((acc, item) => {\n    acc.total += Number(item.metrics?.totalRecipients || 0);\n    acc.sent += Number(item.metrics?.sentCount || 0);\n    acc.failed += Number(item.metrics?.failedCount || 0);\n    acc.skipped += Number(item.metrics?.skippedCount || 0);\n    acc.pending += Math.max(0, Number(item.metrics?.totalRecipients || 0) - Number(item.metrics?.sentCount || 0) - Number(item.metrics?.failedCount || 0) - Number(item.metrics?.skippedCount || 0));\n    return acc;\n  }, { total: 0, sent: 0, failed: 0, skipped: 0, pending: 0 }), [broadcasts]);\n\n`;
    s = s.replace(anchor, block + anchor);
  }
  if (!s.includes('async function handleRetryFailed')) {
    const anchor = '  return (\n';
    const idx = s.indexOf(anchor, s.indexOf('async function handleProcessQueue'));
    if (idx < 0) throw new Error('Telegram retry handler anchor missing');
    const handler = `  async function handleRetryFailed(broadcastId: string) {\n    setRetryingBroadcastId(broadcastId);\n    try {\n      const res = await api.retryTelegramBroadcastFailures(broadcastId);\n      showToast(res.retried > 0 ? \`Retry queued for \${res.retried} failed recipient(s).\` : 'No retryable failed recipients found.', res.retried > 0 ? 'success' : 'info');\n      await loadBroadcasts();\n    } catch (err: any) {\n      showToast(err.message || 'Failed deliveries could not be retried', 'error');\n    } finally {\n      setRetryingBroadcastId(null);\n    }\n  }\n\n`;
    s = s.slice(0, idx) + handler + s.slice(idx);
  }
  if (!s.includes('Delivery Health')) {
    const anchor = '      {/* Broadcast Delivery History Table */}';
    if (!s.includes(anchor)) throw new Error('Delivery health UI anchor missing');
    const health = `      <div className="glass-panel p-4 rounded-2xl border-slate-800 space-y-3">\n        <div className="flex items-center justify-between"><div><h3 className="text-sm font-black text-white">Delivery Health</h3><p className="text-[10px] text-slate-500">Recent Redis broadcast records • successful users are never resent by Retry Failed</p></div><button onClick={handleProcessQueue} className="px-3 py-1.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-300 text-[10px] font-black">Process Queue</button></div>\n        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">\n          {[['Total', deliveryHealth.total, 'text-white'], ['Sent', deliveryHealth.sent, 'text-emerald-300'], ['Pending', deliveryHealth.pending, 'text-sky-300'], ['Failed', deliveryHealth.failed, 'text-rose-300'], ['Skipped', deliveryHealth.skipped, 'text-slate-400']].map(([label, value, cls]) => <div key={String(label)} className="rounded-xl bg-slate-950/60 border border-white/[0.05] p-3"><div className={\`text-lg font-black font-mono \${cls}\`}>{value}</div><div className="text-[9px] uppercase font-bold text-slate-500">{label}</div></div>)}\n        </div>\n      </div>\n\n`;
    s = s.replace(anchor, health + anchor);
  }
  if (!s.includes('<th className="py-2.5 px-2 text-center">Failed</th>')) {
    s = s.replace(
      '<th className="py-2.5 px-2 text-center">Skipped</th>',
      '<th className="py-2.5 px-2 text-center">Skipped</th>\n                  <th className="py-2.5 px-2 text-center">Failed</th>'
    );
    s = s.replace(
      `<td className="py-2 px-2 text-center font-mono font-bold text-slate-500">\n                      {b.metrics?.skippedCount || 0}\n                    </td>`,
      `<td className="py-2 px-2 text-center font-mono font-bold text-slate-500">\n                      {b.metrics?.skippedCount || 0}\n                    </td>\n                    <td className="py-2 px-2 text-center font-mono font-bold text-rose-400">\n                      {b.metrics?.failedCount || 0}\n                    </td>`
    );
  }
  if (!s.includes("handleRetryFailed(b.id)")) {
    const anchor = `                      >\n                        {b.status}\n                      </span>`;
    if (!s.includes(anchor)) throw new Error('Retry button UI anchor missing');
    s = s.replace(anchor, `${anchor}\n                      {(b.metrics?.failedCount || 0) > 0 && (\n                        <button\n                          onClick={() => handleRetryFailed(b.id)}\n                          disabled={retryingBroadcastId === b.id}\n                          className="ml-2 px-2 py-0.5 rounded text-[9px] font-black bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"\n                        >\n                          {retryingBroadcastId === b.id ? 'Retrying…' : 'Retry Failed'}\n                        </button>\n                      )}`);
  }
  fs.writeFileSync(path, s);
}

// 6) Club-owner integrity panel from the already-loaded club read model (zero additional backend reads).
replaceOnce(
  'src/components/AdminView.tsx',
  "import { AdminTelegramTab } from './admin/AdminTelegramTab';",
  "import { AdminTelegramTab } from './admin/AdminTelegramTab';\nimport { AdminClubIntegrityPanel } from './admin/AdminClubIntegrityPanel';",
  'AdminClubIntegrityPanel'
);
replaceOnce(
  'src/components/AdminView.tsx',
  `{activeAdminTab === 'clubs' && (\n        <div className="space-y-4">\n          {/* Controls Bar */}`,
  `{activeAdminTab === 'clubs' && (\n        <div className="space-y-4">\n          <AdminClubIntegrityPanel clubs={clubs} />\n          {/* Controls Bar */}`,
  '<AdminClubIntegrityPanel clubs={clubs} />'
);

// 7) EFL Career V1: tracking is already backed by profile stats; normal users see locked Premium surface, admins get QA preview.
replaceOnce(
  'src/components/ProfileView.tsx',
  "import { ClubCrest } from './ClubCrest';",
  "import { ClubCrest } from './ClubCrest';\nimport { EflCareerCard } from './EflCareerCard';",
  "from './EflCareerCard'"
);
replaceOnce(
  'src/components/ProfileView.tsx',
  '      {/* Language Selector Card */}',
  `      <EflCareerCard userId={user?.id} adminPreview={Boolean(user?.isAdmin)} />\n\n      {/* Language Selector Card */}`,
  '<EflCareerCard userId={user?.id}'
);

// 8) Lightweight result-lifecycle contract regression.
const testPath = 'src/server/tests/smartResultLifecycleContractTest.ts';
if (!fs.existsSync(testPath)) {
  fs.writeFileSync(testPath, `import fs from 'node:fs';\nimport assert from 'node:assert/strict';\n\nconst source = fs.readFileSync('src/server/services/smartNotificationService.ts', 'utf8');\nassert(source.includes("status === 'PENDING_CONFIRMATION'"), 'missing verification lifecycle');\nassert(source.includes("eventId: \`\${eventBase}:verify:\${actorUserId}\`"), 'verification event must target the opponent');\nassert(source.includes("title: '⚡ Natijani tasdiqlang'"), 'verification message missing');\nassert(source.includes("status === 'CONFIRMED'"), 'confirmed lifecycle missing');\nassert(source.includes("eventId: \`\${eventBase}:confirmed\`"), 'confirmed event missing');\nassert(source.includes("status === 'DISPUTED'"), 'dispute lifecycle missing');\nassert(source.includes("eventId: \`\${eventBase}:disputed\`"), 'dispute event missing');\nassert(source.includes("replyMarkup: await fixtureReplyMarkup(fixture, actorUserId)"), 'verification must include opponent/result-topic actions');\nconsole.log('SMART_RESULT_LIFECYCLE_CONTRACT_PASS');\n`);
}

console.log('PHASE2_OPS_CAREER_PATCH_APPLIED');

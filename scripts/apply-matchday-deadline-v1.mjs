import fs from 'node:fs';

function replaceOnce(path, needle, replacement, guard) {
  const source = fs.readFileSync(path, 'utf8');
  if (guard && source.includes(guard)) return;
  if (!source.includes(needle)) throw new Error(`Patch needle not found in ${path}: ${needle.slice(0, 80)}`);
  fs.writeFileSync(path, source.replace(needle, replacement));
}

// Keep the selection regression lightweight.
{
  const path = 'src/server/services/matchdayReminderService.ts';
  let source = fs.readFileSync(path, 'utf8');
  source = source.replace("import { getResultSubmissions } from './adminService';\n", '');
  const needle = "  const submissions = await Promise.all(\n    current.map(async (fixture) => {";
  if (!source.includes("await import('./adminService')")) {
    if (!source.includes(needle)) throw new Error('Reminder service patch point missing');
    source = source.replace(needle, "  const { getResultSubmissions } = await import('./adminService');\n  const submissions = await Promise.all(\n    current.map(async (fixture) => {");
  }
  fs.writeFileSync(path, source);
}

replaceOnce(
  'src/server/routes/admin.routes.ts',
  "import { notifySmartMatchdayOpened } from '../services/smartNotificationService';\n",
  "import { notifySmartMatchdayOpened } from '../services/smartNotificationService';\nimport { notifyOutstandingMatchdayOwners } from '../services/matchdayReminderService';\n",
  'matchdayReminderService'
);

replaceOnce(
  'src/server/routes/admin.routes.ts',
  "adminRouter.get('/fixtures/validation', async (req: Request, res: Response) => {",
  `adminRouter.post('/competitions/:id/matchday/remind', async (req: Request, res: Response) => {
  const competitionId = req.params.id;
  const seasonId = typeof req.body?.seasonId === 'string' ? req.body.seasonId : 'season-2026-27';
  const matchday = Number(req.body?.matchday || 0);
  const deadlineAt = typeof req.body?.deadlineAt === 'string' ? req.body.deadlineAt : null;
  if (!Number.isInteger(matchday) || matchday <= 0) {
    res.status(400).json({ error: 'A positive integer matchday is required.', code: 'BAD_REQUEST' });
    return;
  }
  try {
    const result = await notifyOutstandingMatchdayOwners({ competitionId, seasonId, matchday, deadlineAt });
    res.json({ success: true, ...result });
  } catch (err: any) {
    handleFirestoreError(res, err, \`POST /api/admin/competitions/\${competitionId}/matchday/remind\`);
  }
});

adminRouter.get('/fixtures/validation', async (req: Request, res: Response) => {`,
  "matchday/remind'"
);

replaceOnce(
  'src/lib/api.ts',
  '  async setCompetitionMatchdayTimer(\n',
  `  async sendMatchdayReminders(
    competitionId: string,
    params: { matchday: number; seasonId?: string; deadlineAt?: string | null }
  ): Promise<{
    success: boolean;
    overdue: boolean;
    fixturesChecked: number;
    unfinishedFixtures: number;
    outstandingPlayers: number;
    queued: number;
    skipped: number;
  }> {
    return request(\`/api/admin/competitions/\${competitionId}/matchday/remind\`, {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async setCompetitionMatchdayTimer(
`,
  'sendMatchdayReminders('
);

replaceOnce(
  'src/components/AdminView.tsx',
  '  const handleSaveFixtureResult = async (params: { homeScore: number; awayScore: number; status?: string; notes?: string }) => {',
  `  const handleSendMatchdayReminder = async (compId: string, matchday: number, deadlineAt?: string | null) => {
    setIsProcessing(true);
    try {
      const res = await api.sendMatchdayReminders(compId, {
        matchday,
        seasonId: activeSeasonId,
        deadlineAt: deadlineAt || null,
      });
      const status = res.overdue ? 'OVERDUE' : 'active deadline';
      showToast(
        \`MD \${matchday} \${status}: \${res.queued}/\${res.outstandingPlayers} outstanding player reminder(s) queued.\`,
        res.queued > 0 ? 'success' : 'info'
      );
    } catch (err: any) {
      showToast(err.message || 'Failed to send matchday reminders.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveFixtureResult = async (params: { homeScore: number; awayScore: number; status?: string; notes?: string }) => {`,
  'handleSendMatchdayReminder ='
);

replaceOnce(
  'src/components/AdminView.tsx',
  "                const isOpen = override === 'FORCE_OPEN' || (override !== 'FORCE_LOCKED' && comp.isMatchdayOpen);\n\n                return (",
  "                const isOpen = override === 'FORCE_OPEN' || (override !== 'FORCE_LOCKED' && comp.isMatchdayOpen);\n                const deadlineIsOverdue = Boolean(comp.nextMatchdayOpenAt && Date.now() > new Date(comp.nextMatchdayOpenAt).getTime());\n\n                return (",
  'const deadlineIsOverdue = Boolean(comp.nextMatchdayOpenAt'
);

replaceOnce(
  'src/components/AdminView.tsx',
  `                      {comp.nextMatchdayOpenAt && (
                        <div className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>Timer: {new Date(comp.nextMatchdayOpenAt).toLocaleString()}</span>
                        </div>
                      )}
`,
  `                      {comp.nextMatchdayOpenAt && (
                        <div className={\`text-[10px] flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 border \${deadlineIsOverdue ? 'text-rose-300 bg-rose-500/10 border-rose-500/25' : 'text-slate-300 bg-slate-900/50 border-white/[0.04]'}\`}>
                          <span className="flex items-center gap-1">
                            <Clock className={\`w-3 h-3 \${deadlineIsOverdue ? 'text-rose-400' : 'text-slate-500'}\`} />
                            Deadline: {new Date(comp.nextMatchdayOpenAt).toLocaleString()}
                          </span>
                          {deadlineIsOverdue && <span className="font-black text-[9px] uppercase">Overdue</span>}
                        </div>
                      )}
`,
  'Deadline: {new Date(comp.nextMatchdayOpenAt)'
);

replaceOnce(
  'src/components/AdminView.tsx',
  `                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRebuildStandings(comp.id)}
`,
  `                      <button
                        onClick={() => handleSendMatchdayReminder(comp.id, currentMd, comp.nextMatchdayOpenAt)}
                        disabled={isProcessing}
                        className={\`w-full py-1.5 px-2 rounded-lg text-[10px] font-black flex items-center justify-center gap-1.5 border \${deadlineIsOverdue ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30' : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30'}\`}
                        title="Only players who have not submitted this matchday are notified"
                      >
                        <Send className="w-3 h-3" />
                        <span>{deadlineIsOverdue ? 'Remind Overdue Players' : 'Remind Unfinished Players'}</span>
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleRebuildStandings(comp.id)}
`,
  'Remind Unfinished Players'
);

{
  const path = 'package.json';
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  data.scripts['test:matchday-reminder'] = 'node scripts/run-isolated-test.mjs src/server/tests/matchdayReminderRegressionTest.ts';
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

replaceOnce(
  '.github/workflows/ci.yml',
  '          bun run test:matchday-locks\n',
  '          bun run test:matchday-locks\n          bun run test:matchday-reminder\n',
  'bun run test:matchday-reminder'
);

console.log('MATCHDAY_DEADLINE_V1_PATCH_APPLIED');

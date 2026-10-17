import type { ConversationTurn } from './telegramAiService';

export const AI_CONTEXT_TTL_SECONDS = 3600;
const MAX_TURNS = 12; // Six complete exchanges, scoped by the existing user/chat/topic key.
const MAX_TEXT_CHARS = 12000;
export interface AiMemoryLimits { maxTurns: number; maxTextChars: number; }
export const AI_INPUT_MAX_CHARS = 12000;
const USER_CHARS = AI_INPUT_MAX_CHARS;
const MODEL_CHARS = 3000;
type Selection = Pick<ConversationTurn, 'selectedClubIds' | 'selectedCompetitionIds' | 'selectedFixtureIds'>;

/** Old array records remain readable; malformed/unbounded stored data never reaches the model. */
export function normalizeAiHistory(value: unknown, limits: AiMemoryLimits = { maxTurns: MAX_TURNS, maxTextChars: MAX_TEXT_CHARS }): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ConversationTurn[] = value.slice(-limits.maxTurns).filter(item =>
    item && (item.role === 'user' || item.role === 'model') && typeof item.text === 'string'
  ).map(item => {
    const ids = (key: keyof Selection, limit: number) => Array.isArray(item[key])
      ? item[key].filter((id: unknown) => typeof id === 'string' && id.length <= 180).slice(0, limit) : undefined;
    return {
      role: item.role, text: Array.from(item.text).slice(0, item.role === 'user' ? USER_CHARS : MODEL_CHARS).join(''),
      ...(typeof item.memorySummary === 'string' ? { memorySummary: item.memorySummary.slice(-4000) } : {}),
      selectedClubIds: ids('selectedClubIds', 4), selectedCompetitionIds: ids('selectedCompetitionIds', 5), selectedFixtureIds: ids('selectedFixtureIds', 2),
    };
  });
  // Remove oldest complete exchanges first; never start a model conversation with an orphan answer.
  let size = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  while (turns.length && (turns[0].role !== 'user' || size > limits.maxTextChars)) {
    size -= turns.shift()!.text.length;
    while (turns[0]?.role === 'model') size -= turns.shift()!.text.length;
  }
  return turns;
}

export function appendAiExchange(history: ConversationTurn[], userText: string, modelText: string, selection: Selection = {}, limits?: AiMemoryLimits): ConversationTurn[] {
  const previous = normalizeAiHistory(history, limits);
  const retained: Selection = {};
  for (const key of ['selectedClubIds', 'selectedCompetitionIds', 'selectedFixtureIds'] as const) {
    // An explicit [] clears selection. Greetings/other turns with no selection preserve it.
    retained[key] = selection[key] ?? [...previous].reverse().find(turn => turn.role === 'user' && turn[key] !== undefined)?.[key];
  }
  const candidate: ConversationTurn[] = [
    ...previous, { role: 'user', text: userText, ...retained }, { role: 'model', text: modelText },
  ];
  const updated = normalizeAiHistory(candidate, limits);
  // Private memory uses a bounded extract of evicted exchanges, without an extra model call.
  // It is quoted conversation context, never evidence that a requested action happened.
  if (limits && limits.maxTurns > MAX_TURNS && updated.length) {
    const older = candidate.slice(0, candidate.length - updated.length);
    const summary = [previous.find(t => t.memorySummary)?.memorySummary || '',
      ...older.map(t => `${t.role === 'user' ? 'Savol/talab' : 'Oldingi javob (amal dalili emas)'}: ${Array.from(t.text).slice(0, t.role === 'user' ? 500 : 200).join('')}`)
    ].filter(Boolean).join('\n').slice(-4000);
    for (const turn of updated) delete turn.memorySummary;
    if (summary) updated[0].memorySummary = summary;
  }
  return updated;
}

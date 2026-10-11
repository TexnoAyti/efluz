import type { ConversationTurn } from './telegramAiService';

export const AI_CONTEXT_TTL_SECONDS = 3600;
const MAX_TURNS = 12; // Six complete exchanges, scoped by the existing user/chat/topic key.
const MAX_TEXT_CHARS = 12000;
const USER_CHARS = 1200;
const MODEL_CHARS = 3000;
type Selection = Pick<ConversationTurn, 'selectedClubIds' | 'selectedCompetitionIds' | 'selectedFixtureIds'>;

/** Old array records remain readable; malformed/unbounded stored data never reaches the model. */
export function normalizeAiHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ConversationTurn[] = value.slice(-MAX_TURNS).filter(item =>
    item && (item.role === 'user' || item.role === 'model') && typeof item.text === 'string'
  ).map(item => {
    const ids = (key: keyof Selection, limit: number) => Array.isArray(item[key])
      ? item[key].filter((id: unknown) => typeof id === 'string' && id.length <= 180).slice(0, limit) : undefined;
    return {
      role: item.role, text: Array.from(item.text).slice(0, item.role === 'user' ? USER_CHARS : MODEL_CHARS).join(''),
      selectedClubIds: ids('selectedClubIds', 4), selectedCompetitionIds: ids('selectedCompetitionIds', 5), selectedFixtureIds: ids('selectedFixtureIds', 2),
    };
  });
  // Remove oldest complete exchanges first; never start a model conversation with an orphan answer.
  let size = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  while (turns.length && (turns[0].role !== 'user' || size > MAX_TEXT_CHARS)) {
    size -= turns.shift()!.text.length;
    while (turns[0]?.role === 'model') size -= turns.shift()!.text.length;
  }
  return turns;
}

export function appendAiExchange(history: ConversationTurn[], userText: string, modelText: string, selection: Selection = {}): ConversationTurn[] {
  const previous = normalizeAiHistory(history);
  const retained: Selection = {};
  for (const key of ['selectedClubIds', 'selectedCompetitionIds', 'selectedFixtureIds'] as const) {
    // An explicit [] clears selection. Greetings/other turns with no selection preserve it.
    retained[key] = selection[key] ?? [...previous].reverse().find(turn => turn.role === 'user' && turn[key] !== undefined)?.[key];
  }
  return normalizeAiHistory([
    ...previous, { role: 'user', text: userText, ...retained }, { role: 'model', text: modelText },
  ]);
}

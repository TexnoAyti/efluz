import fs from 'node:fs/promises';
import path from 'node:path';

export interface TelegramUserbotRecipient {
  id: string;
  username?: string;
  displayName?: string;
  sourceChat: string;
  collectedAt: string;
}

export interface TelegramUserbotState {
  recipients: Record<string, TelegramUserbotRecipient>;
  sent: Record<string, string>;
  daily: { date: string; count: number };
}

export const emptyTelegramUserbotState = (): TelegramUserbotState => ({
  recipients: {}, sent: {}, daily: { date: new Date().toISOString().slice(0, 10), count: 0 },
});

export async function loadTelegramUserbotState(filePath: string): Promise<TelegramUserbotState> {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as TelegramUserbotState;
    return {
      recipients: parsed.recipients || {},
      sent: parsed.sent || {},
      daily: parsed.daily || emptyTelegramUserbotState().daily,
    };
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    return emptyTelegramUserbotState();
  }
}

export async function saveTelegramUserbotState(filePath: string, state: TelegramUserbotState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

export function resetDailyCounter(state: TelegramUserbotState, today = new Date().toISOString().slice(0, 10)) {
  if (state.daily.date !== today) state.daily = { date: today, count: 0 };
}

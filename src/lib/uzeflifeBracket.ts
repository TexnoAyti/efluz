/** UZEFLIFE championship: 8 groups of 32, followed by an 8-player final. */
export const UZEFLIFE_GROUPS = 8;
export const UZEFLIFE_GROUP_SIZE = 32;
export const UZEFLIFE_CAPACITY = UZEFLIFE_GROUPS * UZEFLIFE_GROUP_SIZE;
export type UzeflifeRound = { stage: 'QUALIFIER' | 'FINAL'; group: number | null; round: number; matches: [string, string][] };
function bracket(players: string[], stage: 'QUALIFIER' | 'FINAL', group: number | null): UzeflifeRound[] {
  if (players.length < 2 || (players.length & (players.length - 1)) !== 0) throw new Error('Ishtirokchilar soni 2 darajasi bo‘lishi kerak');
  const rounds: UzeflifeRound[] = [];
  let entrants = [...players];
  for (let round = 1; entrants.length > 1; round++) {
    const matches: [string, string][] = [];
    for (let i = 0; i < entrants.length; i += 2) matches.push([entrants[i], entrants[i + 1]]);
    rounds.push({stage, group, round, matches});
    // Future winners must be determined by confirmed match results, not assumed.
    entrants = matches.map((_, i) => `PENDING:${stage}:${group ?? 'final'}:${round}:${i}`);
  }
  return rounds;
}
export function createUzeflifeQualifier(players: string[]): UzeflifeRound[] {
  if (players.length !== UZEFLIFE_CAPACITY || new Set(players).size !== players.length) throw new Error('256 ta noyob ishtirokchi talab qilinadi');
  return Array.from({length: UZEFLIFE_GROUPS}, (_, group) =>
    bracket(players.slice(group * UZEFLIFE_GROUP_SIZE, (group + 1) * UZEFLIFE_GROUP_SIZE), 'QUALIFIER', group + 1)).flat();
}
export function createUzeflifeFinal(groupWinners: string[]): UzeflifeRound[] {
  if (groupWinners.length !== UZEFLIFE_GROUPS || new Set(groupWinners).size !== groupWinners.length || groupWinners.some(id => !id || id.startsWith('PENDING:'))) throw new Error('8 ta tasdiqlangan noyob g‘olib talab qilinadi');
  return bracket(groupWinners, 'FINAL', null);
}
export const UZEFLIFE_TOTAL_MATCHES = 255;
export const UZEFLIFE_CHAMPION_MATCHES = 8;

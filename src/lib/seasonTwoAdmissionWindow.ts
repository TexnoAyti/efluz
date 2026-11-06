/** UTC instants for November 6, 2026 in Asia/Tashkent (UTC+5). */
export const S2_OPENS_AT = '2026-11-06T15:00:00.000Z';
export const S2_PUBLIC_AT = '2026-11-06T15:15:00.000Z';
export type S2AdmissionPhase = 'NOT_STARTED' | 'PRIORITY' | 'PUBLIC';
export function seasonTwoAdmissionPhase(now: number = Date.now()): S2AdmissionPhase {
  if (now < Date.parse(S2_OPENS_AT)) return 'NOT_STARTED';
  return now < Date.parse(S2_PUBLIC_AT) ? 'PRIORITY' : 'PUBLIC';
}

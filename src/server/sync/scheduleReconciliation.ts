import { waitUntil } from '@vercel/functions';
import { getUpstashClient, KEY_PREFIX } from '../readModel/readModelStore';
import { firestoreCircuitBreaker } from '../firebase/circuitBreaker';
import { processPendingMutations, type SyncResult } from './mutationQueue';

export const RECONCILIATION_COOLDOWN_KEY = `${KEY_PREFIX}:outbox:recovery-cooldown`;

/** Request/cron-driven recovery: one batch per minute across instances, no new
 * Firestore reads when the durable outbox is empty, no timers in serverless. */
export async function reconcileDurableMutations(): Promise<SyncResult | null> {
  if (process.env.MIGRATION_WRITE_FREEZE === 'true') return null;
  // Migration previews must never consume the production Redis outbox.
  if (process.env.DATABASE_PROVIDER === 'supabase' && process.env.SUPABASE_DATA_NAMESPACE === 'preview') return null;
  const circuit = firestoreCircuitBreaker.getStatus();
  if (circuit.softLimitExceeded || (circuit.state === 'OPEN' && circuit.cooldownRemainingMs > 0)) return null;
  const client = getUpstashClient();
  if (!client) return null;
  const acquired = await client.set(RECONCILIATION_COOLDOWN_KEY, String(Date.now()), { nx: true, ex: 60 });
  if (!acquired) return null;
  return processPendingMutations({ deadline: Date.now() + 8000 });
}

export function scheduleMutationReconciliation(): void {
  const work = reconcileDurableMutations().catch(error => {
    console.warn('[MUTATION_RECOVERY] Deferred; durable records retained:', error?.message || error);
  });
  if (process.env.VERCEL === '1') waitUntil(work);
  else void work;
}

type Increment = {key: string; fields: ReadonlyArray<readonly [string, number]>};
type Commit = (entries: Increment[]) => Promise<void>;
type Pending = Increment & {commit: Commit; resolve: () => void; reject: (error: unknown) => void};
type Queue = {entries: Pending[]; active: boolean};
const queues = new WeakMap<object, Queue>();

/** Observability only. Merge current requests into a bounded durable write;
 * never combine these with permission checks, rate budgets or business writes. */
export function batchReadCostIncrement(database: object, key: string, fields: Increment['fields'], commit: Commit): Promise<1> {
  let queue = queues.get(database);
  if (!queue) { queue = {entries: [], active: false}; queues.set(database, queue); }
  if (queue.entries.length >= 4096) return Promise.reject(Error('READ_COST_BATCH_FULL'));
  const done = new Promise<void>((resolve, reject) => queue!.entries.push({key, fields, commit, resolve, reject}));
  if (!queue.active) {
    queue.active = true;
    setTimeout(() => { void drain(queue!); }, 3);
  }
  return done.then(() => 1 as const);
}
async function drain(queue: Queue): Promise<void> {
  try {
    while (queue.entries.length) {
      const keys = new Set<string>();
      let size = 0, pairs = 0;
      for (const entry of queue.entries) {
        if (size >= 256 || !keys.has(entry.key) && keys.size >= 30 || size > 0 && pairs + entry.fields.length > 4096) break;
        keys.add(entry.key); pairs += entry.fields.length; size++;
      }
      const entries = queue.entries.splice(0, size);
      try { await entries[0].commit(entries); entries.forEach(entry => entry.resolve()); }
      catch (error) { entries.forEach(entry => entry.reject(error)); }
    }
  } finally { queue.active = false; }
}

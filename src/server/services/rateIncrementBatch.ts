type Increment = {key: string; seconds: number};
type Commit = (entries: Increment[]) => Promise<number[]>;
type Pending = Increment & {commit: Commit; resolve: (count:number)=>void; reject: (error:unknown)=>void};
type Queue = {entries: Pending[]; active: boolean};
const queues = new WeakMap<object, Queue>();

/** Batch current requests, never reserve future capacity or cache permission.
 * Every caller receives its own durably committed increment. Different database
 * namespaces have different queue owners, and each transaction reads <=30 keys. */
export function batchRateIncrement(database: object, key: string, seconds: number, commit: Commit): Promise<number> {
  let queue = queues.get(database);
  if (!queue) {queue = {entries: [], active: false}; queues.set(database, queue);}
  const promise = new Promise<number>((resolve, reject) => queue!.entries.push({key, seconds, commit, resolve, reject}));
  if (!queue.active) {
    queue.active = true;
    // Tiny collection window coalesces parallel HTTP arrivals without adding a
    // database round trip. One drain per instance avoids local CAS collisions.
    setTimeout(() => {void drain(queue!);}, 3);
  }
  return promise;
}
async function drain(queue: Queue): Promise<void> {
  try {
    while (queue.entries.length) {
      const keys = new Set<string>();
      let size = 0;
      for (const entry of queue.entries) {
        if (size >= 256 || !keys.has(entry.key) && keys.size >= 30) break;
        keys.add(entry.key); size++;
      }
      const entries = queue.entries.splice(0, size);
      try {
        const counts = await entries[0].commit(entries);
        if (counts.length !== entries.length) throw Error('RATE_INCREMENT_RESULT_MISMATCH');
        entries.forEach((entry, index) => entry.resolve(counts[index]));
      } catch (error) {entries.forEach(entry => entry.reject(error));}
    }
  } finally {queue.active = false;}
}

import type { Redis } from '@upstash/redis';
import { getUpstashClient } from './readModelStore';
import { createPostgresRuntimeStore } from '../services/postgresRuntimeStore';

/** Select once by provider. A migrated deployment never consults Redis, even
 * when old credentials remain configured or PostgreSQL is unavailable. */
export function getRuntimeStateStore(): Redis | null {
  return process.env.DATABASE_PROVIDER === 'supabase'
    ? createPostgresRuntimeStore() as unknown as Redis
    : getUpstashClient();
}

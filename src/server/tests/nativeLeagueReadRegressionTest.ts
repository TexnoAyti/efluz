import { initDatabase } from '../db';
import { verifyNativeLeagueRead } from './nativeLeagueReadAudit';
await initDatabase();
process.env.DATABASE_PROVIDER='supabase';
process.env.SUPABASE_DATA_NAMESPACE='preview';
await verifyNativeLeagueRead();

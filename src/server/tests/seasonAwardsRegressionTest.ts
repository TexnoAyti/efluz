import {initDatabase} from '../db';
import {verifySeasonAwards} from './seasonAwardsAudit';
await initDatabase();await verifySeasonAwards();

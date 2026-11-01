import {initDatabase} from '../db';
import {verifyUzeflifeRoundPosts} from './uzeflifeRoundPostAudit';
await initDatabase();
await verifyUzeflifeRoundPosts();

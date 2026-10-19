import type { api } from './api';
import type { Season } from '../types';

type LoginApi = Pick<typeof api, 'getSeasons' | 'getDevProfiles' | 'authenticateTelegram' | 'authenticateDev' | 'getMe' | 'getSessionBootstrap'>;
type Identity = Awaited<ReturnType<LoginApi['authenticateTelegram']>> | Awaited<ReturnType<LoginApi['getMe']>> | Awaited<ReturnType<LoginApi['getSessionBootstrap']>>;
type DevProfiles = Awaited<ReturnType<LoginApi['getDevProfiles']>>['profiles'];

/** Start identity verification immediately; season discovery runs alongside it. */
export async function loadLoginBootstrap(client: LoginApi, initData: string, devUserId: string, onSeasons: (seasons: Season[]) => void, hasSession = false) {
  void client.getSeasons().then(result => {
    onSeasons(result.seasons);
    return result.seasons;
  }).catch(() => [] as Season[]);
  let profiles: DevProfiles = [];
  let identity: Identity | null = null;
  let mode: 'telegram' | 'dev' | 'session' | 'anonymous' = 'anonymous';
  const discoverDevProfiles = async () => {
    try { profiles = (await client.getDevProfiles()).profiles || []; }
    catch { profiles = []; }
    return profiles.length > 0;
  };

  if (initData) {
    try {
      identity = await client.authenticateTelegram(initData);
      mode = 'telegram';
    } catch (error) {
      // A development fallback still requires explicit permission from the server.
      if (!(await discoverDevProfiles())) throw error;
      identity = await client.authenticateDev(devUserId);
      mode = 'dev';
    }
  } else if (hasSession) {
    try { identity = await client.getSessionBootstrap(); mode = 'session'; }
    catch {
      if (await discoverDevProfiles()) { identity = await client.authenticateDev(devUserId); mode = 'dev'; }
    }
  } else if (await discoverDevProfiles()) {
    identity = await client.authenticateDev(devUserId);
    mode = 'dev';
  } else {
    try {
      identity = await client.getMe('season-2026-27');
      mode = 'session';
    } catch {
      // No verified Telegram data or valid session: never synthesize an identity.
    }
  }

  // Telegram/dev login must not wait for optional catalog metadata to finish.
  return { identity, mode, profiles };
}

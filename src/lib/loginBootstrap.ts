import type { api } from './api';
import type { Season } from '../types';

type LoginApi = Pick<typeof api, 'getSeasons' | 'getDevProfiles' | 'authenticateTelegram' | 'authenticateDev' | 'getMe'>;
type Identity = Awaited<ReturnType<LoginApi['authenticateTelegram']>> | Awaited<ReturnType<LoginApi['getMe']>>;
type DevProfiles = Awaited<ReturnType<LoginApi['getDevProfiles']>>['profiles'];

/** Start identity verification immediately; season discovery runs alongside it. */
export async function loadLoginBootstrap(client: LoginApi, initData: string, devUserId: string, onSeasons: (seasons: Season[]) => void) {
  const seasonsReady = client.getSeasons().then(result => {
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
  } else if (await discoverDevProfiles()) {
    identity = await client.authenticateDev(devUserId);
    mode = 'dev';
  } else {
    const seasons = await seasonsReady;
    const season = selectSeason(seasons);
    try {
      identity = await client.getMe(season?.id || 'season-2026-27');
      mode = 'session';
    } catch {
      // No verified Telegram data or valid session: never synthesize an identity.
    }
  }

  // Telegram/dev login must not wait for optional catalog metadata to finish.
  return { identity, mode, profiles };
}

function selectSeason(seasons: Season[]) {
  return seasons.find(season => season.status === 'registration' || season.status === 'active') || seasons[0];
}

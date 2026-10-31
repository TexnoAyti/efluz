import type { api } from './api';
import type { Season } from '../types';

type LoginApi = Pick<typeof api, 'getSeasons' | 'getDevProfiles' | 'authenticateTelegram' | 'authenticateDev' | 'getMe' | 'getSessionBootstrap'>;
type Identity = Awaited<ReturnType<LoginApi['authenticateTelegram']>> | Awaited<ReturnType<LoginApi['getMe']>> | Awaited<ReturnType<LoginApi['getSessionBootstrap']>>;
type DevProfiles = Awaited<ReturnType<LoginApi['getDevProfiles']>>['profiles'];

/** Start identity verification immediately; season discovery runs alongside it. */
export async function loadLoginBootstrap(client: LoginApi, initData: string, devUserId: string, onSeasons: (seasons: Season[]) => void, hasSession = false) {
  let seasonId = 'season-2026-27';
  void client.getSeasons().then(result => {
    seasonId = (result.seasons.find(season => season.status === 'registration' || season.status === 'active') || result.seasons[0])?.id || seasonId;
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
      if (hasSession && initData.length <= 4096) {
        try {
          // The server verifies the fresh launch signature and binds its user
          // to the signed session. No client-side identity parsing or trust.
          identity = await client.getSessionBootstrap(seasonId, initData);
          mode = 'session';
        } catch (error: any) {
          if (error?.httpStatus !== 401 && error?.httpStatus !== 403) throw error;
        }
      }
      if (!identity) {
        identity = await client.authenticateTelegram(initData);
        mode = 'telegram';
      }
    } catch (error: any) {
      // A slow/unavailable session service must not start another identity
      // write or development-discovery request while the database is down.
      if (hasSession && error?.httpStatus !== 401 && error?.httpStatus !== 403) throw error;
      // A development fallback still requires explicit permission from the server.
      if (!(await discoverDevProfiles())) throw error;
      identity = await client.authenticateDev(devUserId);
      mode = 'dev';
    }
  } else if (hasSession) {
    try { identity = await client.getSessionBootstrap(seasonId); mode = 'session'; }
    catch {
      if (await discoverDevProfiles()) { identity = await client.authenticateDev(devUserId); mode = 'dev'; }
    }
  } else if (await discoverDevProfiles()) {
    identity = await client.authenticateDev(devUserId);
    mode = 'dev';
  } else {
    try {
      identity = await client.getMe(seasonId);
      mode = 'session';
    } catch {
      // No verified Telegram data or valid session: never synthesize an identity.
    }
  }

  // Telegram/dev login must not wait for optional catalog metadata to finish.
  return { identity, mode, profiles };
}

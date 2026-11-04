import type {Fixture} from '../types';
import {getClubOwnerDisplay} from './ownerUtils';

/** Resolve the opponent of this fixture, never the page's featured fixture. */
export function fixtureOpponent(fixture: Fixture, clubId?: string | null) {
  if (!clubId) return null;
  const home = fixture.homeClubId === clubId || fixture.homeClub?.id === clubId;
  const away = fixture.awayClubId === clubId || fixture.awayClub?.id === clubId;
  if (!home && !away) return null;
  const club = home ? fixture.awayClub : fixture.homeClub;
  const current = home ? fixture.awayOwner || fixture.awayUser : fixture.homeOwner || fixture.homeUser;
  const ownerId = home ? fixture.awayOwnerId : fixture.homeOwnerId;
  // Current fixture ownership takes precedence over older club display metadata,
  // including when the current owner has no public Telegram username.
  return {clubName: club?.name || club?.shortName || '',
    owner: getClubOwnerDisplay(current ? undefined : club, current, ownerId)};
}

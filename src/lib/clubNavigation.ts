/** Club pages use their own URL without changing the current user's selected club. */
export function clubPagePath(clubId: string): string {
  return `/clubs/${encodeURIComponent(clubId)}`;
}

export function readClubPageId(pathname: string): string | null {
  const match = /^\/clubs\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  try {
    const id = decodeURIComponent(match[1]);
    return /^club-[a-z0-9_-]+$/i.test(id) ? id : null;
  } catch { return null; }
}

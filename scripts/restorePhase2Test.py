from pathlib import Path
import subprocess

path = Path('src/server/tests/phase2DurableMutationsTest.ts')
base = subprocess.check_output(['git', 'show', 'origin/main:src/server/tests/phase2DurableMutationsTest.ts'], text=True)
marker = """  await db.collection(COLLECTIONS.USER_MEMBERSHIPS).doc(`${seasonId}_${awayUserId}`).set({\n    userId: awayUserId, seasonId, clubId: 'club-tottenham', status: 'active',\n  });\n"""
insert = marker + """  // Durable replay authorizes against the authoritative club occupancy documents.\n  const claimedAt = new Date().toISOString();\n  await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_club-bournemouth`).set({\n    id: `${seasonId}_club-bournemouth`, seasonId, clubId: 'club-bournemouth', userId: homeUserId,\n    status: 'active', claimedAt, updatedAt: claimedAt,\n  });\n  await db.collection(COLLECTIONS.CLUB_OCCUPANCIES).doc(`${seasonId}_club-tottenham`).set({\n    id: `${seasonId}_club-tottenham`, seasonId, clubId: 'club-tottenham', userId: awayUserId,\n    status: 'active', claimedAt, updatedAt: claimedAt,\n  });\n"""
if marker not in base:
    raise SystemExit('phase2 ownership seed marker missing')
path.write_text(base.replace(marker, insert, 1))
print('phase2 test restored from main and authoritative occupancies seeded')

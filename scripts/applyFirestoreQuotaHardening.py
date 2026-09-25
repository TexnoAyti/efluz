from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

# 1) Emit explicit telemetry for any unexpectedly broad read.
replace_once(
    'src/server/firebase/firestoreStore.ts',
    """export function trackFirestoreRead(collectionName: string, count = 1, caller = 'unknown') {\n  readMetrics.sessionReads += count;\n  readMetrics.readsByCollection[collectionName] = (readMetrics.readsByCollection[collectionName] || 0) + count;\n  readMetrics.readsByFunction[caller] = (readMetrics.readsByFunction[caller] || 0) + count;\n}\n""",
    """export function trackFirestoreRead(collectionName: string, count = 1, caller = 'unknown') {\n  readMetrics.sessionReads += count;\n  readMetrics.readsByCollection[collectionName] = (readMetrics.readsByCollection[collectionName] || 0) + count;\n  readMetrics.readsByFunction[caller] = (readMetrics.readsByFunction[caller] || 0) + count;\n  if (count >= 100) {\n    console.warn('[FIRESTORE_HIGH_READ]', JSON.stringify({ collection: collectionName, count, caller }));\n  }\n}\n"""
)

# 2) My Matches: consume the durable Redis fixture snapshot before any Firestore club query.
replace_once(
    'src/server/firebase/firestoreStore.ts',
    """  try {\n    const db = getFirestoreDb();\n    const [homeSnap, awaySnap] = await Promise.all([\n""",
    """  try {\n    // Durable cross-instance read model first. This is critical on Vercel where\n    // process memory is not shared and a Firestore query on every cold instance\n    // would multiply reads by active users.\n    try {\n      const { redisGetFresh, redisGetLkg, ReadModelKeys } = await import('../readModel/readModelStore');\n      const adminKey = ReadModelKeys.adminFixtures(seasonId);\n      const snapshot = (await redisGetFresh<Fixture[]>(adminKey)) || (await redisGetLkg<Fixture[]>(adminKey));\n      if (snapshot && Array.isArray(snapshot.data) && snapshot.data.length > 0) {\n        const docs = snapshot.data\n          .filter((fixture) => fixture.homeClubId === clubId || fixture.awayClubId === clubId)\n          .map((fixture) => ({ ...fixture } as unknown as FirestoreFixtureDoc));\n        if (docs.length > 0) {\n          setInCache(cacheKey, docs, 300000);\n          return docs;\n        }\n      }\n    } catch (readModelErr: any) {\n      console.warn('[CLUB_FIXTURES_READ_MODEL_FALLBACK]', readModelErr?.message || readModelErr);\n    }\n\n    const db = getFirestoreDb();\n    const [homeSnap, awaySnap] = await Promise.all([\n"""
)

# 3) Never auto-scan the entire season in hosted production just because the admin Redis snapshot is missing.
replace_once(
    'src/server/readModel/readModelStore.ts',
    """  const effectiveSnapshotRes = snapshotRes || (await readThroughReadModel<Fixture[]>({\n""",
    """  if (!snapshotRes || !Array.isArray(snapshotRes.data) || snapshotRes.data.length === 0) {\n    const hosted = Boolean(process.env.VERCEL || process.env.K_SERVICE || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NODE_ENV === 'production');\n    if (hosted) {\n      console.warn('[FIRESTORE_BROAD_READ_BLOCKED]', JSON.stringify({ dataset: 'adminFixtures', seasonId }));\n      throw new ReadModelNotWarmedError(\n        'Admin fixture read model is not warmed. Automatic full-season Firestore scans are disabled in hosted production.'\n      );\n    }\n  }\n\n  const effectiveSnapshotRes = snapshotRes || (await readThroughReadModel<Fixture[]>({\n"""
)

# 4) Increase cross-instance notification reuse via durable Redis. Firestore remains authoritative on cache miss.
replace_once(
    'src/server/firebase/firestoreStore.ts',
    """export async function getUserNotificationsFirestore(userId: string, limit = 30): Promise<Notification[]> {\n  const cacheKey = `firestore:notifications:${userId}:${limit}`;\n  const cached = getFromCache<Notification[]>(cacheKey);\n  if (cached) return cached;\n\n  const validTypes""",
    """export async function getUserNotificationsFirestore(userId: string, limit = 30): Promise<Notification[]> {\n  const cacheKey = `firestore:notifications:${userId}:${limit}`;\n  const cached = getFromCache<Notification[]>(cacheKey);\n  if (cached) return cached;\n\n  const durableNotificationKey = `efluz:v1:user:${userId}:notifications:${limit}`;\n  try {\n    const { redisGetFresh, redisGetLkg } = await import('../readModel/readModelStore');\n    const durable = (await redisGetFresh<Notification[]>(durableNotificationKey)) ||\n      (await redisGetLkg<Notification[]>(durableNotificationKey));\n    if (durable && Array.isArray(durable.data)) {\n      setInCache(cacheKey, durable.data, 300000);\n      return durable.data;\n    }\n  } catch {}\n\n  const validTypes"""
)

replace_once(
    'src/server/firebase/firestoreStore.ts',
    """    setInCache(cacheKey, notifications, 30000);\n    return notifications;\n  } catch (err: any) {\n""",
    """    setInCache(cacheKey, notifications, 300000);\n    try {\n      const { redisSetRaw } = await import('../readModel/readModelStore');\n      await redisSetRaw(durableNotificationKey, {\n        data: notifications,\n        generatedAt: new Date().toISOString(),\n        sourceVersion: 'notifications-firestore',\n        expectedCount: notifications.length,\n        actualCount: notifications.length,\n      }, 300);\n    } catch {}\n    return notifications;\n  } catch (err: any) {\n"""
)

# Remove accidental staging marker if present.
Path('quota-hardening-marker.txt').unlink(missing_ok=True)
print('Firestore quota hardening patch applied')

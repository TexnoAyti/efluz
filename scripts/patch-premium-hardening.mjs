import fs from 'node:fs';

function patch(path, replacements) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`Pattern not found in ${path}: ${from.slice(0, 100)}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path, text);
}

patch('src/server/services/premiumService.ts', [
  [
    "const ORDERS_COLLECTION = 'premium_orders';\n",
    "const ORDERS_COLLECTION = 'premium_orders';\nconst PREMIUM_ORDER_TTL_MS = 60 * 60 * 1000;\n"
  ],
  [
    "export async function grantPremiumEntitlement(params: {\n",
    "async function assertPremiumTargetUserExists(userId: string): Promise<void> {\n  const db = getFirestoreDb();\n  const snap = await db.collection('users').doc(userId).get();\n  trackFirestoreRead('users', 1, 'assertPremiumTargetUserExists');\n  if (!snap.exists) throw new Error('PREMIUM_TARGET_USER_NOT_FOUND');\n}\n\nexport async function grantPremiumEntitlement(params: {\n"
  ],
  [
    "  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;\n  const now = new Date().toISOString();\n  const db = getFirestoreDb();\n  const ref = db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(params.userId, seasonId));\n",
    "  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;\n  await assertPremiumTargetUserExists(params.userId);\n  const now = new Date().toISOString();\n  const db = getFirestoreDb();\n  const ref = db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(params.userId, seasonId));\n"
  ],
  [
    "  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;\n  const db = getFirestoreDb();\n  const ref = db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(params.userId, seasonId));\n  const existing = await ref.get();\n  trackFirestoreRead(ENTITLEMENTS_COLLECTION, 1, 'revokePremiumEntitlement');\n",
    "  const seasonId = params.seasonId || PREMIUM_DEFAULT_SEASON_ID;\n  await assertPremiumTargetUserExists(params.userId);\n  const db = getFirestoreDb();\n  const ref = db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(params.userId, seasonId));\n  const existing = await ref.get();\n  trackFirestoreRead(ENTITLEMENTS_COLLECTION, 1, 'revokePremiumEntitlement');\n"
  ],
  [
    "      const orderSnap = await db.collection(ORDERS_COLLECTION).doc(orderId).get();\n      trackFirestoreRead(ORDERS_COLLECTION, 1, 'answerPremiumPreCheckout');\n      const order: any = orderSnap.data();\n      const telegramId = String(query?.from?.id || '');\n      if (!orderSnap.exists || !order || order.status !== 'PENDING') {\n        reason = 'This Premium order is already completed or expired.';\n      } else if (String(order.telegramId) !== telegramId) {\n        reason = 'This Premium invoice belongs to another Telegram account.';\n      } else {\n        accepted = true;\n      }\n",
    "      const orderSnap = await db.collection(ORDERS_COLLECTION).doc(orderId).get();\n      trackFirestoreRead(ORDERS_COLLECTION, 1, 'answerPremiumPreCheckout');\n      const order: any = orderSnap.data();\n      const telegramId = String(query?.from?.id || '');\n      const orderAgeMs = order?.createdAt ? Date.now() - new Date(order.createdAt).getTime() : Number.POSITIVE_INFINITY;\n      if (!orderSnap.exists || !order || order.status !== 'PENDING') {\n        reason = 'This Premium order is already completed or expired.';\n      } else if (String(order.telegramId) !== telegramId) {\n        reason = 'This Premium invoice belongs to another Telegram account.';\n      } else if (!Number.isFinite(orderAgeMs) || orderAgeMs > PREMIUM_ORDER_TTL_MS) {\n        reason = 'This Premium invoice expired. Please create a new invoice.';\n      } else {\n        const entitlementSnap = await db.collection(ENTITLEMENTS_COLLECTION).doc(entitlementId(order.userId, order.seasonId)).get();\n        trackFirestoreRead(ENTITLEMENTS_COLLECTION, 1, 'answerPremiumPreCheckout');\n        if (entitlementSnap.exists && entitlementSnap.data()?.status === 'ACTIVE') {\n          reason = 'Premium is already active for this season.';\n        } else {\n          accepted = true;\n        }\n      }\n"
  ]
]);

patch('src/server/routes/telegram.routes.ts', [
  [
    "telegramRouter.get('/premium/me', requireAuth, async (req: Request, res: Response) => {\n  const seasonId = normalizedSeasonId(req.query.seasonId);\n  try {\n",
    "telegramRouter.get('/premium/me', requireAuth, async (req: Request, res: Response) => {\n  const seasonId = normalizedSeasonId(req.query.seasonId);\n  if (!req.user!.isAdmin && !isPremiumPublicEnabled()) {\n    res.status(404).json({ error: 'PREMIUM_NOT_PUBLIC' });\n    return;\n  }\n  try {\n"
  ]
]);

patch('src/components/EflCareerCard.tsx', [
  [
    "Create {priceStars}⭐ test invoice for my admin account",
    "Create {priceStars}⭐ invoice for my admin account"
  ],
  [
    "The invoice is priced at exactly {priceStars} Stars and carries a server-created order ID. Premium activates only after Telegram sends a verified successful-payment webhook.",
    "The invoice is priced at exactly {priceStars} Stars and carries a server-created order ID. Premium activates only after Telegram sends a verified successful-payment webhook. On the production bot, completing checkout uses real Telegram Stars."
  ]
]);

console.log('Premium private-lab hardening patch applied.');

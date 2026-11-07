// Telegram Serverless isolates do not expose Node process.env.
// Deliberately locked. Enable only in a reviewed, isolated migration project,
// using an exact Telegram owner ID and the matching operator-controlled deploy.
// Never enable this on a production bot without a separate cutover review.
export const IMPORT_CONTROL = Object.freeze({
  enabled: false,
  ownerTelegramId: '',
});

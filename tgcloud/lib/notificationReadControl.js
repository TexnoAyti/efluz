// Notification read-state is the first serverless notification write.
// It is isolated from the global domain mutation switch: club claims,
// scores, chat and imports remain disabled on the staging branch.
export const NOTIFICATION_READ_CONTROL=Object.freeze({
  enabled:true,
  source:'telegram-serverless-staging',
});

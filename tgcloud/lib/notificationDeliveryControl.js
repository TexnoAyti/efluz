// Staging-only notification delivery switch. It does not unlock any domain
// mutation and only permits queueing existing inbox rows for delivery.
export const NOTIFICATION_DELIVERY_CONTROL=Object.freeze({
  enabled:true,
  source:'telegram-serverless-staging',
});

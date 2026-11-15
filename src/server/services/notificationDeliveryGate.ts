export type NotificationDeliveryMode = 'disabled' | 'isolated' | 'full';

/** Keep the emergency global pause in place while allowing only the durable
 * Telegram delivery queue to run in its own bounded serverless invocation.
 */
export function notificationDeliveryMode(
  env: NodeJS.ProcessEnv = process.env,
): NotificationDeliveryMode {
  if (env.MIGRATION_WRITE_FREEZE === 'true') return 'disabled';
  if (env.DATABASE_PROVIDER === 'supabase' && env.SUPABASE_DATA_NAMESPACE === 'preview') {
    return 'disabled';
  }
  if (env.DISABLE_BACKGROUND_WORKERS !== 'true') return 'full';
  return env.ENABLE_NOTIFICATION_DELIVERY_WORKER === 'true' ? 'isolated' : 'disabled';
}

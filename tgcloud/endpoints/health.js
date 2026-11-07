// Read-only endpoint used to verify the Mini App → Serverless connection.
export default async function (_input, ctx) {
  return {
    ok: true,
    service: 'efluz-serverless',
    telegramUserId: ctx?.initData?.user?.id ?? null,
    migrationMode: 'shadow',
  };
}

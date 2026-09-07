export function assertNonDestructiveFixtureGeneration(options: { force?: boolean } = {}): void {
  if (options.force === true) {
    throw new Error(
      'NON_DESTRUCTIVE_FIXTURE_POLICY: destructive fixture regeneration is disabled in production.'
    );
  }
}

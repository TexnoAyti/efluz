import { runTournamentArchitectureTests } from './verifyTournamentArchitecture';

async function main() {
  console.log('🚀 Running Tournament Architecture Verification...');
  const success = await runTournamentArchitectureTests();
  if (!success) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});

import fs from 'fs';
import path from 'path';

export function copyProductionAssets() {
  const root = process.cwd();
  const wasmSource = path.resolve(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  
  if (!fs.existsSync(wasmSource)) {
    throw new Error(`[ASSET BUILD ERROR] Cannot find sql-wasm.wasm at ${wasmSource}`);
  }

  const targetDirs = ['api', 'dist', 'public'];
  for (const dir of targetDirs) {
    const targetPath = path.resolve(root, dir);
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
    const destWasm = path.resolve(targetPath, 'sql-wasm.wasm');
    fs.copyFileSync(wasmSource, destWasm);
    const stat = fs.statSync(destWasm);
    console.log(` [ASSET] Copied sql-wasm.wasm -> ${path.relative(root, destWasm)} (${(stat.size / 1024).toFixed(1)} KB)`);
  }

  // Never ship a developer/test SQLite database as production tournament state.
  // The original data/efootball.sqlite is untouched; only remove an old generated copy.
  const generatedDb = path.resolve(root, 'api', 'data', 'efootball.sqlite');
  if (fs.existsSync(generatedDb)) fs.unlinkSync(generatedDb);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  copyProductionAssets();
}

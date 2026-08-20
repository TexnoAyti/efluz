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

  // Also ensure data/efootball.sqlite is copied into api/data for zero-config serverless seeding
  const dbSource = path.resolve(root, 'data', 'efootball.sqlite');
  if (fs.existsSync(dbSource)) {
    const apiDataDir = path.resolve(root, 'api', 'data');
    if (!fs.existsSync(apiDataDir)) {
      fs.mkdirSync(apiDataDir, { recursive: true });
    }
    const destDb = path.resolve(apiDataDir, 'efootball.sqlite');
    fs.copyFileSync(dbSource, destDb);
    console.log(` [ASSET] Copied efootball.sqlite -> ${path.relative(root, destDb)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  copyProductionAssets();
}

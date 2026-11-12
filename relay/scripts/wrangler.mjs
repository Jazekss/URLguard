// Palaiž wrangler ar konfigurāciju/pieslēgšanos F:\Projects\_deps\wrangler (nevis %APPDATA%) un bez telemetrijas.
import { spawnSync } from 'node:child_process';
import { join, dirname, isAbsolute, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..', '..');
const bin = join(here, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const configHome = resolve(process.env.URLGUARD_WRANGLER_HOME ?? 'F:/Projects/_deps/wrangler/config');

// Drošība: pieslēgšanās tokeni NEKAD nedrīkst nonākt projekta (git) mapē.
if (!isAbsolute(configHome) || configHome.toLowerCase().startsWith(project.toLowerCase())) {
  console.error(`Atteikts: wrangler konfigurācija (${configHome}) būtu projekta mapē.`);
  process.exit(1);
}
mkdirSync(configHome, { recursive: true });

const env = {
  ...process.env,
  XDG_CONFIG_HOME: configHome,
  WRANGLER_SEND_METRICS: 'false',
};
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit', env, cwd: join(here, '..') });
process.exit(r.status ?? 1);

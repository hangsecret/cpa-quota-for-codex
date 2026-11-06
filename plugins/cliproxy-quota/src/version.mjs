import fs from 'node:fs';

export const currentVersion = JSON.parse(fs.readFileSync(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8')).version;

import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../shared/account-shell.css', import.meta.url);
const source = await readFile(path, 'utf8');
const legacy = `  .hao-account-mount.is-floating {
    top: max(10px, env(safe-area-inset-top));
    right: max(10px, env(safe-area-inset-right));
  }

`;
if (!source.includes(legacy)) throw new Error('Legacy mobile floating account rule was not found.');
await writeFile(path, source.replace(legacy, ''), 'utf8');

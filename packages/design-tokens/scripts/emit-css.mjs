// Emits dist/tokens.css from the compiled token module.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildCssVariables } from '../dist/index.js';

const target = fileURLToPath(new URL('../dist/tokens.css', import.meta.url));
writeFileSync(target, buildCssVariables());
console.log(`design-tokens: wrote ${target}`);

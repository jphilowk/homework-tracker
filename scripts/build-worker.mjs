import { readFile, writeFile } from 'node:fs/promises';
const files = [['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/model.js', 'model.js', 'text/javascript'], ['/canvas-state.js', 'canvas-state.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']];
const assets = Object.fromEntries(await Promise.all(files.map(async ([path, file, type]) => [path, { content: (await readFile(new URL('../' + file, import.meta.url), 'utf8')).replace('<meta name="daybook-mode" content="local">', '<meta name="daybook-mode" content="connected">'), type: type + '; charset=utf-8' }])));
await writeFile(new URL('../backend/generated-assets.mjs', import.meta.url), `// Generated from the public UI allowlist. No environment variables are read.\nexport default ${JSON.stringify(assets)};\n`);
console.log('Built Worker UI from five public source files.');

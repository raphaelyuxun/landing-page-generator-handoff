import fs from 'node:fs';
import { generateImage } from '../src/aigw/client.js';
const t = Date.now();
const r = await generateImage('A photorealistic stainless steel ball valve on a clean white studio background, industrial product catalog photo, sharp focus');
fs.writeFileSync('/tmp/nano-test.png', r.buffer);
console.log(`✓ 出图成功 provider=nanobanana mime=${r.mime} bytes=${r.buffer.length} 用时=${((Date.now()-t)/1000).toFixed(1)}s → /tmp/nano-test.png`);

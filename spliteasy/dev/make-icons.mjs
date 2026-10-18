// Generates the PNG app icons in public/icons/ from the SVG logo. Run after changing the logo:
//   node dev/make-icons.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

// Same artwork as public/favicon.svg. `pad` shrinks the glyph so "maskable" icons survive
// Android's circle/squircle crop (the safe zone is the middle 80%).
const svg = ({ radius, pad }) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${radius}" fill="#0f9d6b"/>
  <g transform="translate(32 32) scale(${1 - pad}) translate(-32 -32)">
    <circle cx="32" cy="32" r="18" fill="none" stroke="#fff" stroke-width="5"/>
    <path d="M32 14v36" stroke="#fff" stroke-width="5"/>
    <path d="M32 32 47 22" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".7"/>
  </g>
</svg>`;

const icons = [
  { file: 'icon-192.png', size: 192, radius: 16, pad: 0 },
  { file: 'icon-512.png', size: 512, radius: 16, pad: 0 },
  { file: 'maskable-512.png', size: 512, radius: 0, pad: 0.3 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0, pad: 0.15 },
];

for (const i of icons) {
  await sharp(Buffer.from(svg(i)), { density: 600 }).resize(i.size, i.size).png().toFile(fileURLToPath(new URL(i.file, out)));
  console.log('wrote', i.file);
}

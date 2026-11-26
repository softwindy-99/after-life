import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'public', 'icons');
mkdirSync(outputDirectory, { recursive: true });

// Folded paper faces traced from the approved logo, inset for maskable launchers.
const background = [4, 3, 38, 255];
const cyan = [0, 240, 248, 255];
const magenta = [255, 0, 157, 255];
const faces = [
  {
    color: cyan,
    points: [
      [95, 190],
      [320, 190],
      [240, 300],
    ],
  },
  {
    color: cyan,
    points: [
      [99, 212],
      [208, 294],
      [99, 371],
    ],
  },
  {
    color: cyan,
    points: [
      [109, 381],
      [218, 304],
      [240, 317],
      [261, 300],
      [370, 381],
    ],
  },
  {
    color: cyan,
    points: [
      [268, 292],
      [381, 212],
      [381, 373],
    ],
  },
  {
    color: magenta,
    points: [
      [270, 263],
      [320, 190],
      [414, 125],
      [369, 212],
    ],
  },
];
const hex = (color) =>
  '#' +
  color
    .slice(0, 3)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
const paths = faces.map(
  ({ color, points }) =>
    `  <polygon points="${points.map((point) => point.join(',')).join(' ')}" fill="${hex(color)}"/>`,
);
writeFileSync(
  join(root, 'public', 'favicon.svg'),
  [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">',
    `  <rect width="512" height="512" fill="${hex(background)}"/>`,
    ...paths,
    '</svg>',
    '',
  ].join('\n'),
);

for (const size of [192, 512]) {
  writeFileSync(join(outputDirectory, `pwa-${size}.png`), createIcon(size));
}

function createIcon(size) {
  const channels = 4;
  const scanlineLength = size * channels + 1;
  const pixels = Buffer.alloc(scanlineLength * size);
  const samples = size < 256 ? 3 : 2;

  for (let y = 0; y < size; y += 1) {
    const row = y * scanlineLength;
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = ((x + (sx + 0.5) / samples) / size) * 512;
          const py = ((y + (sy + 0.5) / samples) / size) * 512;
          const color = sampleColor(px, py);
          for (let channel = 0; channel < channels; channel += 1) {
            totals[channel] += color[channel];
          }
        }
      }
      const offset = row + 1 + x * channels;
      const sampleCount = samples * samples;
      for (let channel = 0; channel < channels; channel += 1) {
        pixels[offset + channel] = Math.round(totals[channel] / sampleCount);
      }
    }
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', createHeader(size)),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function sampleColor(x, y) {
  for (const { color, points } of faces) {
    let inside = false;
    for (let i = 0; i < points.length; i += 1) {
      const [ax, ay] = points[i];
      const [bx, by] = points[(i + 1) % points.length];
      if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) {
        inside = !inside;
      }
    }
    if (inside) return color;
  }
  return background;
}

function createHeader(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return header;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

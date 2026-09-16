// Package the existing green PNG icons in the conventional /favicon.ico file.
// No image conversion or additional dependencies are needed.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const icons = ['favicon-32.png', 'favicon.png'].map(name => {
  const png = fs.readFileSync(path.join(root, name));
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG: ' + name);
  const size = png.readUInt32BE(16);
  if (size !== png.readUInt32BE(20) || size < 1 || size > 256) throw new Error('Invalid icon size: ' + name);
  return { png, size };
});
const directory = Buffer.alloc(6 + 16 * icons.length);
directory.writeUInt16LE(1, 2); // ICO, not a cursor.
directory.writeUInt16LE(icons.length, 4);
let offset = directory.length;
icons.forEach(({png, size}, index) => {
  const entry = 6 + index * 16;
  directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(png.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
fs.writeFileSync(path.join(root, 'favicon.ico'), Buffer.concat([directory, ...icons.map(icon => icon.png)]));
console.log('favicon.ico: current green logo at 32 and 192 pixels.');

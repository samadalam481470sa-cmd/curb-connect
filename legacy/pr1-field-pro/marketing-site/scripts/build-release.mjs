import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(root, '..', '..');
const packageDir = join(repoRoot, 'apps', 'field-pro-package');
const distDir = join(packageDir, 'dist');
const releasesDir = join(root, '..', 'public', 'releases');
const zipPath = join(releasesDir, 'field-pro-app.zip');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`);
  }
}

mkdirSync(releasesDir, { recursive: true });
run('npm', ['run', 'build', '-w', '@fieldline/field-pro-package'], repoRoot);

if (!existsSync(join(distDir, 'index.html')) || !existsSync(join(distDir, 'calc.js'))) {
  throw new Error('Package build did not produce dist/index.html and dist/calc.js');
}

const files = readdirSync(distDir).filter((name) => !name.startsWith('.'));
writeStoreZip(zipPath, distDir, files);

const bytes = readFileSync(zipPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(releasesDir, 'field-pro-app.sha256'), `${sha256}  field-pro-app.zip\n`);
writeFileSync(
  join(releasesDir, 'manifest.json'),
  JSON.stringify(
    {
      sku: 'field-pro-license',
      filename: 'field-pro-app.zip',
      bytes: bytes.length,
      sha256,
      builtAt: new Date().toISOString(),
      version: '1.0.0',
    },
    null,
    2,
  ),
);

console.log(`Release ready: ${zipPath} (${bytes.length} bytes)`);
console.log(`SHA-256: ${sha256}`);

function writeStoreZip(outFile, baseDir, names) {
  const entries = names.map((name) => ({
    name,
    data: readFileSync(join(baseDir, name)),
  }));
  const fd = openSync(outFile, 'w');
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc32(entry.data), 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    writeSync(fd, local);
    writeSync(fd, nameBuf);
    writeSync(fd, entry.data);
    central.push({ nameBuf, data: entry.data, offset });
    offset += 30 + nameBuf.length + entry.data.length;
  }
  const centralStart = offset;
  for (const entry of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(crc32(entry.data), 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(entry.nameBuf.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    writeSync(fd, header);
    writeSync(fd, entry.nameBuf);
    offset += 46 + entry.nameBuf.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  writeSync(fd, end);
  closeSync(fd);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

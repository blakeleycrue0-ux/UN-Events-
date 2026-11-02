// Packs extension/ into jarvis-chromebook.zip (published with the site) so the
// Chromebook can download it. Writes extension/config.js from the public
// Supabase settings first. Plain "stored" ZIP: no dependencies needed.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const publicConfig = fs.readFileSync(path.join(root, "supabase-config.js"), "utf8");
const url = /url:\s*"([^"]+)"/.exec(publicConfig)?.[1], anonKey = /key:\s*"([^"]+)"/.exec(publicConfig)?.[1];
if (!url || !anonKey) throw Error("supabase-config.js has no public url/key");
fs.writeFileSync(path.join(root, "extension", "config.js"),
  `// Generated from supabase-config.js: public project URL and anon key only.\nconst JARVIS_CONFIG = ${JSON.stringify({ url, anonKey })};\n`);

const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };

const files = fs.readdirSync(path.join(root, "extension")).sort()
  .map((name) => ({ name: "jarvis-chromebook/" + name, data: fs.readFileSync(path.join(root, "extension", name)) }));
const parts = [], central = [];
let offset = 0;
for (const f of files) {
  const name = Buffer.from(f.name), crc = crc32(f.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(f.data.length, 18); local.writeUInt32LE(f.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(f.data.length, 20); entry.writeUInt32LE(f.data.length, 24);
  entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
  parts.push(local, name, f.data); central.push(entry, name);
  offset += local.length + name.length + f.data.length;
}
const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(path.join(root, "jarvis-chromebook.zip"), Buffer.concat([...parts, ...central, end]));
console.log(`jarvis-chromebook.zip: ${files.length} files`);

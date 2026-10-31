/**
 * Generateur d'icones PNG (sans dependance externe).
 * Produit des icones degradees vertes dans public/icons/.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'icons')

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function hexToRgb(hex) {
  const value = hex.replace('#', '')
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}

const lerp = (a, b, t) => a + (b - a) * t

function makeIcon(size) {
  const top = hexToRgb('#1dd3a7')
  const bottom = hexToRgb('#0b7a5e')
  const raw = Buffer.alloc(size * (1 + size * 4))

  let offset = 0
  for (let y = 0; y < size; y++) {
    raw.writeUInt8(0, offset++) // filter: none
    const t = size === 1 ? 0 : y / (size - 1)
    const r = Math.round(lerp(top[0], bottom[0], t))
    const g = Math.round(lerp(top[1], bottom[1], t))
    const b = Math.round(lerp(top[2], bottom[2], t))
    for (let x = 0; x < size; x++) {
      raw.writeUInt8(r, offset++)
      raw.writeUInt8(g, offset++)
      raw.writeUInt8(b, offset++)
      raw.writeUInt8(255, offset++)
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(6, 9) // color type: RGBA
  ihdr.writeUInt8(0, 10)
  ihdr.writeUInt8(0, 11)
  ihdr.writeUInt8(0, 12)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })

const sizes = [16, 32, 48, 128]
for (const size of sizes) {
  const path = join(OUT_DIR, `icon${size}.png`)
  writeFileSync(path, makeIcon(size))
  console.log(`generated ${path}`)
}
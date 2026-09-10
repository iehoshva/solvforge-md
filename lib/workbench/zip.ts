/** ZIP STORE, UTF-8 paths. Chunked Blob parts avoid argument limits and boxed-byte arrays.
 * ZIP64 is explicitly rejected; every source byte is preserved, independently CRC-checked on import.
 */
export type ArchiveFile = { path: string; content: string | Uint8Array }
const encoder = new TextEncoder()
const table = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); return c >>> 0 })
export function crc32(data: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function validPath(path: string) { return !!path && !path.startsWith("/") && !path.includes("\\") && !path.includes("\0") && path.split("/").every((p) => !!p && p !== "." && p !== "..") }
export function makeZip(files: ArchiveFile[]) {
  if (files.length > 65535) throw new Error("ZIP64 required: this archive exceeds 65535 files.")
  const paths = new Set<string>(), parts: BlobPart[] = [], directory: BlobPart[] = []
  let offset = 0, directorySize = 0
  for (const file of files) {
    if (!validPath(file.path) || paths.has(file.path)) throw new Error(`Unsafe or duplicate archive path: ${file.path}`)
    paths.add(file.path)
    const name = encoder.encode(file.path), data = typeof file.content === "string" ? encoder.encode(file.content) : new Uint8Array(file.content)
    if (name.length > 65535 || data.length > 0xffffffff || offset + data.length + name.length + 30 > 0xffffffff) throw new Error("ZIP64 required: archive exceeds supported bounds.")
    const crc = crc32(data), local = new Uint8Array(30), h = new DataView(local.buffer)
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true)
    h.setUint16(12, 33, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true)
    parts.push(local, name, data)
    const central = new Uint8Array(46), d = new DataView(central.buffer)
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true)
    d.setUint16(14, 33, true); d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true)
    directory.push(central, name); directorySize += central.length + name.length; offset += local.length + name.length + data.length
  }
  if (offset + directorySize > 0xffffffff) throw new Error("ZIP64 required: archive exceeds supported bounds.")
  const end = new Uint8Array(22), e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true)
  return new Blob([...parts, ...directory, end], { type: "application/zip" })
}

/** Reads archives written by SolvForge. Unsupported compression/encryption fails explicitly. */
export async function readZip(blob: Blob): Promise<Array<{ path: string; bytes: Uint8Array }>> {
  const buffer = await blob.arrayBuffer(), bytes = new Uint8Array(buffer), d = new DataView(buffer), decoder = new TextDecoder("utf-8", { fatal: true })
  if (bytes.length < 22 || d.getUint32(bytes.length - 22, true) !== 0x06054b50) throw new Error("Not a supported SolvForge ZIP archive.")
  const count = d.getUint16(bytes.length - 12, true), result: Array<{ path: string; bytes: Uint8Array }> = [], seen = new Set<string>()
  let pos = d.getUint32(bytes.length - 6, true)
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || d.getUint32(pos, true) !== 0x02014b50) throw new Error("Damaged ZIP directory.")
    if (d.getUint16(pos + 10, true) !== 0 || d.getUint16(pos + 8, true) & 1) throw new Error("Only unencrypted ZIP STORE archives exported by SolvForge are supported.")
    const n = d.getUint16(pos + 28, true), x = d.getUint16(pos + 30, true), c = d.getUint16(pos + 32, true), size = d.getUint32(pos + 24, true), local = d.getUint32(pos + 42, true)
    const path = decoder.decode(bytes.subarray(pos + 46, pos + 46 + n))
    if (!validPath(path) || seen.has(path) || local + 30 > bytes.length || d.getUint32(local, true) !== 0x04034b50) throw new Error("Unsafe/duplicate path or damaged local file header.")
    seen.add(path)
    const start = local + 30 + d.getUint16(local + 26, true) + d.getUint16(local + 28, true)
    if (start + size > bytes.length) throw new Error("Truncated ZIP payload.")
    const data = bytes.slice(start, start + size)
    if (crc32(data) !== d.getUint32(pos + 16, true)) throw new Error(`Checksum mismatch: ${path}`)
    result.push({ path, bytes: data }); pos += 46 + n + x + c
  }
  return result
}

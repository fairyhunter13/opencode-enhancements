/**
 * FNV-1a 32-bit hash implementation.
 * Used for generating deterministic 8-char hex hashes of line content.
 */

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5 >>> 0 // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0 // FNV prime
  }
  return hash
}

/**
 * Hash arbitrary content to an 8-character hex string.
 * Deterministic: same input always produces same hash.
 */
export function hashContent(content: string): string {
  return fnv1a32(content).toString(16).padStart(8, "0")
}

/**
 * Hash a single line of text.
 * The line is trimmed and internal whitespace is normalized
 * so that whitespace-only differences don't change the hash.
 */
export function hashLine(line: string): string {
  const normalized = line.trim().replace(/\s+/g, " ")
  return hashContent(normalized)
}

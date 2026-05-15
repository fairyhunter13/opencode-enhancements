import { describe, it, expect } from "bun:test"
import { hashContent, hashLine } from "./hash"

describe("hashContent", () => {
  it("returns 8-char hex for any input", () => {
    // given
    const inputs = ["", "hello", "a".repeat(1000), "   ", "!@#$%^&*()"]

    // when/then
    for (const input of inputs) {
      const result = hashContent(input)
      expect(result).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it("is deterministic — same input → same hash", () => {
    // given
    const content = "function hello() { return 42; }"

    // when
    const hash1 = hashContent(content)
    const hash2 = hashContent(content)

    // then
    expect(hash1).toBe(hash2)
  })

  it("produces different hashes for different content", () => {
    // given
    const content1 = "hello world"
    const content2 = "hello World"

    // when
    const hash1 = hashContent(content1)
    const hash2 = hashContent(content2)

    // then
    expect(hash1).not.toBe(hash2)
  })

  it("empty string produces valid hash", () => {
    // given/when
    const result = hashContent("")

    // then
    expect(result).toMatch(/^[0-9a-f]{8}$/)
  })

  it("produces different hash for different content lengths", () => {
    // given
    const shortContent = "short"
    const longContent = "a very long string that should produce a completely different hash value"

    // when
    const hashShort = hashContent(shortContent)
    const hashLong = hashContent(longContent)

    // then
    expect(hashShort).not.toBe(hashLong)
  })

  it("handles unicode content", () => {
    // given/when
    const result = hashContent("héllo wörld 🎉")

    // then
    expect(result).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe("hashLine", () => {
  it("whitespace-only differences DON'T change hash", () => {
    // given
    const line1 = "  function hello() {"
    const line2 = "function hello() {"

    // when
    const hash1 = hashLine(line1)
    const hash2 = hashLine(line2)

    // then
    expect(hash1).toBe(hash2)
  })

  it("internal whitespace normalization ignores spacing differences", () => {
    // given
    const line1 = "if (a   &&   b) {"
    const line2 = "if (a && b) {"

    // when
    const hash1 = hashLine(line1)
    const hash2 = hashLine(line2)

    // then
    expect(hash1).toBe(hash2)
  })

  it("content differences DO change hash", () => {
    // given
    const line1 = "const x = 42"
    const line2 = "const x = 43"

    // when
    const hash1 = hashLine(line1)
    const hash2 = hashLine(line2)

    // then
    expect(hash1).not.toBe(hash2)
  })

  it("empty line produces a valid hash", () => {
    // given/when
    const result = hashLine("")

    // then
    expect(result).toMatch(/^[0-9a-f]{8}$/)
  })

  it("whitespace-only line produces same hash as empty line", () => {
    // given
    const empty = hashLine("")
    const spaces = hashLine("   ")
    const tabs = hashLine("\t\t")

    // then
    expect(spaces).toBe(empty)
    expect(tabs).toBe(empty)
  })

  it("trailing whitespace does not change hash", () => {
    // given
    const line1 = "return value;"
    const line2 = "return value;   "

    // when
    const hash1 = hashLine(line1)
    const hash2 = hashLine(line2)

    // then
    expect(hash1).toBe(hash2)
  })

  it("leading whitespace does not change hash", () => {
    // given
    const line1 = "return value;"
    const line2 = "    return value;"

    // when
    const hash1 = hashLine(line1)
    const hash2 = hashLine(line2)

    // then
    expect(hash1).toBe(hash2)
  })
})

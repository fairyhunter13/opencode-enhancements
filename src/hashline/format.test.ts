import { describe, it, expect } from "bun:test"
import { formatHashLines } from "./format"

describe("formatHashLines", () => {
  it("empty file produces empty content block", () => {
    // given/when
    const result = formatHashLines("")

    // then
    expect(result).toBe("<content>\n</content>")
  })

  it("single line is tagged with LINE#1:hash:content", () => {
    // given
    const content = "const x = 42"

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    expect(lines[0]).toBe("<content>")
    expect(lines[1]).toMatch(/^LINE#1:[0-9a-f]{8}:const x = 42$/)
    expect(lines[2]).toBe("</content>")
  })

  it("multi-line file tags every line", () => {
    // given
    const content = "line one\nline two\nline three"

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    expect(lines[0]).toBe("<content>")
    expect(lines[1]).toMatch(/^LINE#1:[0-9a-f]{8}:line one$/)
    expect(lines[2]).toMatch(/^LINE#2:[0-9a-f]{8}:line two$/)
    expect(lines[3]).toMatch(/^LINE#3:[0-9a-f]{8}:line three$/)
    expect(lines[4]).toBe("</content>")
  })

  it("preserves original indentation in content portion", () => {
    // given
    const content = "    indented line\n  partially indented"

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    // The content after the hash should preserve indentation
    expect(lines[1]).toMatch(/^LINE#1:[0-9a-f]{8}:    indented line$/)
    expect(lines[2]).toMatch(/^LINE#2:[0-9a-f]{8}:  partially indented$/)
  })

  it("empty lines get hash 00000000", () => {
    // given
    const content = "first\n\nthird"

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    expect(lines[0]).toBe("<content>")
    expect(lines[1]).toMatch(/^LINE#1:[0-9a-f]{8}:first$/)
    expect(lines[2]).toBe("LINE#2:00000000:")
    expect(lines[3]).toMatch(/^LINE#3:[0-9a-f]{8}:third$/)
    expect(lines[4]).toBe("</content>")
  })

  it("handles special characters", () => {
    // given
    const content = "const x = 'hello'; // this has $pecial chars && stuff"

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    expect(lines[0]).toBe("<content>")
    expect(lines[1]).toMatch(
      /^LINE#1:[0-9a-f]{8}:const x = 'hello'; \/\/ this has \$pecial chars && stuff$/,
    )
    expect(lines[2]).toBe("</content>")
  })

  it("handles emoji content", () => {
    // given
    const content = "🎉 party\n✨ sparkles"

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    expect(lines[0]).toBe("<content>")
    expect(lines[1]).toMatch(/^LINE#1:[0-9a-f]{8}:🎉 party$/)
    expect(lines[2]).toMatch(/^LINE#2:[0-9a-f]{8}:✨ sparkles$/)
    expect(lines[3]).toBe("</content>")
  })

  it("whitespace-only lines get hash 00000000", () => {
    // given
    const content = "start\n   \nend"

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    expect(lines[0]).toBe("<content>")
    expect(lines[1]).toMatch(/^LINE#1:[0-9a-f]{8}:start$/)
    expect(lines[2]).toBe("LINE#2:00000000:   ")
    expect(lines[3]).toMatch(/^LINE#3:[0-9a-f]{8}:end$/)
    expect(lines[4]).toBe("</content>")
  })

  it("content with trailing newline includes empty final line", () => {
    // given
    const content = "line1\nline2\n"

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    expect(lines[0]).toBe("<content>")
    expect(lines[1]).toMatch(/^LINE#1:[0-9a-f]{8}:line1$/)
    expect(lines[2]).toMatch(/^LINE#2:[0-9a-f]{8}:line2$/)
    expect(lines[3]).toBe("LINE#3:00000000:")
    expect(lines[4]).toBe("</content>")
  })

  it("line numbers increment correctly", () => {
    // given
    const content = Array.from({ length: 5 }, (_, i) => `line${i + 1}`).join("\n")

    // when
    const result = formatHashLines(content)

    // then
    const lines = result.split("\n")
    for (let i = 1; i <= 5; i++) {
      expect(lines[i]).toMatch(new RegExp(`^LINE#${i}:[0-9a-f]{8}:line${i}$`))
    }
  })
})

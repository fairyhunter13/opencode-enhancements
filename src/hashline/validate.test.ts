import { describe, it, expect } from "bun:test"
import { hashLine } from "./hash"
import { parseLineRef, validateEdit, applyEdit } from "./validate"
import type { HashlineEdit } from "./types"

const EMPTY_LINE_HASH = "00000000"

describe("parseLineRef", () => {
  it("parses valid LINE#ID reference", () => {
    // given
    const ref = "42#a1b2c3d4"

    // when
    const result = parseLineRef(ref)

    // then
    expect(result).toEqual({ line: 42, hash: "a1b2c3d4" })
  })

  it("throws on invalid format without hash", () => {
    // given
    const ref = "42:something"

    // when / then
    expect(() => parseLineRef(ref)).toThrow("{line_number}#{hash_id}")
  })

  it("throws on empty string", () => {
    // given/when/then
    expect(() => parseLineRef("")).toThrow("{line_number}#{hash_id}")
  })

  it("throws on non-numeric line number", () => {
    // given
    const ref = "abc#a1b2c3d4"

    // when / then
    expect(() => parseLineRef(ref)).toThrow("{line_number}#{hash_id}")
  })
})

describe("validateEdit", () => {
  it("returns valid for matching hash", () => {
    // given
    const content = "line one\nline two\nline three"
    const hash = hashLine("line two")
    const edit: HashlineEdit = { pos: `2#${hash}`, lines: "line deux" }

    // when
    const result = validateEdit(content, edit)

    // then
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it("returns invalid for mismatched hash", () => {
    // given
    const content = "line one\nline two\nline three"
    const edit: HashlineEdit = { pos: "2#00000000", lines: "line deux" }

    // when
    const result = validateEdit(content, edit)

    // then
    expect(result.valid).toBe(false)
    expect(result.error).toBe("content hash mismatch")
    expect(result.diagnostic).toContain("expected hash 00000000")
  })

  it("returns invalid for out-of-bounds line", () => {
    // given
    const content = "only one line"
    const edit: HashlineEdit = { pos: "5#a1b2c3d4", lines: "new content" }

    // when
    const result = validateEdit(content, edit)

    // then
    expect(result.valid).toBe(false)
    expect(result.error).toBe("line out of bounds")
    expect(result.diagnostic).toContain("File has 1 lines")
  })

  it("returns invalid for invalid position format", () => {
    // given
    const content = "some content"
    const edit: HashlineEdit = { pos: "not-valid", lines: "new content" }

    // when
    const result = validateEdit(content, edit)

    // then
    expect(result.valid).toBe(false)
    expect(result.error).toBe("invalid position reference")
  })

  it("validates empty line with 00000000 hash", () => {
    // given
    const content = "first\n\nthird"
    const edit: HashlineEdit = { pos: `2#${EMPTY_LINE_HASH}`, lines: "inserted" }

    // when
    const result = validateEdit(content, edit)

    // then
    expect(result.valid).toBe(true)
  })

  it("detects content change on a line", () => {
    // given — line 1 is "first" with some hash
    const content = "first\nsecond\nthird"
    const hash = hashLine("first")
    // Edit targets line 1 with an incorrect hash (e.g. from a different version)
    const badHash = hashLine("different")
    const edit: HashlineEdit = { pos: `1#${badHash}`, lines: "replacement" }

    // when
    const result = validateEdit(content, edit)

    // then
    expect(result.valid).toBe(false)
    expect(result.error).toBe("content hash mismatch")
  })

  it("validates line 1 correctly", () => {
    // given
    const content = "first line"
    const hash = hashLine("first line")
    const edit: HashlineEdit = { pos: `1#${hash}`, lines: "replaced first line" }

    // when
    const result = validateEdit(content, edit)

    // then
    expect(result.valid).toBe(true)
  })

  it("validates last line correctly", () => {
    // given
    const content = "a\nb\nc"
    const hash = hashLine("c")
    const edit: HashlineEdit = { pos: `3#${hash}`, lines: "z" }

    // when
    const result = validateEdit(content, edit)

    // then
    expect(result.valid).toBe(true)
  })
})

describe("applyEdit", () => {
  it("replaces a single line", () => {
    // given
    const content = "a\nb\nc"
    const hash = hashLine("b")
    const edit: HashlineEdit = { pos: `2#${hash}`, lines: "B" }

    // when
    const result = applyEdit(content, edit)

    // then
    expect(result).toBe("a\nB\nc")
  })

  it("replaces a single line with multiple lines", () => {
    // given
    const content = "a\nb\nc"
    const hash = hashLine("b")
    const edit: HashlineEdit = { pos: `2#${hash}`, lines: "B1\nB2" }

    // when
    const result = applyEdit(content, edit)

    // then
    expect(result).toBe("a\nB1\nB2\nc")
  })

  it("replaces a line when edit lines contains trailing newline", () => {
    // given
    const content = "a\nb\nc"
    const hash = hashLine("b")
    const edit: HashlineEdit = { pos: `2#${hash}`, lines: "B\n" }

    // when
    const result = applyEdit(content, edit)

    // then
    expect(result).toBe("a\nB\n\nc")
  })

  it("replaces first line", () => {
    // given
    const content = "first\nsecond\nthird"
    const hash = hashLine("first")
    const edit: HashlineEdit = { pos: `1#${hash}`, lines: "new first" }

    // when
    const result = applyEdit(content, edit)

    // then
    expect(result).toBe("new first\nsecond\nthird")
  })

  it("replaces last line", () => {
    // given
    const content = "first\nsecond\nthird"
    const hash = hashLine("third")
    const edit: HashlineEdit = { pos: `3#${hash}`, lines: "new third" }

    // when
    const result = applyEdit(content, edit)

    // then
    expect(result).toBe("first\nsecond\nnew third")
  })
})

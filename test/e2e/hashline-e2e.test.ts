/**
 * E2E tests for the Hashline feature.
 *
 * Tests the integration between Read tool output injection and Edit tool
 * validation via the plugin hooks.
 */
import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import * as fs from "node:fs"
import {
  createMockClient,
  createTempDir,
  createPluginInput,
  type TempDir,
} from "./harness"
import { createHashlineHooks } from "../../src/hashline/hook"
import { formatHashLines } from "../../src/hashline/format"
import { hashLine } from "../../src/hashline/hash"
import { parseLineRef, validateEdit, applyEdit } from "../../src/hashline/validate"
import type { HashlineEdit } from "../../src/hashline/types"

describe("Hashline E2E", () => {
  let tmp: TempDir

  beforeEach(() => {
    tmp = createTempDir("hashline-e2e-")
  })

  afterEach(() => {
    tmp.cleanup()
  })

  it("Read tool output gets LINE#ID hashes injected", async () => {
    // given: a file exists with content "hello\nworld"
    const filePath = `${tmp.path}/test.txt`
    fs.writeFileSync(filePath, "hello\nworld", "utf-8")
    const hooks = createHashlineHooks()

    // when: Read tool returns content without hashes
    const readAfter = hooks["tool.execute.after"]
    expect(readAfter).toBeDefined()

    const input = { tool: "read", sessionID: "s1", callID: "c1", args: {} }
    const output = { title: "", output: "<content>\n 1: hello\n 2: world\n</content>", metadata: {} }

    await readAfter!(input as any, output as any)

    // then: tool.execute.after hook injects LINE# hashes
    expect(output.output).toContain("LINE#")
    expect(output.output).toContain("LINE#1:")
    expect(output.output).toContain("LINE#2:")

    const line1Hash = hashLine("hello")
    const line2Hash = hashLine("world")
    expect(output.output).toContain(`LINE#1:${line1Hash}:hello`)
    expect(output.output).toContain(`LINE#2:${line2Hash}:world`)
  })

  it("Edit with matching hash proceeds successfully", async () => {
    // given: file read with hashline output, content unchanged
    const filePath = `${tmp.path}/test.txt`
    fs.writeFileSync(filePath, "hello\nworld", "utf-8")

    const hooks = createHashlineHooks()
    const editBefore = hooks["tool.execute.before"]
    expect(editBefore).toBeDefined()

    const line1Hash = hashLine("hello")

    const input = { tool: "edit", sessionID: "s1", callID: "c1" }
    const output = {
      args: {
        filePath,
        oldString: `LINE#1:${line1Hash}:hello`,
        newString: "hi",
      },
    }

    // when: Edit called with oldString containing LINE#1:hash:hello
    // then: should not throw (hash validates)
    await expect(
      editBefore!(input as any, output as any),
    ).resolves.toBeUndefined()

    // Verify prefixes were stripped
    expect((output.args as any).oldString).toBe("hello")
    expect((output.args as any).newString).toBe("hi")
  })

  it("Edit with stale hash is BLOCKED with error", async () => {
    // given: file read, then file modified externally
    const filePath = `${tmp.path}/test.txt`
    fs.writeFileSync(filePath, "hello\nworld", "utf-8")
    const hooks = createHashlineHooks()
    const editBefore = hooks["tool.execute.before"]
    expect(editBefore).toBeDefined()

    // Stale hash — content has changed to "goodbye"
    const staleHash = hashLine("hello")
    fs.writeFileSync(filePath, "goodbye\nworld", "utf-8")

    const input = { tool: "edit", sessionID: "s1", callID: "c1" }
    const output = {
      args: {
        filePath,
        oldString: `LINE#1:${staleHash}:hello`,
        newString: "hi",
      },
    }

    // when/then: Edit called with old hash should throw
    await expect(
      editBefore!(input as any, output as any),
    ).rejects.toThrow("expected hash")
  })

  it("Edit with stale hash is BLOCKED with error", async () => {
    // given: file read, then file modified externally
    const filePath = `${tmp.path}/test.txt`
    fs.writeFileSync(filePath, "hello\nworld", "utf-8")
    const hooks = createHashlineHooks()
    const editBefore = hooks["tool.execute.before"]
    expect(editBefore).toBeDefined()

    // Stale hash — content has changed to "goodbye"
    const staleHash = hashLine("hello")
    fs.writeFileSync(filePath, "goodbye\nworld", "utf-8")

    const input = { tool: "edit", sessionID: "s1", callID: "c1" }
    const output = {
      args: {
        filePath,
        oldString: `LINE#1:${staleHash}:hello`,
        newString: "hi",
      },
    }

    // when: Edit called with old hash for modified content
    // then: hook throws error with diagnostic, edit does NOT proceed
    await expect(
      editBefore!(input as any, output as any),
    ).rejects.toThrow("expected hash")
  })

  it("Batch: read→external change→edit rejected→reread→edit accepted", async () => {
    // given: initial file write
    const filePath = `${tmp.path}/test.txt`
    fs.writeFileSync(filePath, "line A\nline B\nline C", "utf-8")
    const hooks = createHashlineHooks()

    // Step 1: Read tool output is produced (simulate after hook)
    const readAfter = hooks["tool.execute.after"]
    expect(readAfter).toBeDefined()
    const readInput = { tool: "read", sessionID: "s1", callID: "c1", args: {} }
    const readOutput = { title: "", output: "<content>\n 1: line A\n 2: line B\n 3: line C\n</content>", metadata: {} }
    await readAfter!(readInput as any, readOutput as any)

    // Extract hash for line 2 from the transformed output
    const line2Match = readOutput.output.match(/LINE#2:([0-9a-f]{8}):/)
    expect(line2Match).not.toBeNull()
    const line2Hash = line2Match![1]!

    // Step 2: External mutation
    fs.writeFileSync(filePath, "line A\nline X\nline C", "utf-8")

    // Step 3: Edit rejected for line 2 (hook throws)
    const editBefore = hooks["tool.execute.before"]
    expect(editBefore).toBeDefined()
    const editOutput1 = {
      args: {
        filePath,
        oldString: `LINE#2:${line2Hash}:line B`,
        newString: "line Y",
      },
    }
    await expect(
      editBefore!(
        { tool: "edit", sessionID: "s1", callID: "c2" } as any,
        editOutput1 as any,
      ),
    ).rejects.toThrow("expected hash")

    // Step 4: Reread — get fresh hashes
    const newLine2Hash = hashLine("line X")
    const editOutput2 = {
      args: {
        filePath,
        oldString: `LINE#2:${newLine2Hash}:line X`,
        newString: "line Y",
      },
    }
    // then: edit with new hashes accepted (no throw)
    await expect(
      editBefore!(
        { tool: "edit", sessionID: "s1", callID: "c3" } as any,
        editOutput2 as any,
      ),
    ).resolves.toBeUndefined()
  })

  it("Non-edit/non-read tools are unaffected", async () => {
    // given: hooks created
    const hooks = createHashlineHooks()
    const readAfter = hooks["tool.execute.after"]
    const editBefore = hooks["tool.execute.before"]

    // when: bash tool passes through
    const bashInput = { tool: "bash", sessionID: "s1", callID: "c1", args: {} }
    const bashOutput = { title: "", output: "some output", metadata: {} }
    await readAfter!(bashInput as any, bashOutput as any)
    expect(bashOutput.output).toBe("some output")
    expect(bashOutput.output).not.toContain("LINE#")

    // when: grep tool goes through edit_before — no hashline refs
    const grepInput = { tool: "grep", sessionID: "s1", callID: "c2" }
    const grepOutput = { args: { pattern: "test", path: "/tmp" } }
    await expect(
      editBefore!(grepInput as any, grepOutput as any),
    ).resolves.toBeUndefined()
    expect(grepOutput.args.pattern).toBe("test")
  })

  it("formatHashLines wraps content with LINE# tags", () => {
    // given: raw content
    const content = "hello\nworld"

    // when: formatHashLines called
    const result = formatHashLines(content)

    // then: each line has LINE#<lineNumber>:<hash>: prefix
    const lines = result.split("\n")
    expect(lines[0]).toBe("<content>")
    expect(lines[1]).toMatch(/^LINE#1:[0-9a-f]{8}:hello$/)
    expect(lines[2]).toMatch(/^LINE#2:[0-9a-f]{8}:world$/)
    expect(lines[3]).toBe("</content>")
  })

  it("validateEdit rejects stale hash", () => {
    // given: original content
    const originalContent = "hello\nworld"

    // when: edit with stale hash
    const staleHash = hashLine("hello") // hash of original
    // simulate content changed
    const newContent = "goodbye\nworld"
    const edit: HashlineEdit = { pos: `1#${staleHash}`, lines: "hi" }

    // then: validation fails
    const result = validateEdit(newContent, edit)
    expect(result.valid).toBe(false)
    expect(result.error).toBe("content hash mismatch")
  })

  it("validateEdit accepts matching hash", () => {
    // given: content unchanged
    const content = "hello\nworld"
    const hash = hashLine("hello")
    const edit: HashlineEdit = { pos: `1#${hash}`, lines: "hi" }

    // when: validating matched hash
    const result = validateEdit(content, edit)

    // then: validation succeeds
    expect(result.valid).toBe(true)
  })

  it("applyEdit replaces line content at position", () => {
    // given: content and edit
    const content = "line A\nline B\nline C"
    const hash = hashLine("line B")
    const edit: HashlineEdit = { pos: `2#${hash}`, lines: "line X" }

    // when: applying edit
    const result = applyEdit(content, edit)

    // then: content is updated
    expect(result).toBe("line A\nline X\nline C")
  })

  it("hashContent and hashLine are deterministic", () => {
    // given: identical inputs
    const input = "  hello   world  "

    // when: hashing twice
    const h1 = hashLine(input)
    const h2 = hashLine(input)

    // then: same hash both times
    expect(h1).toBe(h2)
    // hashLine normalizes whitespace
    expect(hashLine("hello world")).toBe(h1)
  })

  it("parseLineRef parses valid ref and throws on invalid", () => {
    // given: valid ref
    const ref = parseLineRef("5#a1b2c3d4")
    expect(ref.line).toBe(5)
    expect(ref.hash).toBe("a1b2c3d4")

    // when: invalid ref
    expect(() => parseLineRef("not-a-ref")).toThrow("Invalid line reference")
    expect(() => parseLineRef("")).toThrow("Invalid line reference")
})
})

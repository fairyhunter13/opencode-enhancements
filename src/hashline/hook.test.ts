import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { hashLine } from "./hash"
import { createHashlineHooks } from "./hook"

// Helper to create a mock Read tool output
function makeReadOutput(filepath: string, lines: string[], totalLines?: number): string {
  const content = lines.map((line, i) => `${i + 1}: ${line}`).join("\n")
  const total = totalLines ?? lines.length
  return [
    `<path>${filepath}</path>`,
    `<type>file</type>`,
    `<content>`,
    content,
    ``,
    `(End of file - total ${total} lines)`,
    `</content>`,
  ].join("\n")
}

// Helper to create a mock Edit tool args
function makeEditArgs(filePath: string, oldString: string, newString: string) {
  return { filePath, oldString, newString }
}

describe("tool.execute.after (Read tool)", () => {
  it("injects hashline tags into Read tool output", async () => {
    // given
    const hooks = createHashlineHooks()
    const afterHook = hooks["tool.execute.after"]!
    const output = makeReadOutput("/path/file.ts", [
      "import { foo } from './bar'",
      "",
      "export function baz() {",
    ])
    const outputObj = { title: "file.ts", output, metadata: {} }

    // when
    await afterHook(
      { tool: "read", sessionID: "s1", callID: "c1", args: { filePath: "/path/file.ts" } },
      outputObj,
    )

    // then
    const resultLines = outputObj.output.split("\n")
    // Content block lines should have hashline tags
    expect(resultLines[3]).toMatch(/^1: LINE#1:[0-9a-f]{8}:import \{ foo \} from '\.\/bar'$/)
    expect(resultLines[4]).toMatch(/^2: LINE#2:[0-9a-f]{8}:$/)
    expect(resultLines[5]).toMatch(/^3: LINE#3:[0-9a-f]{8}:export function baz\(\) \{$/)
    // Non-content lines are preserved
    expect(resultLines[0]).toBe("<path>/path/file.ts</path>")
    expect(resultLines[1]).toBe("<type>file</type>")
    expect(resultLines[2]).toBe("<content>")
    expect(resultLines[6]).toBe("")
    expect(resultLines[7]).toContain("End of file")
    expect(resultLines[8]).toBe("</content>")
  })

  it("handles single-line file", async () => {
    // given
    const hooks = createHashlineHooks()
    const afterHook = hooks["tool.execute.after"]!
    const output = makeReadOutput("/path/file.ts", ["const x = 1"])
    const outputObj = { title: "file.ts", output, metadata: {} }

    // when
    await afterHook(
      { tool: "read", sessionID: "s1", callID: "c1", args: { filePath: "/path/file.ts" } },
      outputObj,
    )

    // then
    const resultLines = outputObj.output.split("\n")
    expect(resultLines[3]).toMatch(/^1: LINE#1:[0-9a-f]{8}:const x = 1$/)
  })

  it("does not modify non-read tool output", async () => {
    // given
    const hooks = createHashlineHooks()
    const afterHook = hooks["tool.execute.after"]!
    const originalOutput = "Some grep result"
    const outputObj = { title: "grep", output: originalOutput, metadata: {} }

    // when
    await afterHook(
      { tool: "grep", sessionID: "s1", callID: "c1", args: { pattern: "foo" } },
      outputObj,
    )

    // then
    expect(outputObj.output).toBe(originalOutput)
  })

  it("preserves empty line hash as 00000000", async () => {
    // given
    const hooks = createHashlineHooks()
    const afterHook = hooks["tool.execute.after"]!
    const output = makeReadOutput("/path/file.ts", ["hello", "", "world"])
    const outputObj = { title: "file.ts", output, metadata: {} }

    // when
    await afterHook(
      { tool: "read", sessionID: "s1", callID: "c1", args: { filePath: "/path/file.ts" } },
      outputObj,
    )

    // then
    const resultLines = outputObj.output.split("\n")
    expect(resultLines[4]).toMatch(/^2: LINE#2:00000000:$/)
  })

  it("handles output with no <content> tags gracefully", async () => {
    // given
    const hooks = createHashlineHooks()
    const afterHook = hooks["tool.execute.after"]!
    const outputObj = { title: "result", output: "no content tags here", metadata: {} }

    // when
    await afterHook(
      { tool: "read", sessionID: "s1", callID: "c1", args: { filePath: "/path/file.ts" } },
      outputObj,
    )

    // then
    expect(outputObj.output).toBe("no content tags here")
  })
})

describe("tool.execute.before (Edit tool)", () => {
  const testDir = "/tmp/hashline-test"
  const testFile = `${testDir}/test-edit.ts`
  const testContent = "line one\nline two\nline three"

  beforeEach(async () => {
    // Remove old, then create fresh. Bun.write creates parent dirs automatically.
    try { await Bun.spawn(["rm", "-rf", testDir]).exited } catch {}
    await Bun.write(testFile, testContent)
  })

  afterEach(async () => {
    // Cleanup
    try { await Bun.spawn(["rm", "-rf", testDir]).exited } catch {}
  })

  it("allows edit with valid hash reference and strips prefixes", async () => {
    // given
    const hooks = createHashlineHooks()
    const beforeHook = hooks["tool.execute.before"]!
    const lineHash = hashLine("line two")
    const args = makeEditArgs(
      testFile,
      `LINE#2:${lineHash}:line two`,
      "line deux",
    )
    const argsObj = { args }

    // when — should not throw
    await beforeHook(
      { tool: "edit", sessionID: "s1", callID: "c1" },
      argsObj,
    )

    // then — prefixes stripped from oldString and newString
    expect(argsObj.args.oldString).toBe("line two")
    expect(argsObj.args.newString).toBe("line deux")
  })

  it("blocks edit with stale hash reference by throwing", async () => {
    // given
    const hooks = createHashlineHooks()
    const beforeHook = hooks["tool.execute.before"]!
    const args = makeEditArgs(
      testFile,
      `LINE#2:00000000:line two`,
      "line deux",
    )
    const argsObj = { args }

    // when/then — should throw
    await expect(
      beforeHook({ tool: "edit", sessionID: "s1", callID: "c1" }, argsObj),
    ).rejects.toThrow("Hashline validation failed")
  })

  it("does not affect edit with no hashline references", async () => {
    // given
    const hooks = createHashlineHooks()
    const beforeHook = hooks["tool.execute.before"]!
    const args = makeEditArgs(
      testFile,
      "old content without hashline",
      "new content",
    )
    const argsObj = { args }

    // when — should not throw
    await beforeHook(
      { tool: "edit", sessionID: "s1", callID: "c1" },
      argsObj,
    )

    // then — strings unchanged
    expect(argsObj.args.oldString).toBe("old content without hashline")
    expect(argsObj.args.newString).toBe("new content")
  })

  it("does not affect non-edit tools", async () => {
    // given
    const hooks = createHashlineHooks()
    const beforeHook = hooks["tool.execute.before"]!
    const args = { filePath: testFile, query: "foo" }
    const argsObj = { args }

    // when — should not throw
    await beforeHook(
      { tool: "grep", sessionID: "s1", callID: "c1" },
      argsObj,
    )

    // then — args unchanged
    expect(argsObj.args.query).toBe("foo")
  })

  it("handles missing file gracefully with thrown error", async () => {
    // given
    const hooks = createHashlineHooks()
    const beforeHook = hooks["tool.execute.before"]!
    const args = makeEditArgs(
      "/nonexistent/path.ts",
      "LINE#1:a1b2c3d4:content",
      "new content",
    )
    const argsObj = { args }

    // when/then — should throw with file error
    await expect(
      beforeHook({ tool: "edit", sessionID: "s1", callID: "c1" }, argsObj),
    ).rejects.toThrow("Hashline validation failed")
  })

  it("allows edit with multiple valid hash references", async () => {
    // given
    const hooks = createHashlineHooks()
    const beforeHook = hooks["tool.execute.before"]!
    const hash1 = hashLine("line one")
    const hash2 = hashLine("line three")
    const oldString = [
      `LINE#1:${hash1}:line one`,
      `LINE#3:${hash2}:line three`,
    ].join("\n")
    const args = makeEditArgs(testFile, oldString, "replaced\ncontent")
    const argsObj = { args }

    // when — should not throw
    await beforeHook(
      { tool: "edit", sessionID: "s1", callID: "c1" },
      argsObj,
    )

    // then — prefixes stripped
    expect(argsObj.args.oldString).toBe("line one\nline three")
    expect(argsObj.args.newString).toBe("replaced\ncontent")
  })

  it("reports first mismatch when multiple refs have errors", async () => {
    // given
    const hooks = createHashlineHooks()
    const beforeHook = hooks["tool.execute.before"]!
    const hash2 = hashLine("line two")
    const oldString = [
      "LINE#1:00000000:line one",
      `LINE#2:${hash2}:line two`,
    ].join("\n")
    const args = makeEditArgs(testFile, oldString, "replacement")
    const argsObj = { args }

    // when/then — should throw with Line 1 mismatch
    await expect(
      beforeHook({ tool: "edit", sessionID: "s1", callID: "c1" }, argsObj),
    ).rejects.toThrow("Line 1")
  })
})

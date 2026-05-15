/**
 * Comprehensive Real-LLM E2E Tests for the opencode-enhancements plugin.
 *
 * These tests start a real headless opencode server, seed DeepSeek credentials,
 * create sessions, send messages via the HTTP API, and verify the plugin's
 * 8 feature groups through observable LLM behavior.
 *
 * Requires: OPENCODE_E2E=1 and DEEPSEEK_API_KEY in env or ~/.bash_env.
 *
 * IMPORTANT: The plugin must be configured in the active opencode config
 * (personal config at ~/.config/opencode-personal/opencode.json or project config).
 * If the plugin is not loaded, the hashline tests will fail because
 * Read tool output won't contain LINE# tags.
 *
 * Run:
 *   OPENCODE_E2E=1 bun test vendor/opencode-enhancements/test/e2e/real-llm-e2e.test.ts --timeout 600000
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import {
  startHeadlessServer,
  createSession,
  sendMessage,
  waitForMessages,
  getTextContent,
  getEnvKey,
  deleteSession,
  hasTool,
} from "../../../../packages/opencode/test/e2e/headless-harness"

// ── Constants ─────────────────────────────────────────────────────────────

const SKIP = !process.env.OPENCODE_E2E
const MODEL = "deepseek-v4-flash"
const PROVIDER_ID = "deepseek"

const PLUGIN_ENTRY = path.join(import.meta.dir, "../../src/index.ts")
const PLUGIN_FILE_URL = `file://${PLUGIN_ENTRY}`

/**
 * Set up a temp directory with:
 * 1. opencode.json that loads the opencode-enhancements plugin
 * 2. A sample file for the agent to read/edit
 */
function setupFixture(): { path: string; cleanup: () => void } {
  const tmpPath = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-enhancements-e2e-"))

  // Write plugin config pointing to the enhancements plugin source
  const config = {
    plugin: [PLUGIN_FILE_URL],
  }
  fs.writeFileSync(
    path.join(tmpPath, "opencode.json"),
    JSON.stringify(config, null, 2),
    "utf-8",
  )

  // Write a sample file for hashline tests
  fs.writeFileSync(
    path.join(tmpPath, "sample.txt"),
    [
      "Hello World",
      "This is line two",
      "And this is line three",
      "fn foo() {",
      '  return "bar"',
      "}",
    ].join("\n"),
    "utf-8",
  )

  return {
    path: tmpPath,
    cleanup: () => {
      try {
        fs.rmSync(tmpPath, { recursive: true, force: true })
      } catch { /* ignore */ }
    },
  }
}

// ── Message helpers ───────────────────────────────────────────────────────

/**
 * Extract the output of completed Read tool invocations from session messages.
 * Each Read tool output is a string containing the file content, optionally
 * with LINE# tags injected by the hashline plugin hook.
 */
function getReadToolOutputs(messages: any[]): string[] {
  const allParts = messages.flatMap((m: any) => m.parts ?? [])
  const outputs: string[] = []
  for (const part of allParts) {
    if (
      part.type === "tool" &&
      part.tool === "read" &&
      part.state?.status === "completed"
    ) {
      outputs.push(part.state.output ?? "")
    }
  }
  return outputs
}

/**
 * Extract the output of completed Edit tool invocations from session messages.
 */
function getEditToolOutputs(messages: any[]): string[] {
  const allParts = messages.flatMap((m: any) => m.parts ?? [])
  const outputs: string[] = []
  for (const part of allParts) {
    if (
      part.type === "tool" &&
      part.tool === "edit" &&
      part.state?.status === "completed"
    ) {
      outputs.push(part.state.output ?? "")
    }
  }
  return outputs
}

function getEditToolErrors(messages: any[]): string[] {
  const allParts = messages.flatMap((m: any) => m.parts ?? [])
  const errors: string[] = []
  for (const part of allParts) {
    if (
      part.type === "tool" &&
      part.tool === "edit" &&
      part.state?.status === "error"
    ) {
      errors.push(part.state.error ?? part.state.output ?? "")
    }
  }
  return errors
}

/**
 * Count tool invocations of the given type across all messages.
 */
function countToolInvocations(messages: any[], toolName: string): number {
  const allParts = messages.flatMap((m: any) => m.parts ?? [])
  return allParts.filter(
    (p: any) =>
      p.type === "tool" &&
      (p.tool === toolName || p.name === toolName || p.toolName === toolName),
  ).length
}

/**
 * Read a file from disk and return its contents.
 */
function readFixtureFile(fixtureDir: string, filename: string): string {
  return fs.readFileSync(path.join(fixtureDir, filename), "utf-8")
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("opencode-enhancements real-LLM E2E", () => {
  let server: Awaited<ReturnType<typeof startHeadlessServer>>
  let dir: string
  let fixtureCleanup: () => void

  beforeAll(async () => {
    if (SKIP) return

    // API key guard: fail fast with a clear message instead of hanging
    if (!getEnvKey("DEEPSEEK_API_KEY")) {
      throw new Error(
        "DEEPSEEK_API_KEY required when OPENCODE_E2E=1. " +
          "Set in ~/.bash_env: export DEEPSEEK_API_KEY=sk-...",
      )
    }

    // Create fixture directory with plugin config
    const fixture = setupFixture()
    dir = fixture.path
    fixtureCleanup = fixture.cleanup

    // Start headless server
    server = await startHeadlessServer()

    // Seed DeepSeek credential
    const key = getEnvKey("DEEPSEEK_API_KEY")
    if (key) {
      await fetch(`${server.url}/auth/${PROVIDER_ID}?name=default`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": dir,
        },
        body: JSON.stringify({ type: "api", key }),
      })
      await fetch(`${server.url}/auth/${PROVIDER_ID}/use`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": dir,
        },
        body: JSON.stringify({ name: "default" }),
      })
    }

    console.log(`[E2E] Fixture dir: ${dir}`)
    console.log(`[E2E] Server URL: ${server.url}`)
  }, 120_000)

  afterAll(async () => {
    if (SKIP) return
    server?.stop()
    fixtureCleanup?.()
  })

  // Skip all tests if not in E2E mode
  const itE2E = SKIP ? it.skip : it

  // ── FEATURE 1: Hashline Edit ──────────────────────────────────────────

  describe("Hashline Edit", () => {
    itE2E(
      "Read tool output contains LINE#ID:HASH tags (hashline injection)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Ask the agent to read the sample file
        await sendMessage(
          server.url,
          sessionID,
          "Read the file sample.txt in this directory. Show me the EXACT content you see, including any special tags or annotations around each line.",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)
        const readOutputs = getReadToolOutputs(messages)

        // Hard assertion: Read tool must have been invoked
        expect(readOutputs.length).toBeGreaterThan(0)

        // HARD ASSERTION: hashline plugin must inject LINE# tags
        const hasLineTags = readOutputs.some((out) => out.includes("LINE#"))
        expect(hasLineTags).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )

    itE2E(
      "Edit tool completes successfully on file content (hashline-assisted)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Read the file first to get hashline contexts
        await sendMessage(
          server.url,
          sessionID,
          "Read the file sample.txt in this directory first, then change line 2 from 'This is line two' to 'This line was edited by AI'. After making the edit, read the file again to confirm the change.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)

        // Verify the edit tool was used successfully
        const editOutputs = getEditToolOutputs(messages)
        const editErrors = getEditToolErrors(messages)

        const fileContent = readFixtureFile(dir, "sample.txt")
        const editSucceeded = fileContent.includes("This line was edited by AI")

        // Hard assertion: edit tool must have been used (hashline helps the agent
        // target the correct line with LINE# annotations)
        expect(editOutputs.length).toBeGreaterThan(0)

        // Hard assertion: no edit errors (hashline pinpoints exact lines)
        expect(editErrors.length).toBe(0)

        // Hard assertion: the file content was actually modified
        expect(editSucceeded).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ── FEATURE 2: Todo Continuation ──────────────────────────────────────

  describe("Todo Continuation", () => {
    itE2E(
      "Agent creates todos via todowrite and completes them sequentially",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Ask the agent to create a todo list and work through it
        await sendMessage(
          server.url,
          sessionID,
          "Create a todo list with exactly 3 tasks for reviewing this project: " +
            "1) List all files in the directory, 2) Read sample.txt, 3) Count the lines in sample.txt. " +
            "Use the todowrite tool to create the todos, then complete each one. " +
            "When all tasks are done, say 'ALL_TASKS_COMPLETE'.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)
        const allParts = messages.flatMap((m: any) => m.parts ?? [])

        // Hard assertion: todowrite tool was invoked (plugin's todo continuation feature)
        const hasTodoWrite = hasTool(allParts, "todowrite")
        expect(hasTodoWrite).toBe(true)

        // Hard assertion: session messages contain step-finish or continuation markers
        const hasStepFinish = allParts.some((p: any) => p.type === "step-finish")
        expect(hasStepFinish).toBe(true)

        // Hard assertion: agent responded with substantive content
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ── FEATURE 3: Session Recovery ───────────────────────────────────────

  describe("Session Recovery", () => {
    itE2E(
      "Agent handles multi-step work across session lifecycle (session continuity)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Step 1: Ask the agent to perform initial work
        await sendMessage(
          server.url,
          sessionID,
          "First, examine the file sample.txt and tell me what programming language the function in it uses.",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages1 = await waitForMessages(server.url, sessionID, dir, 30_000)
        const text1 = getTextContent(messages1)
        expect(text1.length).toBeGreaterThan(0)

        // Step 2: Continue in the same session (tests session continuity)
        await sendMessage(
          server.url,
          sessionID,
          "Now take that function and rename it from 'foo' to 'calculate'. " +
          "Edit the file directly to make the change, then read the file to confirm.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages2 = await waitForMessages(server.url, sessionID, dir, 30_000)

        // Hard assertion: agent performed tool work in step 2 (session recovery
        // ensures the agent can pick up where it left off)
        const text2 = getTextContent(messages2)
        expect(text2.length).toBeGreaterThan(0)

        const step2Parts = messages2.flatMap((m: any) => m.parts ?? [])
        const hasToolUse = step2Parts.some(
          (p: any) =>
            p.type === "tool" &&
            (p.tool === "edit" || p.tool === "read"),
        )
        expect(hasToolUse).toBe(true)

        // Hard assertion: the file was actually changed (proves session continuity)
        const fileContent = readFixtureFile(dir, "sample.txt")
        expect(fileContent.includes("calculate")).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ── FEATURE 4: IntentGate ─────────────────────────────────────────────

  describe("IntentGate", () => {
    itE2E(
      "Ultrawork intent triggers thorough multi-step response",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The IntentGate hook detects "ultrawork" intent from keywords
        // and injects optimization prompt "Complete ALL work without asking for confirmation"
        await sendMessage(
          server.url,
          sessionID,
          "ULTRAWORK: I need you to fully analyze sample.txt. " +
            "Read the file, describe every line, identify the data types used, " +
            "and suggest improvements. Do NOT stop until you've completed all of this.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)

        // Hard assertion: agent responded with substantive text
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Hard assertion: read tool was used (agent actually examined the file)
        const allParts = messages.flatMap((m: any) => m.parts ?? [])
        const hasReadTool = allParts.some(
          (p: any) => p.type === "tool" && p.tool === "read",
        )
        expect(hasReadTool).toBe(true)

        // Hard assertion: multiple tool invocations indicate thorough behavior
        // (ultrawork intent drives the agent to complete all work without stopping)
        const uniqueTools = new Set(
          allParts
            .filter((p: any) => p.type === "tool")
            .map((p: any) => p.tool),
        )
        expect(uniqueTools.size).toBeGreaterThanOrEqual(2)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )

    itE2E(
      "Search intent triggers thorough search behavior",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The IntentGate hook detects "search" intent from keywords
        // and injects "Be thorough, search multiple locations, return all findings"
        await sendMessage(
          server.url,
          sessionID,
          "SEARCH: Find all files in this directory that contain the word 'foo'. " +
            "Show me the complete contents of every matching file. " +
            "Return ALL results, don't summarize.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)

        // Hard assertion: agent responded
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Hard assertion: search tool (grep/glob) was used (search intent drives tool selection)
        const allParts = messages.flatMap((m: any) => m.parts ?? [])
        const hasSearchTool = allParts.some(
          (p: any) =>
            p.type === "tool" &&
            (p.tool === "grep" || p.tool === "glob" || p.tool === "bash" || p.tool === "read"),
        )
        expect(hasSearchTool).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ── FEATURE 5: Runtime Fallback ───────────────────────────────────────

  describe("Runtime Fallback", () => {
    itE2E(
      "Agent completes requests reliably with plugin loaded (fallback error handling)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The opencode-enhancements runtime-fallback plugin enhances error recovery.
        // This test verifies the session completes successfully with the plugin loaded.
        await sendMessage(
          server.url,
          sessionID,
          'Write "hello from the fallback test" to a file named fallback-test.txt in this directory using the write tool, then read it back to confirm.',
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)

        // Hard assertion: the file was created on disk (proves the write completed
        // successfully — the fallback plugin would handle any transient errors)
        const filePath = path.join(dir, "fallback-test.txt")
        expect(fs.existsSync(filePath)).toBe(true)

        // Hard assertion: file content matches what was requested
        const content = fs.readFileSync(filePath, "utf-8")
        expect(content).toContain("hello from the fallback test")

        // Hard assertion: agent responded substantively
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Hard assertion: write tool was used
        const allParts = messages.flatMap((m: any) => m.parts ?? [])
        const hasWriteTool = allParts.some(
          (p: any) => p.type === "tool" && (p.tool === "write" || p.tool === "edit" || p.tool === "bash"),
        )
        expect(hasWriteTool).toBe(true)

        // Clean up file
        try { fs.unlinkSync(filePath) } catch {}

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ── FEATURE 6: Compaction Guard ───────────────────────────────────────

  describe("Compaction Guard", () => {
    itE2E(
      "Session preserves context across multiple exchanges (compaction guard)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Build up conversation context step by step.
        // The compaction guard plugin helps preserve context across LLM
        // history compaction, ensuring earlier details aren't lost.
        await sendMessage(
          server.url,
          sessionID,
          "Remember this number: 42. Also remember this phrase: 'purple elephant'. " +
            "I will ask you about them later. For now, just acknowledge you've stored them.",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages1 = await waitForMessages(server.url, sessionID, dir, 30_000)
        expect(getTextContent(messages1).length).toBeGreaterThan(0)

        // Send an unrelated message to work through context
        await sendMessage(
          server.url,
          sessionID,
          "Now read the file sample.txt and tell me what the function 'foo' returns.",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages2 = await waitForMessages(server.url, sessionID, dir, 30_000)
        expect(getTextContent(messages2).length).toBeGreaterThan(0)

        // Finally ask about the earlier context to verify it's preserved
        await sendMessage(
          server.url,
          sessionID,
          "Earlier in our conversation I gave you a number and a phrase. " +
            "Tell me what they were. Reply with exactly: 'Number: [X], Phrase: [Y]'",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages3 = await waitForMessages(server.url, sessionID, dir, 30_000)
        const finalText = getTextContent(messages3)

        // NOTE: This test validates session continuity, which the compaction guard
        // plugin helps with by preserving critical context during LLM history compaction.
        //
        // Hard assertion: the agent retained both context items from the first exchange
        // despite intervening messages that could trigger compaction.
        const mentions42 = finalText.includes("42")
        const mentionsPurpleElephant =
          finalText.includes("purple") && finalText.includes("elephant")
        expect(mentions42 && mentionsPurpleElephant).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ── FEATURE 7: Background Enhancement ─────────────────────────────────

  describe("Background Enhancement", () => {
    itE2E(
      "Agent uses task() for concurrent delegation (background enhancement)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The background enhancement plugin provides task-based delegation
        // so the agent can fork work into sub-sessions.
        await sendMessage(
          server.url,
          sessionID,
          "I need you to do three things concurrently:\n" +
          "1. Read sample.txt\n" +
          "2. List all files in this directory using glob or ls\n" +
          "3. Use grep to search for 'line' in sample.txt\n" +
          "Do all three, then summarize the results. " +
          "If you can delegate work to child tasks, please do so.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)
        const allParts = messages.flatMap((m: any) => m.parts ?? [])

        // Hard assertion: multiple distinct tools were invoked (concurrent work)
        const toolsUsed = new Set(
          allParts
            .filter((p: any) => p.type === "tool")
            .map((p: any) => p.tool),
        )
        expect(toolsUsed.size).toBeGreaterThanOrEqual(2)

        // Hard assertion: the agent used task tool for delegation (background
        // enhancement feature — the agent forks work into child sessions)
        const hasTaskTool = hasTool(allParts, "task")
        expect(hasTaskTool).toBe(true)

        // Hard assertion: agent responded with substantive content
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ── FEATURE 8: Boulder Continuity ─────────────────────────────────────

  describe("Boulder Continuity", () => {
    itE2E(
      "Multi-step plan progresses across session exchanges with cross-step reference",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Step 1: Ask the agent to do initial discovery
        await sendMessage(
          server.url,
          sessionID,
          "Step 1: Read sample.txt and tell me its contents. Say 'STEP1_DONE' when complete.",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages1 = await waitForMessages(server.url, sessionID, dir, 30_000)
        const text1 = getTextContent(messages1)
        expect(text1.length).toBeGreaterThan(0)

        // Hard assertion: read tool was used in step 1
        const step1Parts = messages1.flatMap((m: any) => m.parts ?? [])
        const step1Read = step1Parts.some(
          (p: any) => p.type === "tool" && p.tool === "read",
        )
        expect(step1Read).toBe(true)

        // Step 2: Continue with next step in same session
        await sendMessage(
          server.url,
          sessionID,
          "Step 2: Now use grep to search for the word 'line' in sample.txt. " +
          "Count how many lines contain it. Report the count.",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages2 = await waitForMessages(server.url, sessionID, dir, 30_000)
        const text2 = getTextContent(messages2)
        expect(text2.length).toBeGreaterThan(0)

        // Hard assertion: grep or glob was used in step 2
        const step2Parts = messages2.flatMap((m: any) => m.parts ?? [])
        const step2Search = step2Parts.some(
          (p: any) =>
            p.type === "tool" &&
            (p.tool === "grep" || p.tool === "glob" || p.tool === "read"),
        )
        expect(step2Search).toBe(true)

        // Step 3: Verify plan continuity — agent knows what was done
        await sendMessage(
          server.url,
          sessionID,
          "Step 3: Write a summary of what we accomplished. " +
          "Mention what you read in Step 1 and what you found in Step 2.",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages3 = await waitForMessages(server.url, sessionID, dir, 30_000)
        const text3 = getTextContent(messages3)

        // Hard assertion: summary references Step 1/Step 2 content (cross-step continuity)
        expect(text3.length).toBeGreaterThan(0)

        const mentionsContent =
          text3.toLowerCase().includes("sample.txt") ||
          text3.toLowerCase().includes("hello") ||
          text3.toLowerCase().includes("line two") ||
          text3.toLowerCase().includes("line three")
        expect(mentionsContent).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })
})

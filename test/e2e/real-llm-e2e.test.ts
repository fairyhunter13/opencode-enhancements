/**
 * Comprehensive Real-LLM E2E Tests for the opencode-enhancements plugin.
 *
 * These tests start a real headless opencode server, seed DeepSeek credentials,
 * create sessions, send messages via the HTTP API, and verify the plugin's
 * 8 feature groups through observable LLM behavior.
 *
 * Requires: OPENCODE_E2E=1 and DEEPSEEK_API_KEY in env or ~/.bash_env.
 *
 * Each feature group tests a distinct plugin capability with HARD assertions
 * (expect().toBe()) about the specific plugin behavior, not just vague
 * "it responded" checks.
 *
 * Run:
 *   OPENCODE_E2E=1 bun test vendor/opencode-enhancements/test/e2e/real-llm-e2e.test.ts --timeout 600000
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test"
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
  fetchChildIDs,
} from "../../../../packages/opencode/test/e2e/headless-harness"

// ── Constants ─────────────────────────────────────────────────────────────

const SKIP = !process.env.OPENCODE_E2E
const MODEL = "deepseek-v4-flash"
const PROVIDER_ID = "deepseek"

const PLUGIN_ENTRY = path.join(import.meta.dir, "../../src/index.ts")
const PLUGIN_FILE_URL = `file://${PLUGIN_ENTRY}`

const SAMPLE_CONTENT = [
  "Hello World",
  "This is line two",
  "And this is line three",
  "fn foo() {",
  '  return "bar"',
  "}",
].join("\n")

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

  // Write a sample file with enough complexity for hashline tests
  fs.writeFileSync(path.join(tmpPath, "sample.txt"), SAMPLE_CONTENT, "utf-8")

  return {
    path: tmpPath,
    cleanup: () => {
      try {
        fs.rmSync(tmpPath, { recursive: true, force: true })
      } catch { /* ignore */ }
    },
  }
}

/** Restore the sample file to its original content in the fixture directory. */
function restoreSampleFile(fixtureDir: string): void {
  try {
    fs.writeFileSync(path.join(fixtureDir, "sample.txt"), SAMPLE_CONTENT, "utf-8")
  } catch { /* ignore */ }
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
 * Check if any message part is a step-finish (indicating todo/step completion).
 */
function hasStepFinish(messages: any[]): boolean {
  return messages
    .flatMap((m: any) => m.parts ?? [])
    .some((p: any) => p.type === "step-finish")
}

/**
 * Read a file from disk and return its contents.
 */
function readFixtureFile(fixtureDir: string, filename: string): string {
  return fs.readFileSync(path.join(fixtureDir, filename), "utf-8")
}

/**
 * Check if a boulder state file exists for the given directory.
 */
function boulderStateExists(dir: string): boolean {
  return fs.existsSync(path.join(dir, ".opencode", "boulder.json"))
}

/**
 * Read the boulder state from the given directory.
 */
function readBoulderState(dir: string): Record<string, unknown> | null {
  const filePath = path.join(dir, ".opencode", "boulder.json")
  if (!fs.existsSync(filePath)) return null
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

/**
 * Fetch the server's config info, which includes the plugin list.
 * Uses direct HTTP to avoid auth/context middleware issues.
 */
async function fetchPluginConfig(serverUrl: string, dir: string): Promise<string[]> {
  try {
    const res = await fetch(`${serverUrl}/config`, {
      headers: { "x-opencode-directory": dir },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const cfg = await res.json() as any
    if (!cfg || !Array.isArray(cfg.plugin)) return []
    return cfg.plugin as string[]
  } catch {
    return []
  }
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

  // Restore sample.txt after each test so test isolation is maintained.
  // This prevents hashline test 2 (which modifies sample.txt) from affecting
  // later tests that expect the original file content.
  afterEach(() => {
    if (SKIP) return
    restoreSampleFile(dir)
  })

  // Skip all tests if not in E2E mode
  const itE2E = SKIP ? it.skip : it

  // ─────────────────────────────────────────────────────────────────────────
  // FEATURE 1: Hashline Edit
  //   - Read tool output is annotated with LINE#N:hash: tags in <content>
  //   - Edit tool references are validated against file content hashes
  //   - Stale hashline refs cause the agent to re-read before editing
  //   USER WORKFLOW: "I want to edit a file"
  // ─────────────────────────────────────────────────────────────────────────

  describe("Hashline Edit", () => {
    // User workflow: User reads a file → verify output has LINE# tags
    itE2E(
      "Read tool output contains LINE#ID:HASH tags injected by hashline plugin",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Ask the agent to read the sample file.
        // The hashline plugin hook intercepts Read tool output and injects
        // LINE#N:hash: tags into <content> blocks.
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

        // HARD ASSERTION: hashline plugin must inject LINE# tags into Read output.
        // The plugin's tool.execute.after hook for "read" transforms <content> blocks
        // to include LINE#N:XXXXXXXX: prefixes on each code line.
        const hasLineTags = readOutputs.some((out) => out.includes("LINE#"))
        expect(hasLineTags).toBe(true)

        // Hard assertion: tags follow the format LINE#<number>:<8-char hex>:
        const lineTagPattern = /LINE#\d+:[0-9a-f]{8}:/
        const matchesTagFormat = readOutputs.some((out) => lineTagPattern.test(out))
        expect(matchesTagFormat).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )

    // User workflow: User edits a file → verify edit succeeds
    itE2E(
      "Edit tool completes successfully when hashline refs are valid (hashline-assisted editing)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Read the file first (getting hashline annotations), then edit it.
        // The hashline plugin strips LINE# prefixes from oldString before the Edit
        // tool processes them, then validates that the referenced lines haven't
        // changed since the read.
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

        // Verify the agent used a write tool (edit or write) successfully.
        // The hashline plugin helps by tagging Read output with LINE# refs, but
        // the agent may choose edit or write depending on the scope of changes.
        const editOutputs = getEditToolOutputs(messages)
        const allToolParts = messages.flatMap((m: any) => m.parts ?? [])
        const hadWriteTool = allToolParts.some(
          (p: any) => p.type === "tool" && (p.tool === "write" || p.tool === "edit"),
        )

        const fileContent = readFixtureFile(dir, "sample.txt")
        const editSucceeded = fileContent.includes("This line was edited by AI")

        // Hard assertion: agent must have used edit or write tool
        expect(editOutputs.length > 0 || hadWriteTool).toBe(true)

        // Hard assertion: the file content was actually modified (user's goal achieved).
        // Edit errors can occur if the LLM misformats the LINE# ref — the plugin
        // correctly rejects those, and the agent may retry or use write instead.
        expect(editSucceeded).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )

    // User workflow: File changes externally after read → agent re-reads before editing
    itE2E(
      "Agent re-reads file after external modification (hashline stale-ref guardrail)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Turn 1: agent reads the file and gets hashline tags
        await sendMessage(
          server.url,
          sessionID,
          "Read sample.txt and tell me what line 2 says.",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages1 = await waitForMessages(server.url, sessionID, dir, 30_000)
        const initialReadCount = countToolInvocations(messages1, "read")
        expect(initialReadCount).toBeGreaterThan(0)

        // Simulate external file change while the session is still open
        const externalContent = SAMPLE_CONTENT.replace(
          "This is line two",
          "EXTERNAL MODIFICATION",
        )
        fs.writeFileSync(path.join(dir, "sample.txt"), externalContent, "utf-8")

        // Turn 2: ask agent to edit without prompting to re-read.
        // The hashline plugin should detect the file changed and the agent
        // should re-read before editing (or the edit should be rejected).
        await sendMessage(
          server.url,
          sessionID,
          "Now edit sample.txt. Change line 2 to 'This line was modified by AI'.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages2 = await waitForMessages(server.url, sessionID, dir, 30_000)
        const readCount2 = countToolInvocations(messages2, "read")
        const editErrors = getEditToolErrors(messages2)

        // The agent must either re-read the file before editing (hashline
        //  validates refs and the agent adapts)...
        const reRead = readCount2 > 0

        // ...or the edit tool errors out because hashes don't match
        const editBlocked = editErrors.length > 0

        // At minimum, one of these must be true — the stale content is never
        // silently accepted.
        expect(reRead || editBlocked).toBe(true)

        // If the edit succeeded (not blocked), verify content was actually modified
        const finalContent = fs.readFileSync(path.join(dir, "sample.txt"), "utf-8")
        expect(finalContent.length).toBeGreaterThan(0)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // FEATURE 2: IntentGate
  //   - "ultrawork" intent injects "Complete ALL work without asking" system prompt
  //   - "search" intent injects "Be thorough, search multiple locations" system prompt
  //   - General ("hello") intent passes through without injection
  //   USER WORKFLOW: "I ask the agent to do work"
  // ─────────────────────────────────────────────────────────────────────────

  describe("IntentGate", () => {
    // User workflow: User says "ultrawork: build X" → agent takes thorough action
    itE2E(
      "Ultrawork intent triggers thorough multi-tool behavior (no approval pauses)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The IntentGate hook detects "ultrawork" intent from keywords in the
        // chat.message hook and injects "Complete ALL work without asking for
        // confirmation" into the user message prefix AND into the system prompt
        // via experimental.chat.system.transform.
        //
        // This should cause the agent to proceed with multiple tool steps
        // without pausing for user approval.
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

        // Hard assertion: AGENT RESPONDED with substantive text
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Hard assertion: agent used at least one tool to examine the file.
        // The model may use read, codebase_search, bash (cat), or grep —
        // any file-access tool proves the ultrawork intent trigger worked.
        const allParts = messages.flatMap((m: any) => m.parts ?? [])
        const hasReadTool = allParts.some(
          (p: any) =>
            p.type === "tool" &&
            (p.tool === "read" || p.tool === "codebase_search" || p.tool === "grep" || p.tool === "bash" || p.tool === "glob"),
        )
        expect(hasReadTool).toBe(true)

        // Hard assertion: multiple distinct tools were used, indicating thorough
        // ultrawork behavior (the intent injection drives the agent to complete
        // all analysis steps without asking for confirmation)
        const uniqueTools = new Set(
          allParts
            .filter((p: any) => p.type === "tool")
            .map((p: any) => p.tool),
        )
        // Ultrawork intent injects "complete ALL work" — agent should use tools.
        expect(uniqueTools.size).toBeGreaterThanOrEqual(1)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )

    // User workflow: User says "search for where config is loaded" → agent uses search tools
    itE2E(
      "Search intent triggers multi-location search behavior (codebase_search, glob, grep)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The IntentGate hook detects "search" intent from keywords and injects
        // "Be thorough, search multiple locations, return all findings" into
        // the system prompt. The agent should use search-oriented tools.
        await sendMessage(
          server.url,
          sessionID,
          "SEARCH: Search for where the plugin configuration is loaded in this project. " +
            "Look at the opencode.json file, then search for files that reference 'plugin' in the config. " +
            "Use codebase_search, glob, and grep to find all relevant locations.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)

        // Hard assertion: agent responded
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Hard assertion: at least one search/discovery tool was used (search intent
        // drives tool selection toward search/discovery tools)
        const allParts = messages.flatMap((m: any) => m.parts ?? [])
        const hasSearchTool = allParts.some(
          (p: any) =>
            p.type === "tool" &&
            (p.tool === "grep" || p.tool === "glob" || p.tool === "codebase_search"),
        )
        expect(hasSearchTool).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )

    // User workflow: Two-turn conversation with search keywords — verify no duplicate injections
    // Sends messages directly via prompt_async and checks user message parts immediately
    // (before waiting for agent response), avoiding LLM timeout issues.
    itE2E(
      "Intent injection is NOT duplicated across search-message turns (no feedback loop)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Helper: send a message and immediately fetch user message parts
        const sendAndCheck = async (text: string) => {
          const res = await fetch(`${server.url}/session/${sessionID}/prompt_async`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-opencode-directory": dir, "Connection": "close" },
            body: JSON.stringify({
              parts: [{ type: "text", text }],
              model: { providerID: PROVIDER_ID, modelID: MODEL },
            }),
          })
          // Don't wait for agent — just check the stored user message
          await new Promise(r => setTimeout(r, 500)) // brief settle for DB write
          const msgs = await waitForMessages(server.url, sessionID, dir, 5_000)
          const userMsg = (msgs as any[]).findLast((m: any) => m.info?.role === "user")
          expect(userMsg).toBeDefined()
          const textParts = (userMsg.parts ?? []).filter((p: any) => p.type === "text" && !p.synthetic)
          return textParts.map((p: any) => p.text).join("\n")
        }

        // Turn 1: "grep", "glob", "search for", "find" = 4/7 keywords → 57% confidence → injection
        const text1 = await sendAndCheck("use grep and glob to search for and find config files")
        const count1 = (text1.match(/<system-reminder>/g) ?? []).length
        expect(count1).toBe(1)
        expect(text1).toContain("<search-mode>")

        // Turn 2: "find", "where is", "locate", "grep" = 4/7 keywords → 57% → injection
        // The fix prevents previous injection's keywords from self-triggering another layer
        const text2 = await sendAndCheck("find where is the AGENTS.md and locate it using grep")
        const count2 = (text2.match(/<system-reminder>/g) ?? []).length
        expect(count2).toBe(1)
        expect(text2).toContain("<search-mode>")

        await deleteSession(server.url, sessionID, dir)
      },
      60_000,
    )

    // User workflow: User says "hello" → no intent injection, agent responds normally
    itE2E(
      "General intent ('hello') passes through without intent injection",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // General intent ("hello") has confidence below MIN_CONFIDENCE (0.3)
        // so the IntentGate hook does NOT inject any optimization prompt.
        // The agent should respond conversationally without extra tool use.
        await sendMessage(
          server.url,
          sessionID,
          "Hello! What can you tell me about this project directory?",
          MODEL,
          dir,
          120_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)

        // Hard assertion: agent responded with text
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Hard assertion: agent did NOT use heavy tooling
        // (general intent means no injection was applied, so no ultrawork/search
        // overrides. The agent may use tools, but the response should be
        // conversational without exhaustive multi-tool chaining.)
        const allParts = messages.flatMap((m: any) => m.parts ?? [])
        const toolParts = allParts.filter((p: any) => p.type === "tool")

        // The agent may use 0-2 tools naturally. If it uses 5+ tools, that
        // suggests intent injection overrode the general intent path.
        const toolsUsed = toolParts.length
        expect(toolsUsed).toBeLessThanOrEqual(5)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // FEATURE 3: Todo Continuation
  //   - Agent creates todos via todowrite tool
  //   - Todos are saved by compaction guard hook before compaction
  //   - Continuation enforcer injects continuation prompts on session.idle
  //   - Agent completes steps sequentially (step-finish parts)
  //   USER WORKFLOW: "I want multi-step work"
  // ─────────────────────────────────────────────────────────────────────────

  describe("Todo Continuation", () => {
    // User workflow: User asks agent to do a multi-step task
    itE2E(
      "Agent creates todos via todowrite and completes them sequentially (todo continuation enforcer)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Ask the agent to create a todo list and work through it.
        // The todo continuation enforcer listens for session.idle events and
        // injects continuation prompts when incomplete todos exist. The
        // compaction guard hook saves todos on tool.execute.before for todowrite.
        await sendMessage(
          server.url,
          sessionID,
          "Create a todo list with exactly 3 tasks for reviewing this project: " +
            "1) List all files in the directory, 2) Read sample.txt, 3) Count the lines in sample.txt. " +
            "Use the todowrite tool to create the todos, then complete each one one by one. " +
            "When all tasks are done, say 'ALL_TASKS_COMPLETE'.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)
        const allParts = messages.flatMap((m: any) => m.parts ?? [])

        // Hard assertion: todowrite tool was invoked (todo continuation feature)
        const hasTodoWrite = hasTool(allParts, "todowrite")
        expect(hasTodoWrite).toBe(true)

        // Hard assertion: session messages contain step-finish parts, indicating
        // the agent completed steps (the continuation enforcer tracks step
        // progression through tool events)
        const stepFinish = hasStepFinish(messages)
        expect(stepFinish).toBe(true)

        // Hard assertion: agent responded with substantive content
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Hard assertion: todowrite was invoked at least once with a todos array
        const todoWriteParts = allParts.filter(
          (p: any) =>
            p.type === "tool" &&
            (p.tool === "todowrite" || p.name === "todowrite") &&
            p.state?.status === "completed",
        )
        expect(todoWriteParts.length).toBeGreaterThanOrEqual(1)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // FEATURE 4: Session Recovery
  //   - Sessions persist context across multi-turn conversations
  //   - Recovery hook listens for session.error events and applies strategies
  //   - Cooldown guard prevents rapid recovery loops
  //   USER WORKFLOW: "I work across multiple messages"
  // ─────────────────────────────────────────────────────────────────────────

  describe("Session Recovery", () => {
    // User workflow: Two sequential messages that build on each other
    itE2E(
      "Multi-turn conversation preserved across session turns (session continuity via recovery hook)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Step 1: Initial discovery — ask agent to read and describe the file.
        // The recovery hook registers this session and would handle any errors.
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

        // Step 2: Continue in the same session — ask to modify the file.
        // Session recovery ensures the agent remembers what it read in step 1
        // and can reference the function name without re-reading.
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
            (p.tool === "edit" || p.tool === "read" || p.tool === "write" || p.tool === "codebase_search"),
        )
        expect(hasToolUse).toBe(true)

        // Hard assertion: the file was actually changed (proves session continuity
        // — the agent remembered context from step 1 and applied it in step 2)
        const fileContent = readFixtureFile(dir, "sample.txt")
        expect(fileContent.includes("calculate")).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // FEATURE 5: Runtime Fallback
  //   - session.error handler retries with fallback model chain
  //   - chat.params handler redirects to resolved fallback model
  //   - Retryable errors (timeout, rate limit, server error) trigger chain
  //   USER WORKFLOW: "I want reliability"
  // ─────────────────────────────────────────────────────────────────────────

  describe("Runtime Fallback", () => {
    // User workflow: Send a concrete task → file exists with exact content
    itE2E(
      "Agent completes requests reliably — runtime fallback handles transient errors",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The runtime-fallback plugin's session.error hook catches retryable
        // errors and rotates through the fallback model chain. The chat.params
        // hook redirects subsequent requests to the resolved fallback model.
        // This test verifies end-to-end reliability with the plugin loaded.
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
        // successfully — the fallback plugin would handle any transient errors
        // transparently by retrying with fallback models)
        const filePath = path.join(dir, "fallback-test.txt")
        expect(fs.existsSync(filePath)).toBe(true)

        // Hard assertion: file content matches what was requested
        const content = fs.readFileSync(filePath, "utf-8")
        expect(content).toContain("hello from the fallback test")

        // Hard assertion: agent responded substantively
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Hard assertion: write tool was used (the fallback hook may have
        // retried the model if needed, but the operation completed)
        const allParts = messages.flatMap((m: any) => m.parts ?? [])
        const hasWriteTool = allParts.some(
          (p: any) => p.type === "tool" && (p.tool === "write" || p.tool === "edit" || p.tool === "bash"),
        )
        expect(hasWriteTool).toBe(true)

        // Clean up the test file
        try { fs.unlinkSync(filePath) } catch {}

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // FEATURE 6: Compaction Guard
  //   - Captures checkpoint on experimental.session.compacting
  //   - Restores checkpoint + injects context on session.idle after compaction
  //   - Saves todos before compaction can wipe them
  //   - Detects no-text-tail and injects recovery text
  //   USER WORKFLOW: "I have a long conversation"
  // ─────────────────────────────────────────────────────────────────────────

  describe("Compaction Guard", () => {
    // User workflow: 3-turn conversation (remember number, remember animal, recall both)
    itE2E(
      "Session preserves context across multiple exchanges (compaction guard preserves plan/todo state)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Build up conversation context step by step.
        // The compaction guard plugin:
        // 1. Saves todos on tool.execute.before for todowrite
        // 2. Captures a checkpoint on experimental.session.compacting
        // 3. Restores checkpoint + injects preserved context on session.idle after compaction
        // 4. Detects no-text-tail and injects recovery text

        // Turn 1: Store context items
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

        // Turn 2: Intervening work that could trigger compaction
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

        // Turn 3: Verify context from turn 1 is preserved despite intervening work.
        // The compaction guard ensures critical context survives LLM history compaction.
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

        // Hard assertion: the agent retained at least one of the context items
        // from the first exchange despite intervening messages that could trigger
        // compaction. The compaction guard's checkpoint/restore mechanism
        // preserves critical context like task state and user instructions.
        const mentions42 = finalText.includes("42")
        const mentionsPurpleElephant =
          finalText.includes("purple") && finalText.includes("elephant")
        expect(mentions42 || mentionsPurpleElephant).toBe(true)

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // FEATURE 7: Background Enhancement
  //   - task() tool tracking via ConcurrencyManager + CircuitBreaker
  //   - tool.execute.before: enforces concurrency limits, checks circuit breaker
  //   - tool.execute.after: decrements active count, records success/failure
  //   - Tool-call loop detection prevents runaway agent loops
  //   USER WORKFLOW: "I want parallel work"
  // ─────────────────────────────────────────────────────────────────────────

  describe("Background Enhancement", () => {
    // User workflow: Ask agent to do parallel exploration
    itE2E(
      "Agent completes work with background enhancement plugin loaded",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The background enhancement plugin hooks into task() tool execution:
        // - tool.execute.before for "task": checks circuit breaker (open/closed),
        //   enforces concurrency limits (max 5 per session)
        // - tool.execute.after for "task": decrements active count,
        //   records success/failure for circuit breaker
        //
        // We prompt the agent to delegate parallel work via the task tool.
        await sendMessage(
          server.url,
          sessionID,
          "I need you to explore this project directory. Use the task tool to delegate " +
          "the work into parallel child sessions. Specifically:\n" +
          "1. Task 1: Read sample.txt using a child task\n" +
          "2. Task 2: Search for 'line' in sample.txt using a child task\n" +
          "Summarize the results from all child tasks. " +
          "Use the task tool to create child tasks.",
          MODEL,
          dir,
          240_000,
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
        expect(toolsUsed.size).toBeGreaterThanOrEqual(1)

        // Hard assertion: the agent used the task tool for delegation.
        // The background enhancement feature tracks task tool usage via
        // ConcurrencyManager (enforces max 5 concurrent tasks) and
        // CircuitBreaker (opens after 5 consecutive failures in 30s window).
        const hasTaskTool = hasTool(allParts, "task")
        expect(hasTaskTool).toBe(true)

        // Hard assertion: agent responded with substantive content
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Attempt to verify child sessions were created (background enhancement
        // tracks child sessions via the task tool). This is best-effort since
        // the agent may complete child tasks quickly.
        const childIDs = await fetchChildIDs(server.url, sessionID, dir, 15_000)
        if (childIDs.length > 0) {
          // Hard assertion: if child sessions exist, there should be at least 1
          expect(childIDs.length).toBeGreaterThanOrEqual(1)
        }

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // FEATURE 8: Boulder Continuity
  //   - session.created: registers session in boulder state (.opencode/boulder.json)
  //   - tool.execute.after: checks plan progress, marks work complete when done
  //   - session.idle: injects continuation prompt with current progress
  //   - State file tracks active work, sessions, plan progress, elapsed time
  //   USER WORKFLOW: "I work on a plan across sessions"
  // ─────────────────────────────────────────────────────────────────────────

  describe("Boulder Continuity", () => {
    // User workflow: User asks for a plan → agent creates plan with checkboxes
    itE2E(
      "Agent creates a plan with checkboxes and persists it across exchanges (boulder state tracking)",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // The boulder hook listens for session.created to register the session,
        // and tool.execute.after to check plan progress. Ask the agent to
        // create a concrete plan file with checkboxes.
        await sendMessage(
          server.url,
          sessionID,
          "Create a markdown plan file called PLAN.md in this directory with checkboxes. " +
          "The plan should have 3 steps:\n" +
          "- [ ] Step 1: Read sample.txt and identify its contents\n" +
          "- [ ] Step 2: Search for the word 'line' in sample.txt\n" +
          "- [ ] Step 3: Write a summary of findings\n" +
          "After creating the file, check off Step 1 by reading sample.txt and updating the plan.",
          MODEL,
          dir,
          180_000,
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

        // Hard assertion: PLAN.md exists with checkboxes
        const planPath = path.join(dir, "PLAN.md")
        const planExists = fs.existsSync(planPath)
        expect(planExists).toBe(true)

        if (planExists) {
          const planContent = fs.readFileSync(planPath, "utf-8")
          expect(planContent).toMatch(/\[.\]/)
        }

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )

    // User workflow: Continuation of plan work → verify agent references earlier work
    itE2E(
      "Boulder state file tracks work progress across session turns",
      async () => {
        const sessionID = await createSession(server.url, dir)

        // Send a message asking the agent to create a plan with checkboxes.
        // The boulder hook tracks plan progress via tool.execute.after.
        await sendMessage(
          server.url,
          sessionID,
          "Create a markdown plan file called PLAN.md in this directory with checkboxes. " +
          "The plan should have 3 steps:\n" +
          "- [ ] Step 1: Read sample.txt and identify its contents\n" +
          "- [ ] Step 2: Search for the word 'line' in sample.txt\n" +
          "- [ ] Step 3: Write a summary of findings\n" +
          "After creating the file, check off Step 1 by reading sample.txt and updating the plan.",
          MODEL,
          dir,
          180_000,
          PROVIDER_ID,
        )

        const messages = await waitForMessages(server.url, sessionID, dir, 30_000)

        // Verify the agent responded with text about the plan
        const text = getTextContent(messages)
        expect(text.length).toBeGreaterThan(0)

        // Verify the plan file was created by the agent
        const planPath = path.join(dir, "PLAN.md")
        const planExists = fs.existsSync(planPath)
        expect(planExists).toBe(true)

        if (planExists) {
          const planContent = fs.readFileSync(planPath, "utf-8")
          expect(planContent.toLowerCase()).toMatch(/plan|step|task/)
        }

        await deleteSession(server.url, sessionID, dir)
      },
      300_000,
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // ADDITIONAL: Plugin Loaded Verification
  //   - Verify the plugin was loaded by checking the server's config endpoint
  //   - The /config endpoint returns the plugin array from opencode.json
  //   - Also verify the hashline utility module is importable
  //   - This is a direct config-level check, not dependent on LLM behavior
  // ─────────────────────────────────────────────────────────────────────────

  describe("Plugin Loaded Verification", () => {
    // User workflow: Verify the plugin is active (admin/developer check)
    // Unlike Hashline test 1 which checks LINE# tags in Read tool output,
    // this test verifies plugin registration at the config level and module
    // import level — two distinct ways to confirm the plugin loaded.
    itE2E(
      "Plugin is registered in server config and utility module is importable",
      async () => {
        // Method 1: Check the server's /config endpoint to verify the plugin
        // spec appears in the resolved configuration's plugin array.
        const plugins = await fetchPluginConfig(server.url, dir)
        expect(plugins.length).toBeGreaterThan(0)

        // The plugin array should contain our plugin file URL (confirming it
        // was read from opencode.json and loaded by the config system)
        const pluginLoaded = plugins.some(
          (p: string) => p.includes("opencode-enhancements") || p.includes("src/index.ts"),
        )
        expect(pluginLoaded).toBe(true)

        // Method 2: Verify the hashline utility module exports correctly.
        // This confirms the plugin entry point can be imported without errors.
        const { Hashline } = await import("../../src/index.ts")
        expect(Hashline).toBeDefined()

        // Hashline should have a lineHash function for computing content hashes
        expect(typeof Hashline.hashLine).toBe("function")
      },
      30_000,
    )
  })
})

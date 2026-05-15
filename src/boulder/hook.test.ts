import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createBoulderHook } from "./hook"
import { writeBoulderState, getBoulderFilePath } from "./storage"
import type { BoulderState } from "./types"

function makeTempDir(): string {
  const dir = join(tmpdir(), `boulder-hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("BoulderHook", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = makeTempDir()
  })

  afterEach(() => {
    try {
      const fp = getBoulderFilePath(tempDir)
      if (existsSync(fp)) unlinkSync(fp)
    } catch {}
  })

  describe("session.created", () => {
    test("registers new session in active work", async () => {
      // given
      const state: BoulderState = {
        schemaVersion: 2,
        activeWorkId: "work-1",
        works: {
          "work-1": {
            workId: "work-1",
            activePlan: "/tmp/plan.md",
            planName: "test-plan",
            status: "active",
            startedAt: new Date().toISOString(),
            sessionIds: ["ses-1"],
            taskSessions: {},
          },
        },
      }
      writeBoulderState(tempDir, state)
      const hook = createBoulderHook()

      // when
      await hook["session.created"]({
        sessionID: "ses-2",
        directory: tempDir,
      })

      // then
      const updated = (await import("./storage")).readBoulderState(tempDir)
      expect(updated!.works["work-1"]!.sessionIds).toContain("ses-2")
    })

    test("does nothing when no boulder state exists", async () => {
      // given
      const hook = createBoulderHook()

      // when — should not throw
      await hook["session.created"]({
        sessionID: "ses-3",
        directory: tempDir,
      })
    })
  })

  describe("tool.execute.after", () => {
    test("marks work as completed when all tasks done", async () => {
      // given
      const planPath = join(tempDir, "plan.md")
      writeFileSync(planPath, "## TODOs\n\n- [x] Only task\n", "utf-8")

      const state: BoulderState = {
        schemaVersion: 2,
        activeWorkId: "work-1",
        works: {
          "work-1": {
            workId: "work-1",
            activePlan: planPath,
            planName: "test",
            status: "active",
            startedAt: new Date().toISOString(),
            sessionIds: ["ses-1"],
            taskSessions: {},
          },
        },
      }
      writeBoulderState(tempDir, state)
      const hook = createBoulderHook()

      // when
      await hook["tool.execute.after"]({
        sessionID: "ses-1",
        directory: tempDir,
      })

      // then
      const updated = (await import("./storage")).readBoulderState(tempDir)
      expect(updated!.works["work-1"]!.status).toBe("completed")
      expect(updated!.works["work-1"]!.endedAt).toBeDefined()
    })

    test("does nothing when work not active", async () => {
      // given
      const state: BoulderState = {
        schemaVersion: 2,
        activeWorkId: "work-1",
        works: {
          "work-1": {
            workId: "work-1",
            activePlan: "/tmp/plan.md",
            planName: "test",
            status: "completed",
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            sessionIds: ["ses-1"],
            taskSessions: {},
          },
        },
      }
      writeBoulderState(tempDir, state)
      const hook = createBoulderHook()

      // when — should not throw
      await hook["tool.execute.after"]({
        sessionID: "ses-1",
        directory: tempDir,
      })
    })
  })

  describe("session.idle", () => {
    test("injects continuation context when work is active and incomplete", async () => {
      // given
      const planPath = join(tempDir, "plan.md")
      writeFileSync(planPath, "## TODOs\n\n- [ ] 1. First task\n", "utf-8")

      const state: BoulderState = {
        schemaVersion: 2,
        activeWorkId: "work-1",
        works: {
          "work-1": {
            workId: "work-1",
            activePlan: planPath,
            planName: "test",
            status: "active",
            startedAt: new Date().toISOString(),
            sessionIds: ["ses-1"],
            agent: "atlas",
            taskSessions: {},
          },
        },
      }
      writeBoulderState(tempDir, state)
      const hook = createBoulderHook()

      // when
      const result = await hook["session.idle"]({
        sessionID: "ses-1",
        directory: tempDir,
      })

      // then
      expect(result).toContain("Boulder Work Continuation")
      expect(result).toContain("test")
      expect(result).toContain("atlas")
      expect(result).toContain("First task")
      expect(result).toContain("0/1 tasks")
    })

    test("returns undefined when no boulder state", async () => {
      // given
      const hook = createBoulderHook()

      // when
      const result = await hook["session.idle"]({
        sessionID: "ses-1",
        directory: tempDir,
      })

      // then
      expect(result).toBeUndefined()
    })

    test("returns undefined when work is complete", async () => {
      // given
      const planPath = join(tempDir, "plan.md")
      writeFileSync(planPath, "## TODOs\n\n- [x] Done\n", "utf-8")

      const state: BoulderState = {
        schemaVersion: 2,
        activeWorkId: "work-1",
        works: {
          "work-1": {
            workId: "work-1",
            activePlan: planPath,
            planName: "test",
            status: "active",
            startedAt: new Date().toISOString(),
            sessionIds: ["ses-1"],
            taskSessions: {},
          },
        },
      }
      writeBoulderState(tempDir, state)
      const hook = createBoulderHook()

      // when
      const result = await hook["session.idle"]({
        sessionID: "ses-1",
        directory: tempDir,
      })

      // then
      expect(result).toBeUndefined()
    })
  })
})

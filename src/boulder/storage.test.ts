import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { unlinkSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  readBoulderState,
  writeBoulderState,
  getPlanProgress,
  getCurrentTask,
  getElapsedMs,
  getBoulderFilePath,
} from "./storage"
import type { BoulderState, BoulderWorkState } from "./types"

function makeTempDir(): string {
  const dir = join(tmpdir(), `boulder-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("readBoulderState / writeBoulderState", () => {
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

  test("returns null when file does not exist", () => {
    // given / when
    const state = readBoulderState(tempDir)

    // then
    expect(state).toBeNull()
  })

  test("writes and reads state", () => {
    // given
    const state: BoulderState = {
      schemaVersion: 2,
      activeWorkId: "work-1",
      works: {
        "work-1": {
          workId: "work-1",
          activePlan: "/tmp/test-plan.md",
          planName: "test-plan",
          status: "active",
          startedAt: new Date().toISOString(),
          sessionIds: ["ses-1"],
          taskSessions: {},
        },
      },
    }

    // when
    const wrote = writeBoulderState(tempDir, state)
    const read = readBoulderState(tempDir)

    // then
    expect(wrote).toBe(true)
    expect(read).not.toBeNull()
    expect(read!.schemaVersion).toBe(2)
    expect(read!.activeWorkId).toBe("work-1")
    expect(read!.works["work-1"]!.planName).toBe("test-plan")
  })

  test("creates .opencode directory automatically", () => {
    // given
    const state: BoulderState = { schemaVersion: 2, works: {} }

    // when
    const wrote = writeBoulderState(tempDir, state)

    // then
    expect(wrote).toBe(true)
    expect(existsSync(join(tempDir, ".opencode", "boulder.json"))).toBe(true)
  })
})

describe("getPlanProgress", () => {
  let tempDir: string
  let planPath: string

  beforeEach(() => {
    tempDir = makeTempDir()
    planPath = join(tempDir, "plan.md")
  })

  afterEach(() => {
    try { if (existsSync(planPath)) unlinkSync(planPath) } catch {}
  })

  test("returns zero progress for non-existent file", () => {
    // given / when
    const progress = getPlanProgress("/tmp/nonexistent-plan.md")

    // then
    expect(progress).toEqual({ total: 0, completed: 0, isComplete: false })
  })

  test("counts unchecked tasks", () => {
    // given
    writeFileSync(planPath, `
## TODOs

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
    `.trim(), "utf-8")

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress.total).toBe(3)
    expect(progress.completed).toBe(0)
    expect(progress.isComplete).toBe(false)
  })

  test("counts mixed completed and unchecked tasks", () => {
    // given
    writeFileSync(planPath, `
## TODOs

- [x] Task 1
- [ ] Task 2
- [x] Task 3
    `.trim(), "utf-8")

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress.total).toBe(3)
    expect(progress.completed).toBe(2)
    expect(progress.isComplete).toBe(false)
  })

  test("detects completion when all tasks done", () => {
    // given
    writeFileSync(planPath, `
## TODOs

- [x] Task 1
- [x] Task 2
    `.trim(), "utf-8")

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress.total).toBe(2)
    expect(progress.completed).toBe(2)
    expect(progress.isComplete).toBe(true)
  })

  test("only counts tasks under ## TODOs section", () => {
    // given
    writeFileSync(planPath, `
# Plan

## TODOs

- [ ] Task 1
- [x] Task 2

## Other Section

- [ ] Not counted
    `.trim(), "utf-8")

    // when
    const progress = getPlanProgress(planPath)

    // then
    expect(progress.total).toBe(2)
    expect(progress.completed).toBe(1)
  })
})

describe("getCurrentTask", () => {
  let tempDir: string
  let planPath: string

  beforeEach(() => {
    tempDir = makeTempDir()
    planPath = join(tempDir, "plan.md")
  })

  afterEach(() => {
    try { if (existsSync(planPath)) unlinkSync(planPath) } catch {}
  })

  test("returns null for non-existent file", () => {
    // given / when
    const task = getCurrentTask("/tmp/nonexistent.md")

    // then
    expect(task).toBeNull()
  })

  test("returns first unchecked task", () => {
    // given
    writeFileSync(planPath, `
## TODOs

- [x] 1. Setup database
- [ ] 2. Create API
- [ ] 3. Add tests
    `.trim(), "utf-8")

    // when
    const task = getCurrentTask(planPath)

    // then
    expect(task).not.toBeNull()
    expect(task!.label).toBe("2")
    expect(task!.title).toBe("Create API")
    expect(task!.key).toBe("todo:2")
  })

  test("returns null when all tasks completed", () => {
    // given
    writeFileSync(planPath, `
## TODOs

- [x] 1. Done
- [x] 2. All done
    `.trim(), "utf-8")

    // when
    const task = getCurrentTask(planPath)

    // then
    expect(task).toBeNull()
  })

  test("handles tasks without numbered labels", () => {
    // given
    writeFileSync(planPath, `
## TODOs

- [ ] Setup database
- [ ] Create API
    `.trim(), "utf-8")

    // when
    const task = getCurrentTask(planPath)

    // then
    expect(task).not.toBeNull()
    expect(task!.title).toBe("Setup database")
    expect(task!.key).toBe("todo:1")
  })

  test("only looks under ## TODOs", () => {
    // given
    writeFileSync(planPath, `
# Header

- [ ] Not a todo

## TODOs

- [ ] Real task
    `.trim(), "utf-8")

    // when
    const task = getCurrentTask(planPath)

    // then
    expect(task).not.toBeNull()
    expect(task!.title).toBe("Real task")
  })
})

describe("getElapsedMs", () => {
  test("computes elapsed from startedAt to now (no endedAt)", () => {
    // given
    const startedAt = new Date(Date.now() - 5000).toISOString()
    const work: BoulderWorkState = {
      workId: "w1",
      activePlan: "/p.md",
      planName: "test",
      status: "active",
      startedAt,
      sessionIds: [],
      taskSessions: {},
    }

    // when
    const elapsed = getElapsedMs(work)

    // then
    expect(elapsed).toBeGreaterThanOrEqual(4000)
    expect(elapsed).toBeLessThanOrEqual(6000)
  })

  test("computes elapsed from startedAt to endedAt", () => {
    // given
    const startedAt = new Date(Date.now() - 10000).toISOString()
    const endedAt = new Date(Date.now() - 2000).toISOString()
    const work: BoulderWorkState = {
      workId: "w1",
      activePlan: "/p.md",
      planName: "test",
      status: "completed",
      startedAt,
      endedAt,
      sessionIds: [],
      taskSessions: {},
    }

    // when
    const elapsed = getElapsedMs(work)

    // then
    expect(elapsed).toBeGreaterThanOrEqual(7000)
    expect(elapsed).toBeLessThanOrEqual(9000)
  })

  test("returns 0 for invalid date", () => {
    // given
    const work: BoulderWorkState = {
      workId: "w1",
      activePlan: "/p.md",
      planName: "test",
      status: "active",
      startedAt: "invalid-date",
      sessionIds: [],
      taskSessions: {},
    }

    // when
    const elapsed = getElapsedMs(work)

    // then
    expect(elapsed).toBe(0)
  })
})

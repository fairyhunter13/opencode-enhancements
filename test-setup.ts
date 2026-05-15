import { afterEach, beforeEach, mock } from "bun:test"

// --- Environment isolation ---
const originalEnv = { ...process.env }

beforeEach(() => {
  // Restore original env
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value
  }
  // Suppress telemetry-like behavior
  process.env.OPENCODE_ENHANCEMENTS_TEST = "1"
})

afterEach(() => {
  mock.restore()
})

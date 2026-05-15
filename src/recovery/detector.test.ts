/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import { detectErrorType } from "./detector"

describe("detectErrorType", () => {
  it("given error with 'tool_use' but no 'tool_result' → tool_result_missing", () => {
    // given
    const error = { message: "tool_use block must be followed by tool_result" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("tool_result_missing")
  })

  it("given error with 'tool not found' → unavailable_tool", () => {
    // given
    const error = { message: "tool not found: grepppp" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("unavailable_tool")
  })

  it("given error with 'tool unavailable' → unavailable_tool", () => {
    // given
    const error = { message: "model tried to call unavailable tool 'invalid'" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("unavailable_tool")
  })

  it("given error with 'tool not supported' → unavailable_tool", () => {
    // given
    const error = { message: "tool not supported in this context" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("unavailable_tool")
  })

  it("given error with 'thinking block order' → thinking_block_order", () => {
    // given
    const error = { message: "thinking block order is wrong" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("thinking_block_order")
  })

  it("given error with 'thinking sequence' → thinking_block_order", () => {
    // given
    const error = { message: "invalid thinking sequence detected" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("thinking_block_order")
  })

  it("given error with 'thinking before' → thinking_block_order", () => {
    // given
    const error = { message: "thinking must come before text blocks" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("thinking_block_order")
  })

  it("given error with 'thinking disabled' → thinking_disabled", () => {
    // given
    const error = { message: "thinking is disabled and cannot contain thinking blocks" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("thinking_disabled")
  })

  it("given error with 'thinking not enabled' → thinking_disabled", () => {
    // given
    const error = { message: "thinking not enabled for this model" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("thinking_disabled")
  })

  it("given error with 'context length exceeded' → context_length_exceeded", () => {
    // given
    const error = { message: "context length exceeded" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("context_length_exceeded")
  })

  it("given error with 'token limit' → context_length_exceeded", () => {
    // given
    const error = { message: "token limit reached" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("context_length_exceeded")
  })

  it("given error with 'maximum context' → context_length_exceeded", () => {
    // given
    const error = { message: "maximum context length exceeded" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("context_length_exceeded")
  })

  it("given generic error → null (not recoverable)", () => {
    // given
    const error = { message: "some random error" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBeNull()
  })

  it("case insensitive matching", () => {
    // given — upper case error message
    const error = { message: "TOOL_USE BLOCK MUST BE FOLLOWED BY TOOL_RESULT" }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("tool_result_missing")
  })

  it("given null error → null", () => {
    // given
    const error = null

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBeNull()
  })

  it("given string error → parses correctly", () => {
    // given
    const error = "tool_use without tool_result"

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("tool_result_missing")
  })

  it("given Error instance → parses correctly", () => {
    // given
    const error = new Error("tool_use block must be followed by tool_result")

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("tool_result_missing")
  })

  it("given nested error structure with data.error.message", () => {
    // given
    const error = {
      data: {
        error: {
          message: "thinking is disabled",
        },
      },
    }

    // when
    const result = detectErrorType(error)

    // then
    expect(result).toBe("thinking_disabled")
  })

  it("given malformed error with circular references → null without crashing", () => {
    // given
    const circular: Record<string, unknown> = { name: "Error" }
    circular.self = circular

    // when
    const result = detectErrorType(circular)

    // then
    expect(result).toBeNull()
  })
})

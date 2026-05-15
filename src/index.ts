import type { PluginInput, PluginOptions, PluginModule, Hooks } from "@opencode-ai/plugin"
import type { Model } from "@opencode-ai/sdk"
import { createHashlineHooks } from "./hashline"
import { createContinuationHook } from "./continuation"
import { createRecoveryHook } from "./recovery"
import { createIntentGateHook } from "./intent"
import { createFallbackHook } from "./fallback"
import { createCompactionGuardHook } from "./compaction"
import { createBackgroundHook } from "./background"
import { createBoulderHook } from "./boulder"

// Namespaced barrel exports for direct access to sub-modules
export * as Hashline from "./hashline"
export * as Continuation from "./continuation"
export * as Recovery from "./recovery"
export * as Intent from "./intent"
export * as Fallback from "./fallback"
export * as Compaction from "./compaction"
export * as Background from "./background"
export * as Boulder from "./boulder"

const plugin: PluginModule = {
  id: "opencode-enhancements",
  server: async (input: PluginInput, options?: PluginOptions) => {
    // Create hooks from all 8 features
    const hashlineHooks = createHashlineHooks()
    const continuationHandler = createContinuationHook(input)
    const recoveryHandler = createRecoveryHook(input)
    const intentHooks = createIntentGateHook(input)
    const fallbackHooks = createFallbackHook()
    const compactionHooks = createCompactionGuardHook()
    const backgroundHooks = createBackgroundHook()
    const boulderHooks = createBoulderHook()

    // Merge all hooks into a single Hooks object
    const hooks: Hooks = {
      // Event handler: route to ALL features that have event-based hooks
      event: async (eventInput) => {
        const { event } = eventInput
        const properties = event.properties as Record<string, unknown> | undefined

        // Continuation + recovery filter internally by event type
        await Promise.all([
          continuationHandler(eventInput),
          recoveryHandler(eventInput),
        ])

        // Route by event type to feature-specific handlers
        if (event.type === "session.error") {
          await fallbackHooks["session.error"]?.({
            sessionID: (properties?.sessionID as string) ?? "",
            error: (properties as any)?.error,
            model: (properties as any)?.model,
          }).catch(() => {})
        } else if (event.type === "session.idle") {
          await compactionHooks["session.idle"]?.({
            sessionID: (properties?.sessionID as string) ?? "",
            messages: (properties as any)?.messages,
            todos: (properties as any)?.todos,
          }).catch(() => {})
          await boulderHooks["session.idle"]?.({
            sessionID: (properties?.sessionID as string) ?? "",
            directory: (properties as any)?.directory ?? "",
          }).catch(() => {})
        } else if (event.type === "session.created") {
          await boulderHooks["session.created"]?.({
            sessionID: (properties?.sessionID as string) ?? "",
            directory: (properties as any)?.directory ?? "",
          }).catch(() => {})
        }
      },

      // Chat hooks from intent detection
      "chat.message": async (chatInput, chatOutput) => {
        await intentHooks["chat.message"]?.(chatInput, chatOutput)
      },

      // Chat.params: fallback model resolution (model override is advisory)
      "chat.params": async (paramsInput, _paramsOutput) => {
        const modelStr = typeof paramsInput.model === "string"
          ? paramsInput.model
          : (paramsInput.model as Model)?.modelID ?? ""
        await fallbackHooks["chat.params"]?.({
          sessionID: paramsInput.sessionID,
          model: modelStr,
        })
      },

      // System prompt transformation from intent detection
      "experimental.chat.system.transform": async (transformInput, transformOutput) => {
        await intentHooks["experimental.chat.system.transform"]?.(transformInput, transformOutput)
      },

      // Session compacting: compaction guard captures checkpoint
      "experimental.session.compacting": async (compactInput, _compactOutput) => {
        await compactionHooks["experimental.session.compacting"]?.({
          sessionID: compactInput.sessionID,
        })
      },

      // Tool execute.before: hashline validation + compaction + background
      "tool.execute.before": async (toolInput, toolOutput) => {
        await hashlineHooks["tool.execute.before"]?.(toolInput, toolOutput)

        // Background hook: circuit breaker + concurrency check
        const bgResult = await backgroundHooks["tool.execute.before"]?.({
          sessionID: toolInput.sessionID,
          tool: toolInput.tool,
          args: toolOutput.args,
          toolHistory: (toolInput as any)?.toolHistory,
        })
        if (bgResult?.cancel) {
          throw new Error(bgResult.reason ?? "Cancelled by background hook")
        }

        // Compaction hook: save todos before they can be wiped
        await compactionHooks["tool.execute.before"]?.({
          tool: toolInput.tool,
          args: toolOutput.args,
        })
      },

      // Tool execute.after: hashline tag injection + background + boulder
      "tool.execute.after": async (toolInput, toolOutput) => {
        await hashlineHooks["tool.execute.after"]?.(toolInput, toolOutput)

        // Background: track task completion and circuit breaker
        await backgroundHooks["tool.execute.after"]?.({
          sessionID: toolInput.sessionID,
          tool: toolInput.tool,
          error: (toolInput as any)?.error,
        })

        // Boulder: track work progress after tool execution
        await boulderHooks["tool.execute.after"]?.({
          sessionID: toolInput.sessionID,
          directory: (toolInput as any)?.directory ?? "",
        })
      },
    }

    return hooks
  },
}

export default plugin

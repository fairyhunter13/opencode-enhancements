import type { KeywordRule } from "./types"

export const DEFAULT_KEYWORD_RULES: KeywordRule[] = [
  {
    intent: "ultrawork",
    priority: 100,
    keywords: [
      "ultrawork",
      "deep work",
      "full implementation",
      "build everything",
      "complete feature",
      "end to end",
    ],
    injection: `<ultrawork-mode>
You are in ULTRAWORK mode. This means:
- Maximum precision and thoroughness required
- Explore the codebase first to understand existing patterns
- Do NOT start implementation until you are 100% certain of the approach
- Resolve all ambiguity before writing code
- Deliver complete, production-ready work — no skeletons, no placeholders
- Verify your work against the original requirements before declaring done
</ultrawork-mode>`,
  },
  {
    intent: "search",
    priority: 80,
    keywords: [
      "search for",
      "find",
      "look up",
      "where is",
      "locate",
      "grep",
      "glob",
    ],
    injection: `<search-mode>
You are in SEARCH mode. This means:
- Be thorough — search multiple locations, don't stop at the first result
- Use codebase_search, Grep, and Glob tools exhaustively
- Return all relevant findings with file paths
- If the initial search yields nothing, try alternative search terms
</search-mode>`,
  },
  {
    intent: "analyze",
    priority: 80,
    keywords: [
      "analyze",
      "assess",
      "evaluate",
      "audit",
      "review the code",
      "code review",
      "inspect",
    ],
    injection: `<analyze-mode>
You are in ANALYZE mode. This means:
- Provide structured analysis with severity ratings
- Gather context before diving deep
- Use multiple sources: codebase_search, Grep, LSP, file reads
- Synthesize findings before drawing conclusions
- Highlight both issues and positive patterns
</analyze-mode>`,
  },
  {
    intent: "plan",
    priority: 90,
    keywords: [
      "plan",
      "blueprint",
      "architecture",
      "design",
      "roadmap",
      "how should i",
      "approach",
    ],
    injection: `<plan-mode>
You are in PLAN mode. This means:
- Break the work into phases with dependency ordering
- Identify parallel execution opportunities
- Consider tradeoffs and alternatives before committing
- Output a structured plan with clear steps and success criteria
- Prioritize correctness of the plan over speed of delivery
</plan-mode>`,
  },
  {
    intent: "implement",
    priority: 70,
    keywords: [
      "implement",
      "write code",
      "fix",
      "add feature",
      "refactor",
      "build",
      "create",
    ],
    injection: `<implement-mode>
You are in IMPLEMENT mode. This means:
- Write production-quality code with error handling
- Follow existing patterns in the codebase
- Add appropriate tests for new functionality
- Run type checking and linting after changes
- Verify the implementation compiles and passes tests
</implement-mode>`,
  },
  {
    intent: "review",
    priority: 70,
    keywords: [
      "review",
      "review this",
      "review the code",
      "check my",
      "verify",
      "validate",
      "proofread",
    ],
    injection: `<review-mode>
You are in REVIEW mode. This means:
- Check correctness, completeness, and edge cases
- Look for security vulnerabilities and anti-patterns
- Verify error handling and boundary conditions
- Check that the code follows project conventions
- Provide specific, actionable feedback with code references
</review-mode>`,
  },
]

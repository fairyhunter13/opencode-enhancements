export interface HashlineEntry {
  line: number       // 1-indexed line number
  id: string         // short hash of line content (8 hex chars)
  content: string    // original line content
}

export interface HashlineEdit {
  pos: string        // "LINE#ID" position reference e.g. "5#a1b2c3d4"
  lines: string      // replacement content (can be multi-line)
}

export interface EditValidationResult {
  valid: boolean
  error?: string
  diagnostic?: string  // diff showing what changed
}

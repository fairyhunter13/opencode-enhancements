export interface CompactionCheckpoint {
  agent: string
  model: string
  tools: string[]
  timestamp: number
}

export interface CompactionGuardState {
  checkpoints: Map<string, CompactionCheckpoint> // sessionID → checkpoint
  compactedSessions: Set<string>
  noTextTailCount: Map<string, number> // sessionID → count
}

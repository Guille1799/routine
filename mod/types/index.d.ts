// The mod's session state: what the band draws beside today.json. today.json
// itself is never kept here; the band re-reads it on every draw.

export type RoutineFieldValue = string | boolean

export type RoutineForm = {
  /** pause writes a note; done writes the configured fields and the note. */
  kind: 'pause' | 'done'
  task: string
  values: Record<string, RoutineFieldValue>
  /** The note the session drafted (prefill = "session"); null while drafting. */
  draft: string | null
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    routine: {
      form: RoutineForm | null
      breakPick: boolean
    }
  }
}

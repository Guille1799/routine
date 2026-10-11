// The mod's session state: what the band draws beside today.json. today.json
// itself is never kept here; the band re-reads it on every draw.

export type RoutineFieldValue = string | boolean

export type RoutineForm = {
  /** pause: the task already stopped at the click; the form picks the reason and saves the context to leave. done: the fields and the note. */
  kind: 'pause' | 'done'
  task: string
  values: Record<string, RoutineFieldValue>
  /** The note the session drafted (pause: the context to leave; done: prefill = "session"); null while drafting. */
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

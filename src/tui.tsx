/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import type { Context, PanelInput } from "@opencode/plugin/tui/context"
import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client"
import type { JSX } from "@opentui/solid"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"

const PANEL_NAME = "my-prompts"
const COMMAND_ID = "my-prompts.toggle"
const PAGE_LIMIT = 100
const MAX_PAGES = 40
const LOAD_TIMEOUT = 60_000
const NOTICE_MS = 4000
const NAV_LAST = "session.messages_last_user"
const NAV_PREV = "session.message.user.previous"
const FOCUS_LEFT = "pane.focus.left"

/**
 * Herdr pane borders: single-line box glyphs, overlay0 from its rose-pine
 * theme (#6e6a86). The focused-pane variant would be accent #c4a7e7.
 */
const HERDR_BORDER_COLOR = "#6e6a86"
const HERDR_BORDER_CHARS = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  topT: "┬",
  bottomT: "┴",
  leftT: "├",
  rightT: "┤",
  cross: "┼",
}


type PromptNode = {
  readonly id: string
  readonly created: number
  readonly text: string
}

type Row =
  | { readonly kind: "date"; readonly key: string; readonly label: string }
  | { readonly kind: "node"; readonly key: string; readonly node: PromptNode }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const nextFrame = () =>
  new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    const raf = globalThis.requestAnimationFrame
    if (raf) raf(finish)
    // The renderer only ticks rAF while it paints; a timer keeps offline
    // renderers (and idle app frames) moving too.
    setTimeout(finish, 16)
  })

function isUser(message: SessionMessageInfo): message is SessionMessageUser {
  return message.type === "user"
}

const MAX_BLOCK_LINES = 3
const MAX_PROMPT_CHARS = 2000

function textOf(message: SessionMessageUser): string {
  const text = (message.text ?? "").trim()
  if (text) return text.slice(0, MAX_PROMPT_CHARS)
  const attachments = message.files?.length ?? 0
  if (attachments > 0) return `[${attachments} attachment${attachments === 1 ? "" : "s"}]`
  return "(empty prompt)"
}

function nodeOf(message: SessionMessageUser): PromptNode {
  return { id: message.id, created: message.time?.created ?? 0, text: textOf(message) }
}

/** Takes the longest prefix of `value` that fits in `max` columns. */
function takeWidth(value: string, max: number): [string, string] {
  let out = ""
  let width = 0
  let index = 0
  for (const char of value) {
    const charWidth = (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1
    if (width + charWidth > max) break
    out += char
    width += charWidth
    index += char.length
  }
  return [out, value.slice(index)]
}

/**
 * Wraps prompt text to `width` columns in at most `maxLines` lines.
 * Paragraph breaks start a new line; words that do not fit are hard-split;
 * leftover content is reported through `clipped`.
 */
function wrapSource(source: string, width: number, maxLines: number): { lines: string[]; clipped: boolean } {
  const budget = Math.max(4, width)
  const lines: string[] = []
  let clipped = false
  const flush = (line: string): void => {
    if (clipped || line.length === 0) return
    if (lines.length >= maxLines) {
      clipped = true
      return
    }
    lines.push(line)
  }
  for (const paragraph of source.split("\n")) {
    if (clipped) break
    let current = ""
    for (let word of paragraph.trim().split(/\s+/).filter((value) => value.length > 0)) {
      if (clipped) break
      while (displayWidth(word) > budget) {
        const [chunk, rest] = takeWidth(word, budget)
        flush(current)
        current = ""
        flush(chunk)
        word = rest
        if (clipped) break
      }
      if (clipped) break
      const candidate = current.length > 0 ? `${current} ${word}` : word
      if (displayWidth(candidate) <= budget) current = candidate
      else {
        flush(current)
        current = word
      }
    }
    flush(current)
  }
  return { lines, clipped }
}

/** Terminal display width: code points above 0xff count as two columns. */
function displayWidth(value: string): number {
  let width = 0
  for (const char of value) width += (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1
  return width
}

function truncate(value: string, max: number): string {
  if (max <= 1) return ""
  if (displayWidth(value) <= max) return value
  let out = ""
  let width = 0
  for (const char of value) {
    const charWidth = (char.codePointAt(0) ?? 0) > 0xff ? 2 : 1
    if (width + charWidth > max - 1) break
    out += char
    width += charWidth
  }
  return `${out}…`
}

const pad2 = (value: number) => value.toString().padStart(2, "0")

function timeOf(created: number): string {
  const date = new Date(created)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function dateOf(created: number): string {
  const date = new Date(created)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** The host's own navigation commands skip prompts with blank text. */
function isNavigable(message: SessionMessageUser): boolean {
  return (message.text ?? "").trim().length > 0
}

/**
 * Function children are the runtime's reactive channel: the bundled JSX
 * transform evaluates children eagerly, while the OpenTUI renderer unwraps
 * function values inside a render effect. The casts only satisfy the static
 * types; the runtime receives the functions themselves.
 */
function live(value: () => string): string {
  return value as unknown as string
}

function liveBlock(value: () => JSX.Element | null | JSX.Element[]): JSX.Element {
  return value as unknown as JSX.Element
}

function PromptBlock(props: {
  context: Context
  node: PromptNode
  budget: () => number
  onOpen: () => void
}) {
  const theme = () => props.context.theme
  const wrapped = wrapSource(props.node.text, Math.max(8, props.budget()), MAX_BLOCK_LINES)
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      marginTop={0}
      border
      borderColor={HERDR_BORDER_COLOR}
      customBorderChars={HERDR_BORDER_CHARS}
      title={` ${timeOf(props.node.created)} `}
      titleAlignment="left"
      paddingTop={0}
      paddingBottom={0}
      paddingLeft={1}
      paddingRight={0}
      backgroundColor={theme().decrease(theme().background.raised.base)}
      onMouseUp={props.onOpen}
    >
      {wrapped.lines.map((line, index) => {
        const last = index === wrapped.lines.length - 1
        const cut = wrapped.clipped && last ? truncate(line, Math.max(1, props.budget() - 1)) : line
        return <text fg={theme().text.base}>{wrapped.clipped && last && !cut.endsWith("…") ? `${cut}…` : cut}</text>
      })}
    </box>
  )
}

function MyPromptsPanel(props: { context: Context; panel: PanelInput }) {
  const context = props.context
  const sessionID = () => props.panel.sessionID

  const [busy, setBusy] = createSignal(false)
  const [notice, setNotice] = createSignal<string>()
  const [tick, setTick] = createSignal(0)
  const [pulse, setPulse] = createSignal(0)

  let index = new Map<string, PromptNode>()
  let loadedSession: string | undefined
  let seenLocal = -1
  let fetchToken = 0
  let noticeTimer: ReturnType<typeof setTimeout> | undefined

  const bump = () => setTick((value) => value + 1)

  function flash(message: string) {
    setNotice(message)
    if (noticeTimer !== undefined) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => setNotice(undefined), NOTICE_MS)
  }

  onCleanup(() => {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  })

  function merge(nodes: Iterable<PromptNode>): boolean {
    let changed = false
    for (const node of nodes) {
      const existing = index.get(node.id)
      if (!existing || existing.created !== node.created || existing.text !== node.text) {
        index.set(node.id, node)
        changed = true
      }
    }
    return changed
  }

  /** Page the server for this session's user messages, newest first. */
  async function fetchHistory(sid: string): Promise<{ nodes: Map<string, PromptNode>; complete: boolean }> {
    const collected = new Map<string, PromptNode>()
    let cursor: string | undefined
    let complete = false
    for (let page = 0; page < MAX_PAGES; page++) {
      let response
      try {
        // The cursor carries its own order; only the first request sets `order`.
        response = await context.client.message.list({
          sessionID: sid,
          limit: PAGE_LIMIT,
          type: "user",
          ...(cursor ? { cursor } : { order: "desc" as const }),
        })
      } catch {
        break
      }
      if (sessionID() !== sid) return { nodes: collected, complete: false }
      for (const message of response.data ?? []) {
        if (isUser(message)) collected.set(message.id, nodeOf(message))
      }
      cursor = response.cursor?.next ?? undefined
      if (!cursor) {
        complete = true
        break
      }
    }
    return { nodes: collected, complete }
  }

  async function refresh(sid: string) {
    const token = ++fetchToken
    const result = await fetchHistory(sid)
    if (token !== fetchToken || sessionID() !== sid) return
    if (result.complete) index = new Map(result.nodes)
    else merge(result.nodes.values())
    try {
      merge((context.data.session.message.list(sid) ?? []).filter(isUser).map(nodeOf))
    } catch {
      // The local cache is not ready yet; the next event merges it.
    }
    bump()
  }

  // Re-read the local cache on session events; server events are cheaper than polling.
  const stop = context.data.listen((event) => {
    const type = event?.details?.type
    if (typeof type !== "string") return
    if (
      type.startsWith("session.message") ||
      type.startsWith("session.revert") ||
      type.startsWith("session.execution")
    ) {
      setPulse((value) => value + 1)
    }
  })
  onCleanup(stop)

  createEffect(() => {
    pulse()
    const sid = sessionID()
    if (!sid) return
    let users: SessionMessageUser[]
    try {
      users = (context.data.session.message.list(sid) ?? []).filter(isUser)
    } catch {
      return
    }
    if (loadedSession !== sid) {
      loadedSession = sid
      seenLocal = users.length
      index = new Map()
      if (users.length > 0) merge(users.map(nodeOf))
      bump()
      void refresh(sid)
      return
    }
    const dropped = users.length < seenLocal
    seenLocal = users.length
    const changed = merge(users.map(nodeOf))
    if (dropped) void refresh(sid)
    else if (changed) bump()
  })

  const promptCount = createMemo(() => {
    tick()
    return index.size
  })

  const rows = createMemo<Row[]>(() => {
    tick()
    const sorted = [...index.values()].sort((left, right) => right.created - left.created)
    const result: Row[] = []
    let currentDate: string | undefined
    for (const node of sorted) {
      const date = dateOf(node.created)
      if (date !== currentDate) {
        currentDate = date
        result.push({ kind: "date", key: `date:${date}`, label: date })
      }
      result.push({ kind: "node", key: node.id, node })
    }
    return result
  })

  function hostUsers(): SessionMessageUser[] {
    try {
      return (context.data.session.message.list(sessionID()) ?? []).filter(isUser)
    } catch {
      return []
    }
  }

  /**
   * Load older host pages until the target message is in the local cache.
   * Prefers the runtime pager the host hands to plugins; falls back to the
   * `session.first` command on hosts without it.
   */
  async function ensureLoaded(sid: string, id: string): Promise<boolean> {
    const has = () => hostUsers().some((message) => message.id === id)
    if (has()) return true
    const store = context.data.session.message as unknown as {
      loadMore?: (sessionID: string, options?: { all?: boolean }) => Promise<void>
      more?: (sessionID: string) => boolean
      loading?: (sessionID: string) => boolean
    }
    if (typeof store.loadMore === "function") {
      const deadline = Date.now() + LOAD_TIMEOUT
      while (Date.now() < deadline && !has()) {
        if (sessionID() !== sid) return false
        if (store.loading?.(sid)) {
          await sleep(80)
          continue
        }
        if (store.more && !store.more(sid)) break
        const before = hostUsers().length
        try {
          await store.loadMore(sid, { all: true })
        } catch {
          break
        }
        if (hostUsers().length === before) break
      }
      if (has()) return true
    }
    const legacyDeadline = Date.now() + LOAD_TIMEOUT
    while (Date.now() < legacyDeadline && !has()) {
      if (sessionID() !== sid) return false
      try {
        context.keymap.dispatch("session.first")
      } catch {
        return false
      }
      await sleep(400)
    }
    return has()
  }

  function isReachable(id: string): boolean {
    try {
      return context.keymap.commands().some((command) => command.id === id)
    } catch {
      return false
    }
  }

  /**
   * The session's keymap layers switch off while another pane (this panel)
   * owns input, which makes its navigation commands unreachable. Hand input
   * back first: focus the session pane, or close this panel when it is
   * fullscreen (the session pane is hidden then, so nothing could scroll).
   * The panel's own focus flag drives the handoff, not the reachable-command
   * list, which lags the focus change by a frame or two.
   */
  async function prepareSessionFocus(): Promise<void> {
    if (props.panel.presentation === "fullscreen") {
      props.panel.close()
    } else if (props.panel.focused) {
      try {
        context.keymap.dispatch(FOCUS_LEFT)
      } catch {
        // Older hosts may not know the focus command; the settle below decides.
      }
    }
    const deadline = Date.now() + 400
    while (Date.now() < deadline && !isReachable(NAV_LAST)) {
      await nextFrame()
    }
    await nextFrame()
  }

  /**
   * Jump by replaying the host's own navigation: anchor on the last jumpable
   * prompt, then step back by the count of jumpable prompts after the target.
   * Both counts come from the host cache, which the commands themselves read.
   */
  async function jump(node: PromptNode) {
    if (busy()) return
    const sid = sessionID()
    setBusy(true)
    try {
      setNotice("Jumping…")
      await prepareSessionFocus()
      if (sessionID() !== sid) return
      let cache = hostUsers()
      if (!cache.some((message) => message.id === node.id)) {
        setNotice("Loading older messages…")
        const loaded = await ensureLoaded(sid, node.id)
        if (!loaded || sessionID() !== sid) {
          context.ui.toast.show({ message: "Could not load that prompt", variant: "warning" })
          return
        }
        cache = hostUsers()
        await nextFrame()
      }
      const offset = cache.findIndex((message) => message.id === node.id)
      if (offset < 0) {
        context.ui.toast.show({ message: "Could not find that prompt in the transcript", variant: "warning" })
        return
      }
      if (!cache.some(isNavigable)) {
        context.ui.toast.show({ message: "This session has no jumpable text prompts", variant: "warning" })
        return
      }
      const steps = cache.slice(offset + 1).filter(isNavigable).length
      const dispatchJump = () => {
        context.keymap.dispatch(NAV_LAST)
        for (let step = 0; step < steps; step++) {
          context.keymap.dispatch(NAV_PREV)
        }
      }
      dispatchJump()
      // The anchor-then-steps sequence is idempotent, so repeating it after a
      // settle recovers the jump when the first burst was dispatched while
      // the session layers were still re-registering.
      await nextFrame()
      await nextFrame()
      dispatchJump()
      flash(`Jumped to ${timeOf(node.created)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <box flexDirection="column" width="100%" flexGrow={1}>
      <box flexDirection="row" gap={1} flexShrink={0} paddingLeft={2} paddingRight={1}>
        <text fg={context.theme.text.base}>My prompts</text>
        <text fg={context.theme.text.muted}>{live(() => `(${promptCount()})`)}</text>
      </box>
      {liveBlock(() => {
        if (notice() === undefined || promptCount() === 0) return null
        return (
          <box flexShrink={0} paddingLeft={2}>
            <text fg={context.theme.text.feedback.info.base}>{live(() => notice() ?? "")}</text>
          </box>
        )
      })}
      {liveBlock(() => {
        if (promptCount() === 0) {
          return (
            <box paddingLeft={2} paddingTop={1}>
              <text fg={context.theme.text.muted}>
                {live(() => notice() ?? "No prompts in this session yet.")}
              </text>
            </box>
          )
        }
        return (
          <scrollbox
            width="100%"
            flexGrow={1}
            stickyScroll
            stickyStart="top"
            verticalScrollbarOptions={{ visible: false }}
          >
            <box flexDirection="column" width="100%">
              {liveBlock(() =>
                rows().map((row) =>
                  row.kind === "date" ? (
                    <box flexShrink={0} paddingLeft={2} paddingTop={1}>
                      <text fg={context.theme.text.faint}>{row.label}</text>
                    </box>
                  ) : (
                    <PromptBlock
                      context={context}
                      node={row.node}
                      budget={() => Math.max(12, props.panel.width - 5)}
                      onOpen={() => void jump(row.node)}
                    />
                  ),
                ),
              )}
            </box>
          </scrollbox>
        )
      })}
    </box>
  )
}

function toggle(context: Context) {
  const route = context.ui.router.current()
  if (route.type !== "session") {
    context.ui.toast.show({ message: "Open a session to see your prompts", variant: "warning" })
    return
  }
  const current = context.ui.panel.current()
  if (current?.name === PANEL_NAME && current.sessionID === route.sessionID) {
    context.ui.panel.close()
    return
  }
  if (!context.ui.panel.open(PANEL_NAME)) {
    context.ui.toast.show({ message: "Open a session to see your prompts", variant: "warning" })
  }
}

export default Plugin.define({
  id: "my-prompts",
  setup(context) {
    const unregisterPanel = context.ui.slot({
      append: "session.panel",
      render: (panel) => {
        if (panel.name !== PANEL_NAME) return null
        return <MyPromptsPanel context={context} panel={panel} />
      },
    })
    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: COMMAND_ID,
          title: "My prompts",
          description: "Show your prompts in this session and jump to one",
          group: "Session",
          bind: "alt+m",
          palette: true,
          slash: { name: "myprompts", aliases: ["my-prompts"] },
          run: () => toggle(context),
        },
      ],
      bindings: [COMMAND_ID],
    }))
    return unregisterPanel
  },
})

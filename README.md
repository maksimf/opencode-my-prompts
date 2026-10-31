# opencode-my-prompts

**Press `ctrl+x` then `p` to open or close the panel.**

An OpenCode 2 TUI plugin: a side panel that lists **only your prompts** in the
current session. Click a prompt to jump to it in the transcript.

Built as a personal alternative to `opencode-user-timeline` (which does the
same job but ships a Chinese UI). This version uses the host-owned
`session.panel` surface, so it works with `session.sidebar: "hide"`.

## Requirements

- OpenCode 2 (developed against 2.2.5)
- Mouse capture enabled in the terminal (default)

## Install

### From GitHub (recommended)

```sh
opencode plugin add github:maksimf/opencode-my-prompts
```

This installs the package and registers it in `~/.config/opencode/cli.json`.
Restart the TUI to load it.

### Manual

Register a local checkout in `~/.config/opencode/cli.json`:

```json
{
  "plugins": [
    "file:///path/to/opencode-my-prompts"
  ]
}
```

OpenCode reloads `cli.json` live; no restart is needed. Verify with:

```sh
opencode plugin list
```

## Use

| Action | How |
| --- | --- |
| Open / close the panel | `<leader>p` (ctrl+x, then p), `/myprompts`, or the command palette ("My prompts") |
| Jump to a prompt | Click its row in the panel |

The panel lists every user message of the session, newest first, grouped by
day. Each prompt renders as a bordered block: the border matches a Herdr pane
border (single-line box glyphs, `#6e6a86` — overlay0 of Herdr's rose-pine
theme) with the time it was sent as the border title, over the same background
shade as the composer, followed by up to three wrapped lines of the prompt
(a trailing "…" marks that more text exists). The list
scrolls with the wheel and sticks to the newest entry. A status line reports
progress ("Loading older messages…", "Jumped to 14:02").

## How it works

- **Listing** — pages the server (`client.message.list`, 100 per page,
  `type: "user"`, newest first, cursor pagination) for the full history, then
  tracks the live host cache so new prompts appear immediately. An undo (the
  local user-message count drops) triggers a full refetch.
- **Jumping** — first hands input back to the session pane, because the
  session's keymap layers (which own the navigation commands) switch off while
  the panel owns focus: the plugin dispatches `pane.focus.left`, or closes the
  panel when it is fullscreen (a fullscreen panel hides the session pane, so
  nothing could scroll behind it), then waits until the navigation commands
  are reachable again. It then replays the host's own navigation commands:
  `session.messages_last_user` anchors the transcript on the last prompt, then
  `session.message.user.previous` steps back N times, where N is the number of
  jumpable prompts after the target *in the host cache* (the same set the host
  commands read). Prompts not yet in the host cache are loaded first via the
  runtime pager (`data.session.message.loadMore({ all: true })`).

## Development

```sh
npm install
npm run typecheck   # tsc against @opencode/plugin@2.2.5 types
npm run smoke       # offline render test (OpenTUI test renderer)
```

The smoke test renders the panel with fake data, clicks the oldest and newest
rows through the mock mouse, and asserts the emitted navigation commands and
status line.

Notes for future edits:

- Solid resolves to its server build under plain Bun; run the smoke test with
  `--conditions=browser` (already in the `smoke` script) or the renderer throws
  an "orphan text" error.
- The bundled JSX transform evaluates children eagerly. Dynamic content must go
  through function children (`live()` / `liveBlock()` helpers in `src/tui.tsx`)
  so the OpenTUI renderer wraps it in a render effect.
- The host has no public `scrollToMessage` API (2.2.5), which is why jumping
  goes through the navigation commands above.
- On 2.2.5 the session's keymap layer is disabled while another pane owns
  input, so dispatching a session command silently no-ops until focus returns.
  The plugin hands focus back based on the panel's own `focused` flag — the
  reachable-command list lags a frame or two — waits briefly, then dispatches.
- The jump (`session.messages_last_user` + N × `session.message.user.previous`)
  is idempotent, so it is dispatched twice with a two-frame settle between;
  the first burst can be swallowed while the session layers re-register.

## Layout

- `src/tui.tsx` — the plugin (a single TUI part; no server part)
- `test/render-smoke.tsx` — offline smoke test

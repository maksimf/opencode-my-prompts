/** @jsxImportSource @opentui/solid */
import "@opentui/solid/runtime-plugin-support"
import { testRender, type JSX } from "@opentui/solid"
import type { Context, PanelInput } from "@opencode/plugin/tui/context"
import type { SessionMessageInfo } from "@opencode/client"
import plugin from "../src/tui"

declare const process: { env: Record<string, string | undefined> }

const SHOW_FRAMES = process.env.SMOKE_FRAMES === "1"

const DAY = 24 * 60 * 60 * 1000
const BASE = Date.parse("2026-10-30T09:00:00")

const messages = [
  { id: "msg_1", type: "user", text: "First prompt line\nwith a second line", time: { created: BASE } },
  { id: "msg_2", type: "user", text: "A prompt about the side panel with a body that certainly wraps onto the second line of the block and then keeps going for a while until it eventually disappears beneath the cap in the panel and the tail marker stays hidden", time: { created: BASE + 60_000 } },
  { id: "msg_3", type: "user", text: "Latest prompt on the next day", time: { created: BASE + DAY + 60_000 } },
] as unknown as SessionMessageInfo[]

const NAV = ["session.messages_last_user", "session.message.user.previous"]

const theme = {
  decrease: () => "#262d31",
  background: { raised: { base: "#2d353b" } },
  text: {
    base: "#d3c6aa",
    muted: "#7a8478",
    faint: "#5c6a72",
    action: { primary: { base: "#a7c080" } },
    feedback: { info: { base: "#7fbbb3" } },
  },
} as unknown as Context["theme"]

let failures = 0
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`)
  if (!ok) failures += 1
}

function rowY(frame: string, needle: string): number {
  const lines = frame.split("\n")
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]?.includes(needle)) return index
  }
  return -1
}

async function scenario(presentation: "panel" | "fullscreen") {
  console.log(`\n-- scenario: ${presentation} --`)
  const state = {
    reachable: new Set<string>(["my-prompts.toggle", "pane.focus.left"]),
    dispatches: [] as string[],
    closed: false,
    claim: undefined as { render: (input: PanelInput) => JSX.Element } | undefined,
  }

  const fakeContext = {
    options: {},
    location: undefined,
    app: { version: "smoke", channel: "test" },
    theme,
    themeMode: "dark",
    client: { message: { list: async () => ({ data: messages, cursor: { next: null } }) } },
    data: {
      listen: () => () => {},
      session: { message: { list: () => messages } },
    },
    keymap: {
      layer: (factory: () => unknown) => {
        factory()
      },
      dispatch: (id: string) => {
        state.dispatches.push(id)
        if (id === "pane.focus.left") {
          state.reachable = new Set([...NAV, "pane.focus.left", "my-prompts.toggle"])
        }
      },
      commands: () => [...state.reachable].map((id) => ({ id })),
    },
    ui: {
      slot: (value: { render: (input: PanelInput) => JSX.Element }) => {
        state.claim = value
        return () => {}
      },
      toast: { show: () => {} },
    },
  } as unknown as Context

  plugin.setup(fakeContext)
  const registered = state.claim
  if (!registered) throw new Error("smoke: the plugin did not register a session.panel slot")

  const panelInput = {
    name: "my-prompts",
    sessionID: `ses_${presentation}`,
    width: 60,
    presentation,
    focused: true,
    focus: () => {},
    close: () => {
      state.closed = true
      state.reachable = new Set([...NAV, "my-prompts.toggle"])
    },
    toggleFullscreen: () => {},
  } as unknown as PanelInput

  const setup = await testRender(() => registered.render(panelInput), { width: 66, height: 34 })
  const frame0 = await setup.waitForFrame((frame) => frame.includes("(3)"))
  const yOld = rowY(frame0, "First prompt line")
  if (yOld < 0) throw new Error("smoke: oldest row missing from the frame")

  await setup.mockMouse.moveTo(8, yOld)
  await setup.mockMouse.click(8, yOld)
  // The click handler is async (focus handoff polls a few frames); let it
  // finish on real timers before driving render passes.
  await new Promise((resolve) => setTimeout(resolve, 250))
  const frame1 = await setup.waitForFrame((frame) => frame.includes("Jumped to 09:00"))
  if (SHOW_FRAMES) {
    console.log(frame0)
    console.log(frame1)
  }

  check(`${presentation}: header`, frame0.includes("My prompts"))
  check(`${presentation}: count`, frame0.includes("(3)"))
  check(
    `${presentation}: day groups newest first`,
    frame0.includes("2026-10-30") &&
      frame0.includes("2026-10-31") &&
      frame0.indexOf("2026-10-31") < frame0.indexOf("2026-10-30"),
  )
  check(
    `${presentation}: newest prompt first`,
    frame0.indexOf("Latest prompt on the next day") < frame0.indexOf("First prompt line"),
  )
  check(`${presentation}: herdr border`, frame0.includes("┌") && frame0.includes("┘") && frame0.includes("│"))
  check(
    `${presentation}: time in border`,
    frame0.split("\n").some((line) => line.includes("┌") && line.includes("09:00")),
  )
  check(`${presentation}: rows listed`, frame0.includes("First prompt line") && frame0.includes("A prompt about the side panel"))
  check(`${presentation}: multiline block`, frame0.includes("with a second line"))
  check(
    `${presentation}: wrapped and capped`,
    frame0.includes("wraps onto the second line") && frame0.includes("…") && !frame0.includes("tail marker"),
  )
  check(`${presentation}: time as title`, frame0.includes("09:00"))
  check(`${presentation}: jump notice`, frame1.includes("Jumped to 09:00"))

  const burst = [NAV[0], NAV[1], NAV[1]]
  const expected = presentation === "panel" ? ["pane.focus.left", ...burst, ...burst] : [...burst, ...burst]
  check(`${presentation}: dispatch order`, state.dispatches.join(",") === expected.join(","))
  if (presentation === "panel") {
    check("docked: handoff first", state.dispatches[0] === "pane.focus.left")
    check("docked: panel stays open", state.closed === false)
    check("docked: focus target reachable after handoff", state.reachable.has(NAV[0]))
  } else {
    check("fullscreen: panel closes", state.closed === true)
    check("fullscreen: no focus command", !state.dispatches.includes("pane.focus.left"))
  }
  console.log("dispatched:", state.dispatches.join(", "))

  await setup.dispose()
}

await scenario("panel")
await scenario("fullscreen")

if (failures > 0) throw new Error(`smoke: ${failures} check(s) failed`)
console.log("\nsmoke: all checks passed")

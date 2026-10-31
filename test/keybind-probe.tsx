/** @jsxImportSource @opentui/solid */
import "@opentui/solid/runtime-plugin-support"
import { testRender } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { registerCommaBindings, registerTimedLeader } from "@opentui/keymap/addons/opentui"

const setup = await testRender(() => <box width="100%" height="100%" />, { width: 20, height: 5 })
const keymap = createDefaultOpenTuiKeymap(setup.renderer)
registerCommaBindings(keymap)
registerTimedLeader(keymap, { trigger: "ctrl+x", name: "leader", timeoutMs: 2000 })

const warnings: string[] = []
keymap.on("warning", (event) => warnings.push(JSON.stringify(event).slice(0, 120)))
const errors: string[] = []
keymap.on("error", (event) => errors.push(JSON.stringify(event).slice(0, 120)))

const events: string[] = []
keymap.registerLayer({
  bindings: [
    { key: "<leader>p", cmd: "probe.leader" },
    { key: "ctrl+y", cmd: "probe.ctrly" },
    { key: "ctrl+u,<leader>q", cmd: "probe.multi" },
  ],
  commands: [
    { name: "probe.leader", run: () => { events.push("leader") } },
    { name: "probe.ctrly", run: () => { events.push("ctrly") } },
    { name: "probe.multi", run: () => { events.push("multi") } },
  ],
})

await setup.mockInput.pressKey("x", { ctrl: true })
console.log(
  "pending:",
  keymap
    .getPendingSequence()
    .map((part) => (part as { tokenName?: string; display?: string }).tokenName ?? (part as { display?: string }).display ?? "?")
    .join(" "),
)
await setup.mockInput.pressKey("p")
console.log("after ctrl+x p:", events.join(",") || "(nothing)")

await setup.mockInput.pressKey("y", { ctrl: true })
console.log("after ctrl+y:", events.join(",") || "(nothing)")

await setup.mockInput.pressKey("x", { ctrl: true })
await setup.mockInput.pressKey("u", { ctrl: true })
console.log("after ctrl+x ctrl+u:", events.join(",") || "(nothing)")

await setup.mockInput.pressKey("x", { ctrl: true })
await setup.mockInput.pressKey("q")
console.log("after ctrl+x q:", events.join(",") || "(nothing)")

console.log("warnings:", warnings.length ? warnings : "none")
console.log("errors:", errors.length ? errors : "none")
await setup.dispose()

# Claude Office

A toy-diorama office that shows what your Claude Code agents are doing. Every
running session gets a desk and a Clawd, and the Clawd acts out the session's
current state.

Built with Bun, React, TypeScript and three.js (WebGPU renderer, with an
automatic WebGL 2 fallback).

## Run it

```sh
bun install
bun run dev        # http://localhost:4821
```

Add `?demo` to the URL for a scripted office that shows every state without
waiting for real sessions. Add `?light=day` or `?light=night` to pin the
lighting, which otherwise follows your local clock.

### In the macOS menu bar

```sh
bun run menubar    # builds ~/Applications/Claude Office.app and opens it
```

A Clawd appears in the menu bar and shows the state of the office at a glance:
a yellow dot and a count when agents need you, a ring while agents are working,
and a check mark for a few seconds when one finishes.

- **Click** for the office in a popover. Drag the popover off the menu bar, or
  choose Open Window (⌘N, or open the app again from Spotlight), for a regular
  window; the app is in the Dock and ⌘-Tab while it is open. Esc closes the
  popover.
- **⌥⌘O** shows or hides the office from anywhere.
- **Right-click** for every agent, grouped like the board. Click one to open
  the office on it; hold Option to open its terminal in Orca instead. The same
  menu has the popover size (Small and Medium stack the board under the office,
  Large fits the full layout), server controls, and Settings.
- **Notifications** arrive when an agent starts needing you and when one
  finishes. Click one to open the office on that agent. For agents that Orca
  launched they offer Open in Orca, and a finished agent can be answered with
  Reply right from the notification. Each kind can be turned off in Settings.
- If the exact permission-prompt hooks are not installed, the menu offers to
  install them.

The server is compiled into the app, so it runs without this repo; rebuild
with `bun run menubar` to pick up code changes. If `bun run dev` is already
running, the app uses that server instead of its own. The bundled server logs
to `~/Library/Logs/Claude Office.log`, and `OFFICE_PORT` moves it off 4821.
Building needs the Xcode command line tools (`xcode-select --install`).

The build also writes `mac/build/Claude Office.zip`, which you can give to
someone on an Apple silicon Mac. It is not notarized, so the first time they
open it they need to right-click it and choose Open.

## What you are looking at

| The agent is              | Its Clawd                                                          |
| ------------------------- | ------------------------------------------------------------------ |
| Editing files             | Types fast; the monitor scrolls code with diff highlights          |
| Running a command         | Types in bursts; the monitor is a green terminal                   |
| Reading or searching      | Leans in and scans; the monitor shows a page                       |
| On the web                | The monitor shows a spinning globe                                 |
| Thinking                  | Leans back with a claw up; three dots on the monitor               |
| Running subagents         | Mini Clawds with laptops appear in front of the desk               |
| **Blocked on you**        | Hops and waves, yellow floor ring, flashing monitor, yellow bubble |
| Finished a turn           | Cheers, then leans back with a check mark on the monitor           |
| Idle for 3 to 30 minutes  | Wanders to the coffee bar, the couch, the bookshelf                |
| Idle for 30 min to 2 h    | Asleep on the desk with the monitor off                            |
| Idle for over 2 hours     | Walks out of the door; its desk is cleared until it is active again |
| Hitting a tool error      | Flinches while the monitor puffs smoke                             |

Monitors face their Clawd, so from the default camera you see their backs.

Desks are grouped into a rug-colored pod per project, and worktrees of the same
repository share a pod. The paper stack on each desk grows with the session's
context size.

Agents that have gone home stay on the board under "Gone home", and walk back
in through the door when their session becomes active.

The board on the left lists every agent, most urgent first.

## Opening a terminal

Click a Clawd, or its row on the board, and that agent's Claude Code terminal
fills the window:

- For sessions that Orca launched, it is the live terminal screen, read again
  every second, and you can type into its prompt box (see below).
- For other sessions it is a screen pieced together from the session's
  transcript: its prompts, tool calls, replies and errors. These can only be
  watched.

Scroll up, or press PageUp, to go back through the session; the earlier part
comes from its transcript. The view stays where you put it while new output
arrives, and typing brings it back to the bottom. Press Esc, or the Esc button
in the bottom bar, to go back to the office.

## Where the data comes from

Watching is done entirely by reading files:

- `~/.claude/sessions/<pid>.json` gives the live sessions, their names and
  whether each is busy or idle.
- `~/.claude/projects/**/<session>.jsonl` transcripts give tool calls, prompts,
  errors, token usage and subagents.

These formats are internal to Claude Code and can change between versions. If
the office goes blank after an update, the parsers in `server/transcript.ts`
and `server/office.ts` are the place to look.

### Exact permission prompts (optional)

From files alone, a session blocked on a permission prompt looks like a slow
tool call. The server estimates it (an instant tool that has not returned, or a
Bash call with no shell process behind it) and marks it as an estimate. Only
the oldest pending call is judged, since calls sent in one batch run in order. For
exact detection, install the hooks:

```sh
bun run hooks:install     # adds tagged entries to ~/.claude/settings.json
bun run hooks:uninstall   # removes only those entries
```

Each hook is one `curl` to `127.0.0.1` that fails silently when the office is
not running. Your settings file is backed up before either command changes it.
Sessions started before installing need a restart to pick the hooks up.

## Talking to agents (Orca)

Sessions that Orca launched can be messaged from the
office. Orca puts each terminal's handle in the session's environment, so the
office knows exactly which terminal a Clawd stands for and drives it through the
`orca` CLI:

- **Watch the screen.** The terminal view shows what the terminal renders right
  now (`orca terminal read --screen`).
- **Type a prompt.** Typing fills Claude Code's prompt box, and
  Enter types your text into the terminal as a new prompt (`orca terminal
  send`). It is typed as is, on one line, so `/commands` and `!` shell mode
  behave as they do in the terminal. A busy agent queues it behind its current
  step. Unsent text is kept per agent while you look at other terminals.
- **Open in Orca.** Brings that terminal to the front (`orca terminal switch`).

Messages are refused while an agent is showing a permission prompt or a
question, because Enter there would accept the highlighted option. The office
checks both its own state and the terminal screen before typing, and points you
to Orca to answer instead.

Sessions running elsewhere (Cursor, Terminal, and so on) stay watch-only; the
bar under the screen says where each one is running. Start the server with
`OFFICE_READ_ONLY=1` to turn sending off altogether.

## Privacy and safety

The server binds to `127.0.0.1` and rejects requests from other origins, since
snapshots contain snippets of your prompts and commands. Anything that reaches
an agent also requires a header that other websites cannot send. Sending a
message is as powerful as typing in that agent's terminal, so do not expose
this server to a network without adding authentication first.

## Assets

Everything in the scene is modeled by `assets/build_assets.py` and exported to
`public/models/office.glb`. To change a model, edit the script and rebuild
(Blender 4.2 or newer on your PATH):

```sh
bun run assets                                        # rebuild the GLB
blender -b -P assets/build_assets.py -- --preview     # also render assets/preview/kit.png
```

## Layout

```
server/     Bun server: session watcher, transcript parser, Orca bridge, hook endpoint, WebSocket
shared/     Types shared by server and client
src/scene/  three.js office: asset kit, Clawd animation, desks, room layout, camera
src/ui/     React panels: staff board, an agent's terminal
assets/     Blender script that builds the model kit
scripts/    Hook installer
mac/        Menu bar app (Swift), the entry point it compiles the server from, and its build script
```

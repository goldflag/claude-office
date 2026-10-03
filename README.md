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
lighting, which otherwise follows your local clock, and `?theme=lodge` (or any
theme below) to open in a theme.

### Usage card

The bottom left shows Claude Code usage: how much of the 5-hour and weekly plan
limits is used, with reset times, and the tokens sent and received over the last
5 hours, today and the last 7 days. Token totals are counted from your session
files in `~/.claude/projects`, leaving out cache reads. The plan limits come from
Anthropic's `/api/oauth/usage` endpoint, using the Claude Code login that the
server reads from the macOS Keychain (macOS may ask you to allow it once). The
token stays in the server and is sent only to Anthropic. That endpoint is not
documented, so if it stops working the bars disappear and the token totals stay.

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
  the office on it; hold Option to open its terminal in Orca instead. This
  list takes the place of the board, which the app leaves out of the office.
  The same menu has the popover size, server controls, and Settings.
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
| Editing files             | Types fast                                                         |
| Running a command         | Types in bursts                                                    |
| Reading or searching      | Leans in and scans                                                 |
| On the web                | Leans in and scans                                                 |
| Thinking                  | Leans back with a claw up                                          |
| Running subagents         | Mini Clawds with laptops appear in front of the desk               |
| **Blocked on you**        | Hops and waves, yellow floor ring, yellow bubble                   |
| Finished a turn           | Cheers under a burst of confetti, then leans back                  |
| Idle for 3 to 30 minutes  | Takes a break at one of the office's hangouts, or joins a game     |
| Idle for 30 min to 2 h    | Asleep on the desk with the monitor off                            |
| Idle for over 2 hours     | Walks out of the door; its desk is cleared until it is active again |
| Hitting a tool error      | Flinches while the monitor puffs smoke                             |

Each monitor shows a small Claude Code screen drawn from the session's
transcript: your prompts, tool calls with green, red or blinking dots, Claude's
replies, the spinner while it works, and the permission, question or plan
dialog when it is waiting on you. Monitors face their Clawd, so from the
default camera you see their backs.

Desks are grouped into a rug-colored pod per project, and worktrees of the same
repository share a pod. The paper stack on each desk grows with the session's
context size.

Hover over a Clawd to see what its session is working on: the Orca worktree's
title when it has one, otherwise Claude Code's session title or the last prompt.

Agents that have gone home stay on the board under "Gone home", and walk back
in through the door when their session becomes active.

The board on the left lists every agent, most urgent first.

## Themes

The button beside the lighting switch redecorates the office. The desks stay
put; the floor, walls, windows, furniture along the back wall, the pet, hats
and desk ornaments change. The choice is remembered.

| Theme        | Hangouts                                                         | Game for two | Pet                   |
| ------------ | ---------------------------------------------------------------- | ------------ | --------------------- |
| `studio`     | Coffee bar, water cooler, bookshelf, couch, window               | Ping-pong    | Dusty, a robot vacuum |
| `greenhouse` | Potting bench, koi pond, garden bench, hammock                   | Tea for two  | Sheldon, a tortoise   |
| `lodge`      | Armchairs by the fire, cocoa bar, plaid sofa, ski rack           | Chess        | Biscuit, a cat        |
| `orbital`    | Telescope, hydroponics, snack machine, egg chairs, zero-g lounge | Air hockey   | Sputnik, a drone      |
| `seaside`    | Juice bar, surfboards, deck chairs, hammock                      | Paddleball   | Pinchy, a crab        |

On a break, a Clawd does whatever its hangout is for, holding the right thing:
a mug, a book, a fishing rod, a watering can, a paddle. A Clawd waiting at a
game usually draws the next one to take a break, and then they play: a ball
or puck goes back and forth, or they take turns at chess, tea or a chat. The
pet naps at home, sniffs around the free hangouts and goes to sit with Clawds
on a break; click it for a hop, hover for its name. Each window shows its own
slice of an animated view that follows the time of day.

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

Everything in the scene is modeled in Python under `assets/kit` and exported to
`public/models/office.glb` by `assets/build_assets.py`. `kit/office.py` is the
original kit and each theme has its own module; `kit/core.py` holds the
palette and the mesh helpers. To change a model, edit its module and rebuild
(Blender 4.2 or newer on your PATH):

```sh
bun run assets                                        # rebuild the GLB
blender -b -P assets/build_assets.py -- --preview     # also render assets/preview/kit.png
blender -b -P assets/build_assets.py -- --only lodge --preview /tmp/lodge.png --out /tmp/lodge.glb
```

The client finds models and their moving parts by name (`Fireplace_Flame0`,
`Hammock_Bed`), so keep part names unique and prefixed with their asset's name.

## Layout

```
server/     Bun server: session watcher, transcript parser, Orca bridge, hook endpoint, WebSocket
shared/     Types shared by server and client
src/scene/  three.js office: asset kit, Clawd animation, desks, room layout, themes, pets, camera
src/ui/     React panels: staff board, an agent's terminal
assets/     Blender scripts that build the model kit, one module per theme
scripts/    Hook installer
mac/        Menu bar app (Swift), the entry point it compiles the server from, and its build script
```

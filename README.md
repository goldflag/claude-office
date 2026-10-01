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

Monitors face their Clawd, so from the default camera you see their backs;
right-drag to orbit behind a desk and read the screen.

Desks are grouped into a rug-colored pod per project, and worktrees of the same
repository share a pod. The paper stack on each desk grows with the session's
context size.

Agents that have gone home stay on the board under "Gone home", and walk back
in through the door when their session becomes active.

The board on the left lists every agent, most urgent first. Click a row or a
Clawd for the last prompt, the current tool, subagents and recent activity.

## Where the data comes from

The server only reads files; it never writes to a session or sends it input.

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

## Privacy

The server binds to `127.0.0.1` and rejects requests from other origins, since
snapshots contain snippets of your prompts and commands.

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
server/     Bun server: session watcher, transcript parser, hook endpoint, WebSocket
shared/     Types shared by server and client
src/scene/  three.js office: asset kit, Clawd animation, desks, room layout, camera
src/ui/     React panels: staff board, agent details
assets/     Blender script that builds the model kit
scripts/    Hook installer
```

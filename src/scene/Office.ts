import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AgentSnapshot, OfficeSnapshot } from "../../shared/types.ts";
import { describeAgent, groupOf, taskOf } from "../describe.ts";
import { Ambient, Confetti } from "./ambient.ts";
import { Clawd, type Doing } from "./Clawd.ts";
import { damp, hash01, Kit, part, parts } from "./kit.ts";
import {
  AISLE_Z,
  type Cell,
  computeLayout,
  DOOR_INSIDE_X,
  DOOR_OUTSIDE_X,
  type Game,
  projectColors,
  type RoomLayout,
  type Rug,
  SEAT_X,
  SEAT_Y,
  SEAT_Z,
  type Spot,
  WALK_Z,
} from "./layout.ts";
import { Pet } from "./Pet.ts";
import { Station } from "./Station.ts";
import { paintFloor, paintWainscot, paintWall } from "./surfaces.ts";
import { type Lighting, type Theme, type ThemeId, themeById } from "./themes.ts";
import { WindowView } from "./views.ts";

export type TimeMode = "auto" | "day" | "night";

export interface OfficeCallbacks {
  onSelect(id: string | null): void;
  /** False when there is no roster board, so the view need not make room for it. */
  board?: boolean;
  /** Where the asset kit is served from, when not from this server. */
  kitUrl?: string;
  /** The theme to open with. */
  theme?: ThemeId;
}

const WALL_H = 3;
const CLAWD_SCALE = 1.15;
const STROLL_SPEED = 1.5;
const HURRY_SPEED = 3.4;
/** Width in pixels that the roster board takes from the left of the view. */
const BOARD_INSET = 320;
/** Share of the height the board takes from the bottom on narrow screens, matching the small-screen CSS. */
const BOARD_SHARE_NARROW = 0.42;

/** How long a pair at a game takes over each turn, or each crossing of the ball. */
const TURN_SECONDS = 4;
const BALL_CROSSINGS: Record<Exclude<Game["kind"], "turns">, number> = { pong: 1.2, hockey: 0.9, toss: 0.6 };

// Night is a lit room in a dark world: warm lamps inside, dusk outside.
const colorsOf = (l: Lighting) => ({
  background: new THREE.Color(l.background),
  sky: new THREE.Color(l.sky),
  ground: new THREE.Color(l.ground),
  sun: new THREE.Color(l.sun),
});

function nightFactor(mode: TimeMode): number {
  if (mode !== "auto") return mode === "night" ? 1 : 0;
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 5 || h >= 20) return 1;
  if (h < 7) return 1 - (h - 5) / 2;
  if (h < 17) return 0;
  return (h - 17) / 3;
}

/**
 * Orca's session marker: a spinner while the agent works, a dot once it is
 * ready for you. Needing you, sleeping and away carry their own signals.
 */
function statusOf(activity: AgentSnapshot["activity"]): "working" | "ready" | null {
  const group = groupOf(activity);
  if (group === "working") return "working";
  if (group === "done" || group === "idle") return "ready";
  return null;
}

/** The floating name and status bubble above one agent, drawn in the DOM. */
class Tag {
  readonly el = document.createElement("div");
  private bubble = document.createElement("div");
  private status = document.createElement("span");
  private label = document.createElement("span");
  private name = document.createElement("div");
  private task = document.createElement("div");
  private text = "";

  constructor(parent: HTMLElement) {
    this.el.className = "tag";
    this.bubble.className = "tag-bubble";
    this.status.className = "tag-status";
    this.status.setAttribute("aria-hidden", "true");
    this.label.className = "tag-text";
    this.bubble.append(this.status, this.label);
    this.name.className = "tag-name";
    this.task.className = "tag-task";
    const label = document.createElement("div");
    label.className = "tag-label";
    label.append(this.name, this.task);
    const stack = document.createElement("div");
    stack.className = "tag-stack";
    stack.append(label, this.bubble);
    this.el.append(stack);
    parent.append(this.el);
  }

  /** The name, and `task` under it, are shown only while the pointer is over the agent. */
  set(agent: AgentSnapshot, hovered: boolean, away: boolean, task: string | null) {
    const state = agent.activity;
    const quiet = state === "idle" || state === "sleeping" || state === "away";
    const text = state === "sleeping" ? "z z z" : quiet ? "" : describeAgent(agent);
    if (text !== this.text) {
      this.text = text;
      this.label.textContent = text;
    }
    const status = statusOf(state);
    this.name.textContent = agent.name;
    if (this.task.textContent !== (task ?? "")) this.task.textContent = task ?? "";
    this.task.hidden = !task;
    this.el.dataset.state = state;
    this.el.dataset.status = status ?? "";
    this.el.dataset.emphasis = hovered ? "1" : "0";
    this.el.dataset.away = away ? "1" : "0";
    this.status.hidden = status === null;
    this.label.hidden = text === "";
    this.bubble.hidden = text === "" && status === null;
  }

  place(x: number, y: number, visible: boolean) {
    this.el.style.display = visible ? "" : "none";
    if (visible) this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  remove() {
    this.el.remove();
  }
}

type Mode = "desk" | "walk" | "spot";

class Actor {
  readonly clawd: Clawd;
  readonly station: Station;
  readonly tag: Tag;
  cell: Cell;
  mode: Mode = "desk";
  spot: Spot | null = null;
  /** Where a walk ends: back at the desk, at a hangout spot, or out the door. */
  goal: "desk" | "spot" | "exit" = "desk";
  /** True while arriving or leaving, so the door knows to open. */
  viaDoor = false;
  path: THREE.Vector3[] = [];
  speed = STROLL_SPEED;
  heading = 0;
  roamAt = 0;
  grow = 0;
  seenError: number | null;
  seenActivity: string;

  constructor(
    kit: Kit,
    labels: HTMLElement,
    public snap: AgentSnapshot,
    cell: Cell,
  ) {
    this.cell = cell;
    this.clawd = new Clawd(kit, CLAWD_SCALE);
    this.station = new Station(kit, snap.id);
    this.tag = new Tag(labels);
    this.clawd.root.userData.agentId = snap.id;
    this.station.group.userData.agentId = snap.id;
    this.seenError = snap.lastError;
    this.seenActivity = snap.activity;
    this.station.group.position.set(cell.x, 0, cell.z);
    this.clawd.root.position.copy(this.seatPosition());
  }

  seatPosition() {
    return new THREE.Vector3(this.cell.x + SEAT_X, SEAT_Y, this.cell.z + SEAT_Z);
  }

  /** The fixed route from this desk out to the shared walkway. */
  exitRoute(): THREE.Vector3[] {
    const aisle = this.cell.z + AISLE_Z;
    return [
      this.seatPosition(),
      new THREE.Vector3(this.cell.x + SEAT_X, 0, aisle),
      new THREE.Vector3(this.cell.corridorX, 0, aisle),
      new THREE.Vector3(this.cell.corridorX, 0, WALK_Z),
    ];
  }
}

const spotPosition = (s: Spot) => new THREE.Vector3(s.x, s.y, s.z);

/** What `pick` returns for the office pet. */
const PET = "\u0000pet";

/** The way from a hangout back out to the walkway, through its entry point if it has one. */
const leaveSpot = (s: Spot) =>
  s.via
    ? [new THREE.Vector3(s.via.x, 0, s.via.z), new THREE.Vector3(s.via.x, 0, WALK_Z)]
    : [new THREE.Vector3(s.x, 0, WALK_Z)];

function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
  const len = ab.lengthSq();
  const u = len === 0 ? 0 : THREE.MathUtils.clamp(((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / len, 0, 1);
  return Math.hypot(p.x - (a.x + ab.x * u), p.z - (a.z + ab.z * u));
}

export class OfficeScene {
  private renderer!: THREE.WebGPURenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  private controls!: OrbitControls;
  private world = new THREE.Group();
  private room = new THREE.Group();
  private roomDisposables: { dispose(): void }[] = [];
  private hemi = new THREE.HemisphereLight("#FFFFFF", "#C9C2B6", 1.1);
  private sun = new THREE.DirectionalLight("#FFF1DA", 2.6);
  private fill = new THREE.DirectionalLight("#FFC98A", 0);
  private fireLight = new THREE.PointLight("#FF9A4A", 0, 7, 1.6);
  private clockHands: { hour: THREE.Object3D; minute: THREE.Object3D } | null = null;
  private labels = document.createElement("div");
  private actors = new Map<string, Actor>();
  private spotOwner = new Map<string, string>();
  private theme: Theme = themeById(null);
  private palette = { day: colorsOf(this.theme.day), night: colorsOf(this.theme.night) };
  private layout: RoomLayout = computeLayout([], this.theme);
  private view: WindowView | null = null;
  private pet: Pet | null = null;
  private petTag = document.createElement("div");
  private petHovered = false;
  private ambient: Ambient | null = null;
  private confetti = new Confetti();
  private games: { def: Game; ball: THREE.Mesh | null; u: number; leg: number }[] = [];
  /** Moving parts of the furniture: flames, fish, hammocks, grow lights, floating beanbags. */
  private life: {
    flames: THREE.Object3D[];
    glows: THREE.MeshStandardMaterial[];
    fish: THREE.Object3D[];
    hammocks: THREE.Object3D[];
    pulses: THREE.MeshStandardMaterial[];
    bobbers: { obj: THREE.Object3D; phase: number }[];
  } = { flames: [], glows: [], fish: [], hammocks: [], pulses: [], bobbers: [] };
  private emotes: { el: HTMLElement; at: THREE.Vector3; until: number }[] = [];
  /** Agents playing a game this frame, whose pose the game decides. */
  private inGame = new Set<string>();
  private kit!: Kit;
  private timer = new THREE.Timer();
  private t = 0;
  private night = 0;
  private timeMode: TimeMode = "auto";
  private selected: string | null = null;
  private hovered: string | null = null;
  private focus: { target: THREE.Vector3; distance: number } | null = null;
  private firstSnapshot = true;
  private framed = false;
  private disposed = false;
  private resizeObserver: ResizeObserver;
  private pointerDown: { x: number; y: number } | null = null;
  private inset = 0;
  private insetBottom = 0;
  private doorPanel: THREE.Object3D | null = null;
  private doorOpen = 0;
  private departed: Actor[] = [];
  private lastSnapshot: OfficeSnapshot | null = null;
  /** Once the camera has been moved by hand, layout changes stop re-framing it. */
  private userMoved = false;
  /** While something covers the whole view, the office keeps living but is not drawn. */
  private paused = false;

  private constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: OfficeCallbacks,
  ) {
    this.labels.className = "tags";
    this.theme = themeById(callbacks.theme);
    this.palette = { day: colorsOf(this.theme.day), night: colorsOf(this.theme.night) };
    this.petTag.className = "pet-tag";
    this.petTag.hidden = true;
    this.labels.append(this.petTag);
    this.resizeObserver = new ResizeObserver(() => this.resize());
  }

  static async create(container: HTMLElement, callbacks: OfficeCallbacks): Promise<OfficeScene> {
    const office = new OfficeScene(container, callbacks);
    await office.init();
    return office;
  }

  private async init() {
    const renderer = new THREE.WebGPURenderer({ antialias: true });
    this.renderer = renderer;
    await renderer.init();
    this.kit = await Kit.load(this.callbacks.kitUrl);
    if (this.disposed) {
      renderer.dispose();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.className = "office-canvas";
    this.container.append(renderer.domElement, this.labels);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target, this.world);
    this.world.add(this.room, this.confetti.mesh, this.fireLight);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = false;
    this.controls.minPolarAngle = 0.3;
    this.controls.maxPolarAngle = 1.3;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.addEventListener("start", () => {
      this.focus = null;
      this.userMoved = true;
    });

    const el = renderer.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerleave", this.onPointerLeave);

    this.applyTheme();
    this.resizeObserver.observe(this.container);
    this.resize();
    this.applyTime(true);
    renderer.setAnimationLoop(this.frame);
  }

  // ------------------------------------------------------------------ input

  /** What is under the pointer: an agent's id, "pet" for the office pet, or null. */
  private pick(event: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const targets: THREE.Object3D[] = [];
    for (const actor of this.actors.values()) targets.push(actor.clawd.root, actor.station.group);
    if (this.pet) targets.push(this.pet.root);
    for (const hit of ray.intersectObjects(targets, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (typeof o.userData.agentId === "string") return o.userData.agentId;
        if (o.userData.pet) return PET;
      }
    }
    return null;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private onPointerUp = (e: PointerEvent) => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || e.button !== 0) return;
    const picked = this.pick(e);
    if (picked === PET && this.pet) {
      this.pet.pat();
      this.emote(this.pet.position.clone().setY(this.pet.position.y + 0.5), "♥");
      return;
    }
    this.callbacks.onSelect(picked);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointerDown) return;
    const picked = this.pick(e);
    this.petHovered = picked === PET;
    this.hovered = picked === PET ? null : picked;
    this.renderer.domElement.style.cursor = picked ? "pointer" : "grab";
  };

  private onPointerLeave = () => {
    this.hovered = null;
    this.petHovered = false;
  };

  // ----------------------------------------------------------------- public

  setTimeMode(mode: TimeMode) {
    this.timeMode = mode;
  }

  /** Redecorates the office. Everyone keeps their desk; anyone on a break moves to one of the new hangouts. */
  setTheme(id: ThemeId) {
    if (id === this.theme.id) return;
    this.theme = themeById(id);
    this.palette = { day: colorsOf(this.theme.day), night: colorsOf(this.theme.night) };
    if (!this.kit) return;
    this.applyTheme();
  }

  private applyTheme() {
    for (const actor of this.actors.values()) this.dress(actor);

    this.ambient?.dispose();
    if (this.ambient) this.world.remove(this.ambient.group);
    this.ambient = new Ambient(this.theme.ambient);
    this.world.add(this.ambient.group);

    if (this.pet) {
      this.world.remove(this.pet.root);
      this.pet.dispose();
    }
    const { kind, asset, name } = this.theme.pet;
    this.pet = new Pet(this.kit, kind, asset, name);
    this.world.add(this.pet.root);

    this.view?.dispose();
    this.view = new WindowView(this.theme.view);

    // The hangouts are all new, so whoever was at one, or on the way, picks again.
    this.spotOwner.clear();
    const onBreak = [...this.actors.values()].filter((a) => a.mode === "spot" || (a.mode === "walk" && a.goal === "spot"));
    for (const actor of onBreak) actor.spot = null;
    if (this.lastSnapshot) this.setSnapshot(this.lastSnapshot);
    else {
      this.layout = computeLayout([], this.theme);
      this.buildRoom();
    }
    for (const actor of onBreak) {
      const spot = this.claimSpot(actor);
      if (spot) {
        actor.mode = "spot";
        actor.path = [];
        actor.clawd.root.position.copy(spotPosition(spot));
        actor.heading = spot.facing;
      } else {
        actor.mode = "desk";
      }
    }
  }

  /** The theme's hat and desk ornament for one agent. */
  private dress(actor: Actor) {
    const id = actor.snap.id;
    actor.station.dress(this.theme.trinkets);
    const hats = this.theme.hats;
    if (!hats) return actor.clawd.wear(null);
    const asset = hats.assets[Math.floor(hash01(id, 21) * hats.assets.length)]!;
    if (!this.kit.has(asset)) return actor.clawd.wear(null);
    const hat = this.kit.make(asset);
    hat.rotation.z = (hash01(id, 22) - 0.5) * 0.25;
    // A seedling is tiny; let it sprout a bit.
    if (asset === "Hat_Sprout") hat.scale.setScalar(1.7);
    if (hats.colors) {
      const color = hats.colors[Math.floor(hash01(id, 23) * hats.colors.length)]!;
      const knit = hat.getObjectByName("Hat_Beanie_Knit") ?? hat.getObjectByName("Hat_Antenna_Bulb");
      if (knit instanceof THREE.Mesh) knit.material = tinted(knit.material as THREE.MeshStandardMaterial, color);
    }
    actor.clawd.wear(hat);
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  resetView() {
    this.userMoved = false;
    this.frameRoom(true);
  }

  /** Glides the camera to a point in the room (in room coordinates, as the layout uses), keeping its angle. */
  focusOn(x: number, z: number, distance: number) {
    this.userMoved = true;
    this.focus = {
      target: new THREE.Vector3(x - this.layout.width / 2, 0.4, z - this.layout.depth / 2),
      distance,
    };
  }

  /** Where the room's shared places are, for showing them off. */
  landmarks() {
    const pet = this.pet?.position;
    return {
      width: this.layout.width,
      depth: this.layout.depth,
      pet: pet ? { x: pet.x, z: pet.z } : null,
      games: this.layout.games.map((g) => {
        const a = this.layout.spots.find((s) => s.id === g.a)!;
        const b = this.layout.spots.find((s) => s.id === g.b)!;
        return { id: g.id, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      }),
      spots: this.layout.spots.map((s) => ({ id: s.id, x: s.x, z: s.z, pose: s.pose })),
    };
  }

  setSnapshot(snap: OfficeSnapshot) {
    if (!this.kit) {
      this.pending = snap;
      return;
    }
    this.lastSnapshot = snap;

    // An agent that has gone home, or whose session ended, keeps its desk
    // until its Clawd has walked out of the door.
    const listed = new Set(snap.agents.map((a) => a.id));
    const ended = [...this.actors.values()]
      .filter((actor) => !listed.has(actor.snap.id))
      .map((actor): AgentSnapshot => ({ ...actor.snap, activity: "away", needsYou: null, subagents: [] }));
    const everyone = [...snap.agents, ...ended];
    const present = everyone.filter((a) => a.activity !== "away" || this.actors.has(a.id));

    const layout = computeLayout(present, this.theme, projectColors(everyone.map((a) => a.project)));
    const roomChanged = layout.key !== this.layout.key;
    const resized = layout.width !== this.layout.width || layout.depth !== this.layout.depth;
    this.layout = layout;
    if (roomChanged) this.buildRoom();

    for (const agent of present) {
      const cell = layout.cells.get(agent.id)!;
      let actor = this.actors.get(agent.id);
      if (!actor) {
        actor = new Actor(this.kit, this.labels, agent, cell);
        this.dress(actor);
        actor.grow = this.firstSnapshot ? 1 : 0;
        actor.roamAt = this.t + 2 + hash01(agent.id, 9) * 20;
        this.world.add(actor.station.group, actor.clawd.root);
        this.actors.set(agent.id, actor);
        if (!this.firstSnapshot) {
          // Anyone who turns up later comes in through the door.
          actor.clawd.root.position.set(DOOR_OUTSIDE_X, 0, WALK_Z);
          actor.heading = Math.PI / 2;
          actor.viaDoor = true;
          this.sendToDesk(actor, HURRY_SPEED);
        } else if (agent.activity === "idle") {
          // On first load, agents already on a break start out at their hangout.
          const spot = this.claimSpot(actor);
          if (spot) {
            actor.mode = "spot";
            actor.clawd.root.position.copy(spotPosition(spot));
            actor.heading = spot.facing;
            actor.roamAt = this.t + 30 + hash01(agent.id, 10) * 80;
          }
        }
      }
      actor.snap = agent;
      if (actor.cell.x !== cell.x || actor.cell.z !== cell.z || actor.cell.corridorX !== cell.corridorX) {
        actor.cell = cell;
        if (actor.mode === "walk" && actor.goal === "desk") this.sendToDesk(actor, actor.speed);
      }
      if (actor.mode === "spot" && actor.spot) {
        const fresh = layout.spots.find((s) => s.id === actor.spot!.id);
        if (fresh) {
          actor.spot = fresh;
          actor.clawd.root.position.copy(spotPosition(fresh));
        }
      }
      actor.station.syncSubagents(agent.subagents);

      if (agent.lastError && agent.lastError !== actor.seenError) {
        actor.seenError = agent.lastError;
        if (!this.firstSnapshot) {
          actor.clawd.flinch();
          actor.station.smoke();
        }
      }
      if (agent.activity !== actor.seenActivity) {
        if (agent.activity === "done") {
          actor.clawd.cheer();
          // A turn well done gets a little confetti over the desk.
          if (actor.mode === "desk") this.confetti.burst(new THREE.Vector3(cell.x + SEAT_X, 1.05, cell.z + SEAT_Z));
        }
        actor.seenActivity = agent.activity;
      }
    }

    this.firstSnapshot = false;
    if (!this.framed) this.frameRoom(false);
    else if (resized && !this.userMoved) this.frameRoom(true);
  }

  /** Clears away agents whose Clawd has finished walking out. */
  private removeDeparted() {
    if (this.departed.length === 0) return;
    for (const actor of this.departed) {
      const id = actor.snap.id;
      this.releaseSpot(actor);
      this.world.remove(actor.clawd.root, actor.station.group);
      actor.station.dispose();
      actor.tag.remove();
      this.actors.delete(id);
      // Someone who went home is still on the roster; an ended session is not.
      if (this.selected === id && !this.lastSnapshot?.agents.some((a) => a.id === id)) this.callbacks.onSelect(null);
    }
    this.departed = [];
    if (this.lastSnapshot) this.setSnapshot(this.lastSnapshot);
  }

  private pending: OfficeSnapshot | null = null;

  dispose() {
    this.disposed = true;
    this.resizeObserver.disconnect();
    if (!this.renderer) return;
    this.renderer.setAnimationLoop(null);
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerleave", this.onPointerLeave);
    this.controls?.dispose();
    for (const actor of this.actors.values()) {
      actor.station.dispose();
      actor.tag.remove();
    }
    for (const d of this.roomDisposables) d.dispose();
    this.view?.dispose();
    this.pet?.dispose();
    this.ambient?.dispose();
    this.confetti.dispose();
    this.renderer.dispose();
    el.remove();
    this.labels.remove();
  }

  // ------------------------------------------------------------------- room

  private track<T extends { dispose(): void }>(item: T): T {
    this.roomDisposables.push(item);
    return item;
  }

  private buildRoom() {
    for (const d of this.roomDisposables) d.dispose();
    this.roomDisposables = [];
    this.room.clear();
    this.clockHands = null;
    this.doorPanel = null;
    this.games = [];
    this.life = { flames: [], glows: [], fish: [], hammocks: [], pulses: [], bobbers: [] };
    this.view?.releaseTextures();
    if (!this.kit) return;

    const theme = this.theme;
    const { width: W, depth: D } = this.layout;
    this.world.position.set(-W / 2, 0, -D / 2);
    const add = (obj: THREE.Object3D, x: number, y: number, z: number, rotY = 0, scale = 1) => {
      obj.position.set(x, y, z);
      obj.rotation.y = rotY;
      obj.scale.multiplyScalar(scale);
      this.room.add(obj);
      return obj;
    };
    const texture = (canvas: HTMLCanvasElement, repeatX: number, repeatY: number) => {
      const tex = this.track(new THREE.CanvasTexture(canvas));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = 4;
      return tex;
    };
    /** A painted slab; `pattern` repeats every 2 units across its biggest face. */
    const slab = (w: number, h: number, d: number, color: string, pattern: HTMLCanvasElement | null = null, glow = false) => {
      const map = pattern ? texture(pattern, Math.max(w, d) / 2, h / 2) : null;
      const material = glow
        ? this.track(new THREE.MeshBasicMaterial({ color }))
        : this.track(new THREE.MeshStandardMaterial({ color: map ? "#FFFFFF" : color, map, roughness: 0.9 }));
      const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), material);
      mesh.receiveShadow = !glow;
      return mesh;
    };

    // Floor: a chunky base with the theme's floor on top, like a toy playset.
    const tiles = texture(paintFloor(theme.floor.style, theme.floor.colors, theme.floor.seam), W / 2, D / 2);
    const floorTop = this.track(new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.85 }));
    const side = this.track(new THREE.MeshStandardMaterial({ color: theme.base, roughness: 0.9 }));
    const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(W, 0.5, D)), [side, side, floorTop, side, side, side]);
    base.receiveShadow = true;
    add(base, W / 2, -0.25, D / 2);

    const T = 0.3;
    const walls = theme.walls;
    const wallPattern = paintWall(walls.style, walls.color, walls.accent);
    const wainscot = paintWainscot(walls.wainscotStyle, walls.wainscot);
    add(slab(W + T, WALL_H + 0.5, T, walls.color, wallPattern), W / 2 - T / 2, WALL_H / 2 - 0.25, -T / 2);
    add(slab(T, WALL_H + 0.5, D, walls.color, wallPattern), -T / 2, WALL_H / 2 - 0.25, D / 2);
    add(slab(W, 0.95, 0.05, walls.wainscot, wainscot), W / 2, 0.475, 0.025);
    add(slab(W, 0.07, 0.08, walls.trim, null, walls.glowTrim), W / 2, 0.985, 0.04);
    // The left wall's trim stops either side of the door.
    for (const [z0, z1] of [
      [0, WALK_Z - 0.7],
      [WALK_Z + 0.7, D],
    ] as const) {
      add(slab(0.05, 0.95, z1 - z0, walls.wainscot, wainscot), 0.025, 0.475, (z0 + z1) / 2);
      add(slab(0.08, 0.07, z1 - z0, walls.trim, null, walls.glowTrim), 0.04, 0.985, (z0 + z1) / 2);
    }
    const door = add(this.kit.make("Door"), 0.03, 0, WALK_Z, Math.PI / 2);
    this.doorPanel = part(door, "Door_Panel");

    // Each window looks out on its own stretch of the theme's view.
    const round = theme.window === "Porthole";
    const windowAt = (x: number, z: number, rotY: number, u: number) => {
      const win = this.kit.make(theme.window);
      const pane = part(win, round ? "Porthole_Glass" : "Window_Glass");
      pane.material = this.track(new THREE.MeshBasicMaterial({ map: this.view!.texture(u, round ? 1 : 1.27) }));
      win.traverse((o) => (o.castShadow = false));
      // A porthole's rim starts at the wall rather than straddling it.
      const inset = round ? 0.03 : 0;
      add(win, rotY ? x - inset : x, 1.9, rotY ? z : z - inset, rotY);
    };
    // Windows evenly along the back wall, the clock in the gap nearest where the theme
    // wants it, and the theme's wall decorations in the other gaps.
    const blocked = (x: number, half: number) => this.layout.wallBlocks.some(([c, h]) => Math.abs(x - c) < h + half);
    const backCount = Math.max(2, Math.floor(W / 3.4));
    const panes = Array.from({ length: backCount }, (_, i) => ((i + 0.5) / backCount) * W);
    const gaps = panes.slice(1).map((x, i) => (x + panes[i]!) / 2).filter((g) => !blocked(g, 0.3));
    const want = this.layout.clockX;
    const clockX = gaps.length > 0 ? gaps.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : want;
    for (const x of panes) if (!blocked(x, 0.75)) windowAt(x, 0.03, 0, (x / W) * 0.62);
    gaps
      .filter((g) => g !== clockX)
      .forEach((g, i) => {
        const asset = theme.wallDecor[i % Math.max(1, theme.wallDecor.length)];
        if (!asset || !this.kit.has(asset)) return;
        add(this.kit.make(asset), g, asset === "HangingPlant" ? 2.35 : 1.95, 0.01, 0, asset === "HangingPlant" ? 1.3 : 1);
      });
    // Left wall: one window beside the door, then more along the desks.
    windowAt(0.03, 1.2, Math.PI / 2, 0.66);
    const sideStart = WALK_Z + 1.6;
    const sideCount = Math.floor((D - sideStart) / 3.6);
    for (let i = 0; i < sideCount; i++) {
      windowAt(0.03, sideStart + ((i + 0.5) / sideCount) * (D - sideStart), Math.PI / 2, 0.7 + i * 0.09);
    }

    const clock = add(this.kit.make("Clock"), clockX, 2.15, 0.06);
    clock.scale.setScalar(1.25);
    this.clockHands = { hour: part(clock, "Clock_Hour"), minute: part(clock, "Clock_Minute") };

    for (const f of this.layout.furniture) {
      if (!this.kit.has(f.asset)) continue;
      const obj = add(this.kit.make(f.asset), f.x, f.y ?? 0, f.z, f.rotation, f.scale);
      if (f.bob) this.life.bobbers.push({ obj, phase: f.x * 1.7 });
    }
    this.collectLife();

    for (const rug of this.layout.rugs) this.addRug(rug);

    for (const pod of this.layout.pods) {
      const rug = new THREE.Mesh(
        this.track(new THREE.ShapeGeometry(roundedRect(pod.w - 0.28, pod.d - 0.28, 0.35), 8)),
        this.track(new THREE.MeshStandardMaterial({ color: pod.color, roughness: 1 })),
      );
      rug.rotation.x = -Math.PI / 2;
      rug.receiveShadow = true;
      this.room.add(rug);
      rug.position.set(pod.x + pod.w / 2, 0.008, pod.z + pod.d / 2);

      const sign = add(this.kit.make("Sign"), pod.x + pod.w / 2, 0, pod.z + pod.d + 0.32, 0, 1.5);
      part(sign, "Sign_Face").material = this.signMaterial(pod.project, pod.count, pod.color);
    }

    // Each ball game gets its ball (or puck), resting where play starts.
    for (const def of this.layout.games) {
      let ball: THREE.Mesh | null = null;
      if (def.kind !== "turns" && def.rest) {
        const geometry =
          def.kind === "hockey"
            ? new THREE.CylinderGeometry(0.045, 0.045, 0.018, 20)
            : new THREE.SphereGeometry(def.kind === "toss" ? 0.07 : 0.028, 16, 12);
        ball = new THREE.Mesh(
          this.track(geometry),
          this.track(new THREE.MeshStandardMaterial({ color: def.ball ?? "#FFFFFF", roughness: 0.4 })),
        );
        ball.castShadow = true;
        ball.position.set(def.rest.x, def.rest.y, def.rest.z);
        this.room.add(ball);
      }
      this.games.push({ def, ball, u: 0, leg: 0 });
    }

    this.ambient?.fit({ width: W, depth: D, fire: this.fireAt() });
    this.fitLights();
  }

  /** Finds the furniture's moving parts once, so the frame loop can animate them. */
  private collectLife() {
    const life = this.life;
    const own = (mesh: THREE.Object3D | undefined) => {
      if (!(mesh instanceof THREE.Mesh) || !(mesh.material instanceof THREE.MeshStandardMaterial)) return null;
      return mesh.material;
    };
    life.flames = parts(this.room, "Fireplace_Flame");
    for (const flame of life.flames) flame.userData.base = flame.scale.clone();
    life.fish = parts(this.room, "KoiPond_Fish").filter((o) => /_Fish\d$/.test(o.name));
    life.hammocks = parts(this.room, "Hammock_Bed");
    const glows = new Set<THREE.MeshStandardMaterial>();
    for (const o of parts(this.room, "Fireplace_Glow")) {
      const m = own(o);
      if (m) glows.add(m);
    }
    life.glows = [...glows];
    const pulses = new Set<THREE.MeshStandardMaterial>();
    for (const o of [...parts(this.room, "Hydroponics_Light"), ...parts(this.room, "VendingMachine_Header")]) {
      const m = own(o);
      if (m) pulses.add(m);
    }
    life.pulses = [...pulses];
    for (const m of life.pulses) m.userData.base ??= m.emissiveIntensity;
    for (const m of life.glows) m.userData.base ??= m.emissiveIntensity;
  }

  /** The fireplace's opening in room coordinates, or null when there is none. */
  private fireAt(): THREE.Vector3 | null {
    const f = this.layout.furniture.find((x) => x.asset === "Fireplace");
    return f ? new THREE.Vector3(f.x, 0.3, f.z + 0.12) : null;
  }

  private addRug(rug: Rug) {
    let geometry: THREE.BufferGeometry;
    if (rug.shape === "circle") geometry = new THREE.CircleGeometry(rug.w / 2, 48);
    else if (rug.shape === "rect") geometry = new THREE.ShapeGeometry(roundedRect(rug.w, rug.d, 0.2), 6);
    else {
      // A soft, irregular patch, like sand spilled on the boards.
      const shape = new THREE.Shape();
      const n = 28;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const wobble = 1 + Math.sin(a * 3 + rug.x) * 0.06 + Math.sin(a * 5 + rug.z) * 0.04;
        const x = Math.cos(a) * (rug.w / 2) * wobble;
        const y = Math.sin(a) * (rug.d / 2) * wobble;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      geometry = new THREE.ShapeGeometry(shape, 4);
    }
    const mesh = new THREE.Mesh(this.track(geometry), this.track(new THREE.MeshStandardMaterial({ color: rug.color, roughness: 1 })));
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    mesh.position.set(rug.x, 0.006, rug.z);
    this.room.add(mesh);
  }

  private signMaterial(project: string, count: number, color: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 688;
    canvas.height = 192;
    const c = canvas.getContext("2d")!;
    c.fillStyle = color;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "#1F2A3A";
    c.textBaseline = "middle";
    let size = 92;
    do {
      c.font = `600 ${size}px Fredoka, ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      size -= 4;
    } while (c.measureText(project).width > canvas.width - 190 && size > 36);
    c.fillText(project, 36, 100);
    const badge = String(count);
    c.font = `600 64px Fredoka, ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    const bw = Math.max(96, c.measureText(badge).width + 56);
    c.fillStyle = "rgba(255,255,255,0.75)";
    c.beginPath();
    c.roundRect(canvas.width - bw - 28, 48, bw, 96, 48);
    c.fill();
    c.fillStyle = "#1F2A3A";
    c.textAlign = "center";
    c.fillText(badge, canvas.width - 28 - bw / 2, 100);
    const texture = this.track(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = 8;
    return this.track(new THREE.MeshBasicMaterial({ map: texture }));
  }

  private fitLights() {
    const { width: W, depth: D } = this.layout;
    const reach = Math.hypot(W, D) / 2 + 2;
    this.sun.position.set(0.5, 1.05, 0.6).normalize().multiplyScalar(60);
    this.sun.target.position.set(0, 0, 0);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -reach;
    cam.right = cam.top = reach;
    cam.near = 10;
    cam.far = 130;
    cam.updateProjectionMatrix();
    this.fill.position.set(-0.2, 1, 0.5).multiplyScalar(40);
  }

  private frameRoom(animate: boolean) {
    const { width: W, depth: D } = this.layout;
    const radius = Math.hypot(W, D) / 2;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    // Half-angles of the part of the view the panels leave uncovered.
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) / (h + this.insetBottom);
    const halfV = Math.atan(tanHalf * (h - this.insetBottom));
    const halfH = Math.atan(tanHalf * Math.max(0.3 * h, w - this.inset));
    const fit = radius / Math.sin(Math.min(halfV, halfH));
    const distance = fit * 0.82;
    const target = new THREE.Vector3(0, 0.4, 0);
    this.controls.minDistance = 4;
    this.controls.maxDistance = fit * 1.6;
    if (animate) {
      this.focus = { target, distance };
      return;
    }
    const azimuth = 0.62;
    const elevation = 0.6;
    this.controls.target.copy(target);
    this.camera.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance + target.y,
      Math.cos(azimuth) * Math.cos(elevation) * distance,
    );
    this.framed = true;
  }

  private resize() {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    // The roster covers the left edge on wide screens and the bottom on narrow
    // ones, so the view centers in the part it leaves open.
    const board = this.callbacks.board !== false;
    this.inset = board && w > 820 ? BOARD_INSET : 0;
    this.insetBottom = !board || w > 820 ? 0 : Math.round(h * BOARD_SHARE_NARROW) + 12;
    this.camera.aspect = (w + this.inset) / (h + this.insetBottom);
    this.camera.setViewOffset(w + this.inset, h + this.insetBottom, 0, this.insetBottom, w, h);
    this.camera.updateProjectionMatrix();
  }

  private applyTime(snap: boolean) {
    const target = nightFactor(this.timeMode);
    this.night = snap ? target : damp(this.night, target, 2.5, 1 / 60);
    const n = this.night;
    const { day, night } = this.palette;
    const mix = (a: THREE.Color, b: THREE.Color) => a.clone().lerp(b, n);
    this.scene.background = mix(day.background, night.background);
    this.hemi.color.copy(mix(day.sky, night.sky));
    this.hemi.groundColor.copy(mix(day.ground, night.ground));
    this.hemi.intensity = THREE.MathUtils.lerp(1.15, 0.7, n);
    this.sun.color.copy(mix(day.sun, night.sun));
    this.sun.intensity = THREE.MathUtils.lerp(2.7, 1.9, n);
    this.fill.intensity = n * 0.5;
    this.container.dataset.night = n > 0.5 ? "1" : "0";
  }

  // ---------------------------------------------------------------- walking

  private claimSpot(actor: Actor): Spot | null {
    const free = this.layout.spots.filter((s) => !this.spotOwner.has(s.id));
    if (free.length === 0) return null;
    // Someone waiting at a game or a chat is hard to resist.
    const partner = new Map<string, string>();
    for (const g of this.layout.games) {
      partner.set(g.a, g.b);
      partner.set(g.b, g.a);
    }
    const invited = free.filter((s) => {
      const other = partner.get(s.id);
      return other !== undefined && this.spotOwner.has(other) && this.spotOwner.get(other) !== actor.snap.id;
    });
    // And with nobody waiting, a game is still a likely first choice.
    const games = free.filter((s) => partner.has(s.id));
    const roll = Math.random();
    const pool = invited.length > 0 && roll < 0.8 ? invited : games.length > 0 && roll < 0.5 ? games : free;
    const pickIndex = Math.floor(hash01(actor.snap.id, Math.floor(this.t)) * pool.length);
    const spot = pool[pickIndex]!;
    this.releaseSpot(actor);
    this.spotOwner.set(spot.id, actor.snap.id);
    actor.spot = spot;
    return spot;
  }

  private releaseSpot(actor: Actor) {
    if (actor.spot && this.spotOwner.get(actor.spot.id) === actor.snap.id) this.spotOwner.delete(actor.spot.id);
    actor.spot = null;
  }

  private sendToSpot(actor: Actor) {
    const from = actor.mode === "desk" ? null : actor.spot;
    const spot = this.claimSpot(actor);
    if (!spot) {
      actor.roamAt = this.t + 30;
      return;
    }
    const lead = actor.mode === "desk" ? actor.exitRoute().slice(1) : from ? leaveSpot(from) : [new THREE.Vector3(actor.clawd.root.position.x, 0, WALK_Z)];
    actor.path = [...lead, ...leaveSpot(spot).reverse(), spotPosition(spot)];
    actor.mode = "walk";
    actor.goal = "spot";
    actor.speed = STROLL_SPEED;
  }

  private sendToDesk(actor: Actor, speed: number) {
    const here = actor.clawd.root.position;
    const route = actor.exitRoute();
    let path: THREE.Vector3[];
    if (actor.mode === "spot" && actor.spot) {
      path = [...leaveSpot(actor.spot), ...route.slice().reverse()];
    } else if (here.z <= WALK_Z + 0.05) {
      path = [new THREE.Vector3(here.x, 0, WALK_Z), ...route.slice().reverse()];
    } else {
      // Already among the desks: rejoin the route at the nearest leg and walk it home.
      path = route.slice(0, nearestLeg(here, route) + 1).reverse();
    }
    this.releaseSpot(actor);
    actor.path = path;
    actor.mode = "walk";
    actor.goal = "desk";
    actor.speed = speed;
  }

  private sendToExit(actor: Actor) {
    const here = actor.clawd.root.position;
    const route = actor.exitRoute();
    let lead: THREE.Vector3[];
    if (actor.mode === "desk") lead = route.slice(1);
    else if (actor.mode === "spot" && actor.spot) lead = leaveSpot(actor.spot);
    else if (here.z <= WALK_Z + 0.05) lead = [new THREE.Vector3(here.x, 0, WALK_Z)];
    else lead = route.slice(nearestLeg(here, route) + 1);
    this.releaseSpot(actor);
    actor.path = [...lead, new THREE.Vector3(DOOR_INSIDE_X, 0, WALK_Z), new THREE.Vector3(DOOR_OUTSIDE_X, 0, WALK_Z)];
    actor.mode = "walk";
    actor.goal = "exit";
    actor.speed = STROLL_SPEED;
    actor.viaDoor = true;
  }

  private updateActor(actor: Actor, dt: number) {
    const { snap, clawd } = actor;
    const wantsBreak = snap.activity === "idle";
    const exiting = actor.mode === "walk" && actor.goal === "exit";

    if (snap.activity === "away") {
      if (!exiting) this.sendToExit(actor);
    } else if (exiting) {
      // Called back to work on the way out.
      this.sendToDesk(actor, HURRY_SPEED);
    } else if (!wantsBreak && (actor.mode === "spot" || (actor.mode === "walk" && actor.goal === "spot"))) {
      this.sendToDesk(actor, snap.activity === "sleeping" ? STROLL_SPEED : HURRY_SPEED);
    } else if (wantsBreak && this.t > actor.roamAt && actor.mode !== "walk") {
      actor.roamAt = this.t + 45 + Math.random() * 90;
      this.sendToSpot(actor);
    } else if (actor.mode === "walk" && actor.goal === "desk" && snap.activity !== "sleeping" && !wantsBreak) {
      actor.speed = HURRY_SPEED;
    }

    const pos = clawd.root.position;
    let facing = 0;
    if (actor.mode === "walk") {
      let budget = actor.speed * dt;
      while (budget > 0 && actor.path.length > 0) {
        const next = actor.path[0]!;
        const flat = Math.hypot(next.x - pos.x, next.z - pos.z);
        if (flat <= budget) {
          pos.copy(next);
          budget -= flat;
          actor.path.shift();
        } else {
          const u = budget / flat;
          pos.x += (next.x - pos.x) * u;
          pos.z += (next.z - pos.z) * u;
          // Height changes are short hops onto or off a seat.
          pos.y += (next.y - pos.y) * Math.min(1, u * 2.5);
          facing = Math.atan2(next.x - pos.x, next.z - pos.z);
          budget = 0;
        }
      }
      if (actor.path.length === 0) {
        if (actor.goal === "exit") {
          this.departed.push(actor);
        } else {
          actor.mode = actor.goal === "desk" ? "desk" : "spot";
          actor.viaDoor = false;
          if (actor.mode === "spot") actor.roamAt = this.t + 45 + Math.random() * 90;
        }
      } else {
        actor.heading = dampAngle(actor.heading, facing, 12, dt);
      }
    }
    if (actor.mode === "desk") {
      pos.copy(actor.seatPosition());
      actor.heading = dampAngle(actor.heading, 0, 8, dt);
    } else if (actor.mode === "spot" && actor.spot) {
      actor.heading = dampAngle(actor.heading, actor.spot.facing, 8, dt);
    }

    actor.station.group.position.set(actor.cell.x, 0, actor.cell.z);
    clawd.root.rotation.y = actor.heading;
    clawd.walkSpeed = actor.mode === "walk" ? actor.speed : 0;
    clawd.atDesk = actor.mode === "desk";
    clawd.activity = snap.activity;
    const atSpot = actor.mode === "spot" && actor.spot ? actor.spot : null;
    // Games set `doing` themselves each frame; everywhere else it is the spot's pose.
    if (!atSpot) clawd.doing = null;
    else if (!this.inGame.has(snap.id)) clawd.doing = atSpot.pose;
    clawd.hold(this.kit, atSpot?.prop ?? null);
    // A Clawd leaving shrinks away as it steps through the doorway.
    const vanishing = actor.mode === "walk" && actor.goal === "exit" && pos.x < DOOR_INSIDE_X - 0.25;
    actor.grow = damp(actor.grow, vanishing ? 0 : 1, vanishing ? 9 : 6, dt);
    clawd.root.scale.setScalar(Math.max(0.001, actor.grow));
    clawd.update(this.t, dt);
    actor.station.update(this.t, dt, snap, this.night, actor.mode === "desk");
  }

  // ------------------------------------------------------------------- life

  private animateRoom(dt: number) {
    const t = this.t;
    const life = this.life;
    life.flames.forEach((flame, i) => {
      const base = flame.userData.base as THREE.Vector3;
      const k = 1 + Math.sin(t * 11 + i * 2.1) * 0.12 + Math.sin(t * 23 + i) * 0.08;
      flame.scale.set(base.x / Math.sqrt(k), base.y * k, base.z / Math.sqrt(k));
    });
    const flicker = 0.85 + Math.sin(t * 9) * 0.08 + Math.sin(t * 21) * 0.07;
    for (const m of life.glows) m.emissiveIntensity = (m.userData.base as number) * flicker;
    // The fire warms the room most once the sun is down.
    const fire = life.flames.length > 0 ? this.fireAt() : null;
    this.fireLight.visible = fire !== null;
    if (fire) {
      this.fireLight.position.set(fire.x, 0.75, fire.z + 0.55);
      this.fireLight.intensity = (2.5 + this.night * 7) * flicker;
    }
    life.fish.forEach((fish, i) => (fish.rotation.y += dt * (i % 2 ? -0.55 : 0.4)));
    for (const bed of life.hammocks) bed.rotation.x = Math.sin(t * 1.1) * 0.06;
    for (const m of life.pulses) m.emissiveIntensity = (m.userData.base as number) * (0.75 + Math.sin(t * 1.6) * 0.25);
    for (const b of life.bobbers) b.obj.position.y = 0.08 + Math.sin(t * 1.2 + b.phase) * 0.07;
  }

  /** Who is sitting at each hangout right now, once they have arrived. */
  private occupants(): Map<string, Actor> {
    const at = new Map<string, Actor>();
    for (const actor of this.actors.values()) if (actor.mode === "spot" && actor.spot) at.set(actor.spot.id, actor);
    return at;
  }

  private updateGames(dt: number) {
    this.inGame.clear();
    if (this.games.length === 0) return;
    const at = this.occupants();
    for (const game of this.games) {
      const { def, ball } = game;
      const a = at.get(def.a);
      const b = at.get(def.b);
      const spotA = this.layout.spots.find((s) => s.id === def.a);
      const spotB = this.layout.spots.find((s) => s.id === def.b);
      if (!a || !b || !spotA || !spotB) {
        // Someone alone at a game waits for a partner.
        const lone = a ?? b;
        if (lone && def.kind !== "turns") {
          lone.clawd.doing = "ready";
          this.inGame.add(lone.snap.id);
        }
        game.u = 0;
        game.leg = 0;
        if (ball && def.rest) ball.position.set(def.rest.x, def.rest.y, def.rest.z);
        continue;
      }
      this.inGame.add(a.snap.id);
      this.inGame.add(b.snap.id);

      if (def.kind === "turns") {
        // They take turns: one makes a move (or talks) while the other thinks (or listens).
        const turn = Math.floor((this.t + hash01(def.id) * 9) / TURN_SECONDS) % 2;
        const [act, wait]: [Doing, Doing] = def.id === "chess" ? ["move", "ponder"] : ["talk", "listen"];
        a.clawd.doing = turn ? act : wait;
        b.clawd.doing = turn ? wait : act;
        continue;
      }

      a.clawd.doing = b.clawd.doing = "play";
      if (!ball) continue;
      game.u += dt * BALL_CROSSINGS[def.kind];
      const leg = Math.floor(game.u) % 2;
      if (leg !== game.leg) {
        // The ball has reached whoever it was flying to, and back it goes.
        (leg === 1 ? b : a).clawd.swat();
        game.leg = leg;
      }
      const k = game.u - Math.floor(game.u);
      const hitY = def.hitY ?? def.rest!.y;
      const from = new THREE.Vector3(spotA.x, hitY, spotA.z);
      const to = new THREE.Vector3(spotB.x, hitY, spotB.z);
      // Struck a little in front of each player.
      const reach = to.clone().sub(from).setY(0).setLength(0.3);
      from.add(reach);
      to.sub(reach);
      const [p, q] = leg === 0 ? [from, to] : [to, from];
      const pos = p.clone().lerp(q, k);
      const table = def.rest!.y;
      if (def.kind === "pong") {
        // Over the net, one bounce on the far side, up to the paddle.
        pos.y = k < 0.72 ? THREE.MathUtils.lerp(hitY, table, k / 0.72) + 0.22 * Math.sin((Math.PI * k) / 0.72) : THREE.MathUtils.lerp(table, hitY, (k - 0.72) / 0.28) + 0.08 * Math.sin((Math.PI * (k - 0.72)) / 0.28);
      } else if (def.kind === "hockey") {
        pos.y = table;
        pos.z += Math.sin(k * Math.PI) * 0.2 * (leg ? 1 : -1);
      } else {
        pos.y = hitY + Math.sin(k * Math.PI) * 0.85;
      }
      ball.position.copy(pos);
      ball.rotation.x += dt * 8;
    }
  }

  private updatePet(dt: number) {
    const pet = this.pet;
    if (!pet) return;
    const friends: THREE.Vector3[] = [];
    for (const actor of this.actors.values()) {
      if (actor.mode === "spot" && actor.spot) friends.push(spotPosition(actor.spot));
    }
    pet.update(this.t, dt, {
      width: this.layout.width,
      lane: WALK_Z - 0.4,
      home: this.layout.pet,
      friends,
      sights: this.layout.spots.filter((s) => !this.spotOwner.has(s.id)).map(spotPosition),
    });
    if (pet.greeted) {
      this.emote(pet.greeted.clone().setY(0.55), "♥");
      pet.greeted = null;
    }
  }

  /** A little symbol that floats up from a spot in the room and fades. */
  private emote(at: THREE.Vector3, text: string) {
    const el = document.createElement("div");
    el.className = "emote";
    el.textContent = text;
    el.setAttribute("aria-hidden", "true");
    this.labels.append(el);
    this.emotes.push({ el, at, until: this.t + 1.6 });
  }

  // ------------------------------------------------------------------ frame

  private frame = () => {
    if (this.disposed) return;
    if (this.pending) {
      const snap = this.pending;
      this.pending = null;
      this.setSnapshot(snap);
    }
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    this.t += dt;

    this.applyTime(false);
    if (this.clockHands) {
      const now = new Date();
      const minutes = now.getMinutes() + now.getSeconds() / 60;
      this.clockHands.minute.rotation.z = -(minutes / 60) * Math.PI * 2;
      this.clockHands.hour.rotation.z = -(((now.getHours() % 12) + minutes / 60) / 12) * Math.PI * 2;
    }

    this.view?.update(this.t, this.night);
    this.animateRoom(dt);
    this.updateGames(dt);
    this.updatePet(dt);
    this.ambient?.update(this.t, this.night);
    this.confetti.update(dt);

    let atDoor = false;
    for (const actor of this.actors.values()) {
      this.updateActor(actor, dt);
      const p = actor.clawd.root.position;
      if (actor.viaDoor && Math.hypot(p.x - DOOR_INSIDE_X, p.z - WALK_Z) < 2.2) atDoor = true;
    }
    this.removeDeparted();
    this.doorOpen = damp(this.doorOpen, atDoor ? 1 : 0, 7, dt);
    if (this.doorPanel) this.doorPanel.rotation.y = -this.doorOpen * 1.4;

    if (this.focus) {
      const { target, distance } = this.focus;
      const offset = this.camera.position.clone().sub(this.controls.target);
      const length = damp(offset.length(), distance, 5, dt);
      this.controls.target.x = damp(this.controls.target.x, target.x, 5, dt);
      this.controls.target.y = damp(this.controls.target.y, target.y, 5, dt);
      this.controls.target.z = damp(this.controls.target.z, target.z, 5, dt);
      this.camera.position.copy(this.controls.target).add(offset.setLength(length));
      if (this.controls.target.distanceTo(target) < 0.02 && Math.abs(length - distance) < 0.05) this.focus = null;
    }
    // Panning stops at the edge of the room so the office cannot be lost off screen.
    const limitX = this.layout.width / 2 + 2;
    const limitZ = this.layout.depth / 2 + 2;
    const target = this.controls.target;
    const clamped = new THREE.Vector3(
      THREE.MathUtils.clamp(target.x, -limitX, limitX),
      THREE.MathUtils.clamp(target.y, 0, 2.5),
      THREE.MathUtils.clamp(target.z, -limitZ, limitZ),
    );
    this.camera.position.add(clamped.clone().sub(target));
    target.copy(clamped);
    this.controls.update();

    if (this.paused) return;
    this.placeTags();
    this.renderer.render(this.scene, this.camera);
  };

  private placeTags() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const v = new THREE.Vector3();
    for (const actor of this.actors.values()) {
      const { snap } = actor;
      const emphasized = snap.id === this.selected || snap.id === this.hovered;
      const hovered = snap.id === this.hovered;
      actor.tag.set(snap, hovered, actor.mode !== "desk", hovered ? taskOf(snap) : null);
      actor.clawd.root.getWorldPosition(v);
      const lift = snap.activity === "waiting" ? 0.5 : snap.activity === "sleeping" && actor.mode === "desk" ? 0.12 : 0.34;
      v.y += 0.52 * CLAWD_SCALE + lift;
      v.project(this.camera);
      // Every Clawd in the office keeps its status marker; one gone home shows only when picked.
      const visible = v.z < 1 && (emphasized || snap.activity !== "away");
      actor.tag.place((v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, visible);
      actor.tag.el.style.zIndex = emphasized ? "3" : snap.activity === "waiting" ? "2" : "1";
    }

    const toScreen = (p: THREE.Vector3) => {
      v.copy(p).add(this.world.position).project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, front: v.z < 1 };
    };
    this.emotes = this.emotes.filter((e) => {
      if (this.t > e.until) {
        e.el.remove();
        return false;
      }
      const p = toScreen(e.at);
      e.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      e.el.style.display = p.front ? "" : "none";
      return true;
    });

    const pet = this.pet;
    this.petTag.hidden = !pet || !this.petHovered;
    if (pet && this.petHovered) {
      this.petTag.textContent = pet.name;
      const p = toScreen(pet.position.clone().setY(pet.position.y + 0.42));
      this.petTag.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
  }
}

/** Index of the route leg closest to a point. */
function nearestLeg(point: THREE.Vector3, route: THREE.Vector3[]): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    const dist = distanceToSegment(point, route[i]!, route[i + 1]!);
    if (dist < bestDistance) {
      bestDistance = dist;
      best = i;
    }
  }
  return best;
}

/** A rectangle with rounded corners, centered on the origin. */
function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -d / 2);
  shape.lineTo(w / 2 - r, -d / 2);
  shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -d / 2 + r);
  shape.lineTo(w / 2, d / 2 - r);
  shape.quadraticCurveTo(w / 2, d / 2, w / 2 - r, d / 2);
  shape.lineTo(-w / 2 + r, d / 2);
  shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, d / 2 - r);
  shape.lineTo(-w / 2, -d / 2 + r);
  shape.quadraticCurveTo(-w / 2, -d / 2, -w / 2 + r, -d / 2);
  return shape;
}

const tints = new Map<string, THREE.MeshStandardMaterial>();

/** A copy of a kit material in another color, shared by everything that asks for the same one. */
function tinted(material: THREE.MeshStandardMaterial, color: string): THREE.MeshStandardMaterial {
  const key = `${material.uuid}:${color}`;
  let copy = tints.get(key);
  if (!copy) {
    copy = material.clone();
    copy.color.set(color);
    if (copy.emissiveIntensity > 0 && !copy.emissive.equals(new THREE.Color(0, 0, 0))) copy.emissive.set(color);
    tints.set(key, copy);
  }
  return copy;
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

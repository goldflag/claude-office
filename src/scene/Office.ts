import * as THREE from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AgentSnapshot, OfficeSnapshot } from "../../shared/types.ts";
import { describeAgent } from "../describe.ts";
import { Clawd } from "./Clawd.ts";
import { damp, hash01, Kit, part } from "./kit.ts";
import {
  AISLE_Z,
  type Cell,
  computeLayout,
  DOOR_INSIDE_X,
  DOOR_OUTSIDE_X,
  projectColors,
  type RoomLayout,
  SEAT_X,
  SEAT_Y,
  SEAT_Z,
  type Spot,
  WALK_Z,
} from "./layout.ts";
import { Station } from "./Station.ts";

export type TimeMode = "auto" | "day" | "night";

export interface OfficeCallbacks {
  onSelect(id: string | null): void;
}

const WALL_H = 3;
const CLAWD_SCALE = 1.15;
const STROLL_SPEED = 1.5;
const HURRY_SPEED = 3.4;
/** Width in pixels that the roster board takes from the left of the view. */
const BOARD_INSET = 320;
/** Share of the height the board takes from the bottom on narrow screens, matching the small-screen CSS. */
const BOARD_SHARE_NARROW = 0.42;

const DAY = {
  background: new THREE.Color("#B4CDE9"),
  sky: new THREE.Color("#FFFFFF"),
  ground: new THREE.Color("#C9C2B6"),
  sun: new THREE.Color("#FFF1DA"),
  glass: new THREE.Color("#D6ECFF"),
};
// Night is a lit room in a dark world: warm lamps inside, dusk outside.
const NIGHT = {
  background: new THREE.Color("#2A3158"),
  sky: new THREE.Color("#C2C8F2"),
  ground: new THREE.Color("#6B6072"),
  sun: new THREE.Color("#FFDDB0"),
  glass: new THREE.Color("#3A4690"),
};

function nightFactor(mode: TimeMode): number {
  if (mode !== "auto") return mode === "night" ? 1 : 0;
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  if (h < 5 || h >= 20) return 1;
  if (h < 7) return 1 - (h - 5) / 2;
  if (h < 17) return 0;
  return (h - 17) / 3;
}

/** The floating name and status bubble above one agent, drawn in the DOM. */
class Tag {
  readonly el = document.createElement("div");
  private bubble = document.createElement("div");
  private name = document.createElement("div");
  private text = "";

  constructor(parent: HTMLElement) {
    this.el.className = "tag";
    this.bubble.className = "tag-bubble";
    this.name.className = "tag-name";
    const stack = document.createElement("div");
    stack.className = "tag-stack";
    stack.append(this.bubble, this.name);
    this.el.append(stack);
    parent.append(this.el);
  }

  set(agent: AgentSnapshot, emphasized: boolean, away: boolean) {
    const state = agent.activity;
    const quiet = state === "idle" || state === "sleeping" || state === "away";
    const text = state === "sleeping" ? "z z z" : quiet ? "" : describeAgent(agent);
    if (text !== this.text) {
      this.text = text;
      this.bubble.textContent = text;
    }
    this.name.textContent = agent.name;
    this.el.dataset.state = state;
    this.el.dataset.emphasis = emphasized ? "1" : "0";
    this.el.dataset.away = away ? "1" : "0";
    this.bubble.hidden = text === "";
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
  private glass = new THREE.MeshBasicMaterial({ color: "#D6ECFF" });
  private clockHands: { hour: THREE.Object3D; minute: THREE.Object3D } | null = null;
  private labels = document.createElement("div");
  private actors = new Map<string, Actor>();
  private spotOwner = new Map<string, string>();
  private layout: RoomLayout = computeLayout([]);
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
    this.kit = await Kit.load();
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
    this.world.add(this.room);

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

    this.buildRoom();
    this.resizeObserver.observe(this.container);
    this.resize();
    this.applyTime(true);
    renderer.setAnimationLoop(this.frame);
  }

  // ------------------------------------------------------------------ input

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
    for (const hit of ray.intersectObjects(targets, true)) {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        if (typeof o.userData.agentId === "string") return o.userData.agentId;
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
    this.callbacks.onSelect(this.pick(e));
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.pointerDown) return;
    this.hovered = this.pick(e);
    this.renderer.domElement.style.cursor = this.hovered ? "pointer" : "grab";
  };

  private onPointerLeave = () => {
    this.hovered = null;
  };

  // ----------------------------------------------------------------- public

  setTimeMode(mode: TimeMode) {
    this.timeMode = mode;
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

    const layout = computeLayout(present, projectColors(everyone.map((a) => a.project)));
    const roomChanged = layout.key !== this.layout.key;
    const resized = layout.width !== this.layout.width || layout.depth !== this.layout.depth;
    this.layout = layout;
    if (roomChanged) this.buildRoom();

    for (const agent of present) {
      const cell = layout.cells.get(agent.id)!;
      let actor = this.actors.get(agent.id);
      if (!actor) {
        actor = new Actor(this.kit, this.labels, agent, cell);
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
        if (agent.activity === "done") actor.clawd.cheer();
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
    this.glass.dispose();
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
    if (!this.kit) return;

    const { width: W, depth: D } = this.layout;
    this.world.position.set(-W / 2, 0, -D / 2);
    const add = (obj: THREE.Object3D, x: number, y: number, z: number, rotY = 0, scale = 1) => {
      obj.position.set(x, y, z);
      obj.rotation.y = rotY;
      obj.scale.multiplyScalar(scale);
      this.room.add(obj);
      return obj;
    };
    const slab = (w: number, h: number, d: number, color: string, roughness = 0.9) => {
      const mesh = new THREE.Mesh(
        this.track(new THREE.BoxGeometry(w, h, d)),
        this.track(new THREE.MeshStandardMaterial({ color, roughness })),
      );
      mesh.receiveShadow = true;
      return mesh;
    };

    // Floor: a chunky base with checkered tiles on top, like a toy playset.
    const tile = document.createElement("canvas");
    tile.width = tile.height = 64;
    const tc = tile.getContext("2d")!;
    tc.fillStyle = "#DCE3E9";
    tc.fillRect(0, 0, 64, 64);
    tc.fillStyle = "#CFD8E0";
    tc.fillRect(0, 0, 32, 32);
    tc.fillRect(32, 32, 32, 32);
    const tiles = this.track(new THREE.CanvasTexture(tile));
    tiles.colorSpace = THREE.SRGBColorSpace;
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
    tiles.repeat.set(W / 2, D / 2);
    const floorTop = this.track(new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.85 }));
    const side = this.track(new THREE.MeshStandardMaterial({ color: "#F1ECE3", roughness: 0.9 }));
    const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(W, 0.5, D)), [side, side, floorTop, side, side, side]);
    base.receiveShadow = true;
    add(base, W / 2, -0.25, D / 2);

    const T = 0.3;
    add(slab(W + T, WALL_H + 0.5, T, "#F5F1E9"), W / 2 - T / 2, WALL_H / 2 - 0.25, -T / 2);
    add(slab(T, WALL_H + 0.5, D, "#F5F1E9"), -T / 2, WALL_H / 2 - 0.25, D / 2);
    add(slab(W, 0.95, 0.05, "#7FA3B0"), W / 2, 0.475, 0.025);
    add(slab(W, 0.07, 0.08, "#F5F1E9"), W / 2, 0.985, 0.04);
    // The left wall's trim stops either side of the door.
    for (const [z0, z1] of [
      [0, WALK_Z - 0.7],
      [WALK_Z + 0.7, D],
    ] as const) {
      add(slab(0.05, 0.95, z1 - z0, "#7FA3B0"), 0.025, 0.475, (z0 + z1) / 2);
      add(slab(0.08, 0.07, z1 - z0, "#F5F1E9"), 0.04, 0.985, (z0 + z1) / 2);
    }
    const door = add(this.kit.make("Door"), 0.03, 0, WALK_Z, Math.PI / 2);
    this.doorPanel = part(door, "Door_Panel");

    const windowAt = (x: number, z: number, rotY: number) => {
      const win = this.kit.make("Window");
      part(win, "Window_Glass").material = this.glass;
      win.traverse((o) => (o.castShadow = false));
      add(win, x, 1.9, z, rotY);
    };
    const clockX = W / 2 + 0.2;
    const backCount = Math.max(2, Math.floor(W / 3.4));
    for (let i = 0; i < backCount; i++) {
      const x = ((i + 0.5) / backCount) * W;
      if (Math.abs(x - clockX) > 1.3) windowAt(x, 0.03, 0);
    }
    // Left wall: one window beside the door, then more along the desks.
    windowAt(0.03, 1.2, Math.PI / 2);
    const sideStart = WALK_Z + 1.6;
    const sideCount = Math.floor((D - sideStart) / 3.6);
    for (let i = 0; i < sideCount; i++) {
      windowAt(0.03, sideStart + ((i + 0.5) / sideCount) * (D - sideStart), Math.PI / 2);
    }

    const clock = add(this.kit.make("Clock"), clockX, 2.15, 0.06);
    clock.scale.setScalar(1.25);
    this.clockHands = { hour: part(clock, "Clock_Hour"), minute: part(clock, "Clock_Minute") };

    for (const f of this.layout.furniture) add(this.kit.make(f.asset), f.x, 0, f.z, f.rotation, f.scale);

    const loungeRug = new THREE.Mesh(
      this.track(new THREE.CircleGeometry(1.75, 48)),
      this.track(new THREE.MeshStandardMaterial({ color: "#F0DCC0", roughness: 1 })),
    );
    loungeRug.rotation.x = -Math.PI / 2;
    loungeRug.receiveShadow = true;
    this.room.add(loungeRug);
    loungeRug.position.set(W - 3.6, 0.008, 1.55);

    for (const pod of this.layout.pods) {
      const inset = 0.14;
      const w = pod.w - inset * 2;
      const d = pod.d - inset * 2;
      const r = 0.35;
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
      const rug = new THREE.Mesh(
        this.track(new THREE.ShapeGeometry(shape, 8)),
        this.track(new THREE.MeshStandardMaterial({ color: pod.color, roughness: 1 })),
      );
      rug.rotation.x = -Math.PI / 2;
      rug.receiveShadow = true;
      this.room.add(rug);
      rug.position.set(pod.x + pod.w / 2, 0.008, pod.z + pod.d / 2);

      const sign = add(this.kit.make("Sign"), pod.x + pod.w / 2, 0, pod.z + pod.d + 0.32, 0, 1.5);
      part(sign, "Sign_Face").material = this.signMaterial(pod.project, pod.count, pod.color);
    }

    this.fitLights();
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
    this.inset = w > 820 ? BOARD_INSET : 0;
    this.insetBottom = w > 820 ? 0 : Math.round(h * BOARD_SHARE_NARROW) + 12;
    this.camera.aspect = (w + this.inset) / (h + this.insetBottom);
    this.camera.setViewOffset(w + this.inset, h + this.insetBottom, 0, this.insetBottom, w, h);
    this.camera.updateProjectionMatrix();
  }

  private applyTime(snap: boolean) {
    const target = nightFactor(this.timeMode);
    this.night = snap ? target : damp(this.night, target, 2.5, 1 / 60);
    const n = this.night;
    const mix = (a: THREE.Color, b: THREE.Color) => a.clone().lerp(b, n);
    this.scene.background = mix(DAY.background, NIGHT.background);
    this.hemi.color.copy(mix(DAY.sky, NIGHT.sky));
    this.hemi.groundColor.copy(mix(DAY.ground, NIGHT.ground));
    this.hemi.intensity = THREE.MathUtils.lerp(1.15, 0.7, n);
    this.sun.color.copy(mix(DAY.sun, NIGHT.sun));
    this.sun.intensity = THREE.MathUtils.lerp(2.7, 1.9, n);
    this.fill.intensity = n * 0.5;
    this.glass.color.copy(mix(DAY.glass, NIGHT.glass));
    this.container.dataset.night = n > 0.5 ? "1" : "0";
  }

  // ---------------------------------------------------------------- walking

  private claimSpot(actor: Actor): Spot | null {
    const free = this.layout.spots.filter((s) => !this.spotOwner.has(s.id));
    if (free.length === 0) return null;
    const pickIndex = Math.floor(hash01(actor.snap.id, Math.floor(this.t)) * free.length);
    const spot = free[pickIndex]!;
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
    const approach = new THREE.Vector3(spot.x, 0, WALK_Z);
    actor.path =
      actor.mode === "desk"
        ? [...actor.exitRoute().slice(1), approach, spotPosition(spot)]
        : [new THREE.Vector3(from?.x ?? actor.clawd.root.position.x, 0, WALK_Z), approach, spotPosition(spot)];
    actor.mode = "walk";
    actor.goal = "spot";
    actor.speed = STROLL_SPEED;
  }

  private sendToDesk(actor: Actor, speed: number) {
    const here = actor.clawd.root.position;
    const route = actor.exitRoute();
    let path: THREE.Vector3[];
    if (here.z <= WALK_Z + 0.05) {
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
    // A Clawd leaving shrinks away as it steps through the doorway.
    const vanishing = actor.mode === "walk" && actor.goal === "exit" && pos.x < DOOR_INSIDE_X - 0.25;
    actor.grow = damp(actor.grow, vanishing ? 0 : 1, vanishing ? 9 : 6, dt);
    clawd.root.scale.setScalar(Math.max(0.001, actor.grow));
    clawd.update(this.t, dt);
    actor.station.update(this.t, dt, snap, this.night, actor.mode === "desk");
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
    const close = this.camera.position.distanceTo(this.controls.target) < 16;
    const v = new THREE.Vector3();
    for (const actor of this.actors.values()) {
      const { snap } = actor;
      const emphasized = snap.id === this.selected || snap.id === this.hovered;
      const quiet = snap.activity === "idle" || snap.activity === "sleeping" || snap.activity === "away";
      actor.tag.set(snap, emphasized || close || snap.activity === "waiting", actor.mode !== "desk");
      actor.clawd.root.getWorldPosition(v);
      const lift = snap.activity === "waiting" ? 0.5 : snap.activity === "sleeping" && actor.mode === "desk" ? 0.12 : 0.34;
      v.y += 0.52 * CLAWD_SCALE + lift;
      v.project(this.camera);
      const visible = v.z < 1 && (emphasized || close || !quiet || snap.activity === "sleeping");
      actor.tag.place((v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * h, visible);
      actor.tag.el.style.zIndex = emphasized ? "3" : snap.activity === "waiting" ? "2" : "1";
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

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

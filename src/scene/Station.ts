import * as THREE from "three/webgpu";
import type { AgentSnapshot, SubagentSnapshot } from "../../shared/types.ts";
import { Clawd } from "./Clawd.ts";
import { damp, hash01, type Kit, part } from "./kit.ts";
import { SEAT_X, SEAT_Y, SEAT_Z } from "./layout.ts";
import { Screen } from "./screens.ts";

const DESK_TOP = 0.62;
const MAX_MINIS = 4;
// The monitor stands at the back of the desk, straight ahead of the seat.
const MONITOR_X = SEAT_X;
const MONITOR_Z = 0.2;
const MONITOR_FACING = Math.atan2(SEAT_X - MONITOR_X, SEAT_Z - MONITOR_Z);
/**
 * Renders as the terminal's #1f1e1d background once the scene's neutral tone
 * mapping has darkened it, so the screen fades into the terminal without a seam.
 */
const TERMINAL_BG = "#3c3c3b";

/** A monitor's screen in world space, as seen from the seat. */
export interface ScreenFace {
  /** Top left, top right, bottom right, bottom left. */
  corners: THREE.Vector3[];
  center: THREE.Vector3;
  /** Points out of the screen toward the seat. */
  normal: THREE.Vector3;
  /** The screen's own up direction. */
  up: THREE.Vector3;
  width: number;
  height: number;
}

interface Mini {
  group: THREE.Group;
  clawd: Clawd;
  /** 0 hidden, 1 fully present; drives the pop in and out. */
  grow: number;
  leaving: boolean;
}

interface Puff {
  mesh: THREE.Mesh;
  life: number;
  vx: number;
}

const puffGeometry = new THREE.SphereGeometry(0.06, 10, 8);

/** One agent's desk: furniture, monitor, lamp, paper stack and subagent desks. */
export class Station {
  readonly group = new THREE.Group();
  readonly screen = new Screen();
  /** Where the agent sits, in station space. */
  readonly seat = new THREE.Vector3(SEAT_X, SEAT_Y, SEAT_Z);
  private bulb: THREE.MeshStandardMaterial;
  private ring: THREE.Mesh;
  private ringMaterial: THREE.MeshBasicMaterial;
  private paper: THREE.Object3D;
  private paperHeight = 0.004;
  private minis = new Map<string, Mini>();
  private puffs: Puff[] = [];
  private puffMaterial = new THREE.MeshBasicMaterial({ color: "#8B8F99", transparent: true, opacity: 0.8 });
  private monitorTop = new THREE.Vector3(MONITOR_X, DESK_TOP + 0.5, MONITOR_Z);
  private panel: THREE.Mesh;
  /** The screen's corners in the panel's own space. */
  private panelCorners: THREE.Vector3[];

  constructor(
    private readonly kit: Kit,
    agentId: string,
  ) {
    const add = (obj: THREE.Object3D, x: number, y: number, z: number, rotY = 0) => {
      obj.position.set(x, y, z);
      obj.rotation.y = rotY;
      this.group.add(obj);
      return obj;
    };

    add(kit.make("Desk"), 0, 0, 0);
    const chair = add(kit.make("Chair"), SEAT_X, 0, SEAT_Z);
    chair.scale.set(1, SEAT_Y / 0.4, 1);

    // The screen points at the seat, so the usual camera angle sees its back.
    const monitor = add(kit.make("Monitor"), MONITOR_X, DESK_TOP, MONITOR_Z, MONITOR_FACING);
    monitor.scale.setScalar(0.88);
    this.panel = part(monitor, "Monitor_Screen");
    this.panel.material = this.screen.material;
    const geometry = this.panel.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox!;
    // The panel is flat, so its thinnest extent is the way it faces.
    const [thin, a, b] = [0, 1, 2].sort((i, j) => max.getComponent(i) - min.getComponent(i) - (max.getComponent(j) - min.getComponent(j)));
    this.panelCorners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ].map(([ua, ub]) => {
      const c = new THREE.Vector3();
      c.setComponent(thin!, (min.getComponent(thin!) + max.getComponent(thin!)) / 2);
      c.setComponent(a!, ua ? max.getComponent(a!) : min.getComponent(a!));
      c.setComponent(b!, ub ? max.getComponent(b!) : min.getComponent(b!));
      return c;
    });

    add(kit.make("Keyboard"), SEAT_X, DESK_TOP, -0.17);
    add(kit.make("Mug"), 0.52, DESK_TOP, -0.14, hash01(agentId, 1) * 6);

    this.paper = add(kit.make("Paper"), 0.33, DESK_TOP, 0.16, (hash01(agentId, 2) - 0.5) * 0.5);
    this.paper.scale.y = this.paperHeight;

    const lamp = add(kit.make("DeskLamp"), 0.55, DESK_TOP, 0.24);
    this.bulb = new THREE.MeshStandardMaterial({ color: "#FFF4D6", emissive: "#FFD27A", emissiveIntensity: 0.2 });
    part(lamp, "DeskLamp_Bulb").material = this.bulb;

    if (hash01(agentId, 3) > 0.45) add(kit.make("PlantSmall"), -0.56, DESK_TOP, -0.2, hash01(agentId, 4) * 6);

    this.ringMaterial = new THREE.MeshBasicMaterial({ color: "#FFC83D", transparent: true, opacity: 0, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.78, 48), this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(SEAT_X, 0.015, SEAT_Z);
    this.group.add(this.ring);
  }

  screenFace(): ScreenFace {
    this.panel.updateWorldMatrix(true, false);
    const world = this.panelCorners.map((c) => c.clone().applyMatrix4(this.panel.matrixWorld));
    const center = world.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(0.25);
    const normal = new THREE.Vector3()
      .subVectors(world[1]!, world[0]!)
      .cross(new THREE.Vector3().subVectors(world[3]!, world[0]!))
      .normalize();
    if (normal.dot(this.group.localToWorld(this.seat.clone()).sub(center)) < 0) normal.negate();
    const up = new THREE.Vector3(0, 1, 0).projectOnPlane(normal).normalize();
    const right = new THREE.Vector3().crossVectors(up, normal);
    // Name the corners by where they sit for someone in the seat.
    const along = world.map((p) => {
      const d = p.clone().sub(center);
      return { p, x: d.dot(right), y: d.dot(up) };
    });
    const pick = (score: (c: { x: number; y: number }) => number) =>
      along.reduce((best, c) => (score(c) > score(best) ? c : best)).p;
    const corners = [pick((c) => c.y - c.x), pick((c) => c.x + c.y), pick((c) => c.x - c.y), pick((c) => -c.x - c.y)];
    return {
      corners,
      center,
      normal,
      up,
      width: corners[0]!.distanceTo(corners[1]!),
      height: corners[0]!.distanceTo(corners[3]!),
    };
  }

  /** A burst of smoke from the monitor, for a failed tool call. */
  smoke() {
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(puffGeometry, this.puffMaterial);
      mesh.position.copy(this.monitorTop).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, 0));
      this.group.add(mesh);
      this.puffs.push({ mesh, life: 1 + i * 0.12, vx: (Math.random() - 0.5) * 0.25 });
    }
  }

  syncSubagents(subs: SubagentSnapshot[]) {
    const shown = subs.slice(0, MAX_MINIS);
    const ids = new Set(shown.map((s) => s.id));
    for (const [id, mini] of this.minis) if (!ids.has(id)) mini.leaving = true;

    shown.forEach((sub, i) => {
      let mini = this.minis.get(sub.id);
      if (!mini) {
        const group = new THREE.Group();
        const desk = this.kit.make("MiniDesk");
        desk.scale.setScalar(0.62);
        desk.position.z = 0.24;
        const laptop = this.kit.make("Laptop");
        laptop.scale.setScalar(0.75);
        laptop.position.set(0, 0.161, 0.25);
        laptop.rotation.y = Math.PI;
        const clawd = new Clawd(this.kit, 0.6);
        group.add(desk, laptop, clawd.root);
        group.scale.setScalar(0.001);
        this.group.add(group);
        mini = { group, clawd, grow: 0, leaving: false };
        this.minis.set(sub.id, mini);
      }
      mini.leaving = false;
      mini.clawd.activity = sub.activity;
      mini.group.position.set((i - (shown.length - 1) / 2) * 0.5 + 0.05, 0, 0.72);
    });
  }

  /** With `inspected`, someone is looking into this monitor and the terminal is drawn over it. */
  update(t: number, dt: number, agent: AgentSnapshot, night: number, seated: boolean, inspected: boolean) {
    // An empty chair shows a dark screen unless work is going on.
    const working = agent.activity !== "idle" && agent.activity !== "sleeping" && agent.activity !== "done";
    if (inspected) this.screen.blank(TERMINAL_BG);
    else this.screen.draw(seated || working ? agent.activity : "sleeping", t);

    const fill = Math.min(1, agent.contextTokens / 1_000_000) ** 0.6;
    this.paperHeight = damp(this.paperHeight, 0.004 + fill * 0.24, 3, dt);
    this.paper.scale.y = this.paperHeight;

    const waiting = agent.activity === "waiting";
    const pulse = (Math.sin(t * 5) + 1) / 2;
    this.bulb.emissive.set(waiting ? "#FFB300" : "#FFD27A");
    this.bulb.emissiveIntensity = waiting ? 1.2 + pulse * 1.6 : agent.activity === "sleeping" || agent.activity === "away" ? 0.05 : 0.15 + night * 1.3;
    this.ringMaterial.opacity = damp(this.ringMaterial.opacity, waiting ? 0.45 + pulse * 0.4 : 0, 8, dt);
    this.ring.visible = this.ringMaterial.opacity > 0.01;
    this.ring.scale.setScalar(1 + pulse * 0.12);

    for (const [id, mini] of this.minis) {
      mini.grow = damp(mini.grow, mini.leaving ? 0 : 1, 7, dt);
      mini.group.scale.setScalar(Math.max(0.001, mini.grow));
      mini.clawd.update(t, dt);
      if (mini.leaving && mini.grow < 0.02) {
        this.group.remove(mini.group);
        this.minis.delete(id);
      }
    }

    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i]!;
      puff.life -= dt;
      const age = 1 - Math.min(1, puff.life);
      puff.mesh.visible = puff.life < 1;
      puff.mesh.position.y += dt * 0.5;
      puff.mesh.position.x += dt * puff.vx;
      puff.mesh.scale.setScalar(0.6 + age * 1.8);
      if (puff.life <= 0) {
        this.group.remove(puff.mesh);
        this.puffs.splice(i, 1);
      }
    }
  }

  dispose() {
    this.screen.dispose();
    this.bulb.dispose();
    this.ring.geometry.dispose();
    this.ringMaterial.dispose();
    this.puffMaterial.dispose();
  }
}

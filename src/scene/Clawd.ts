import * as THREE from "three/webgpu";
import type { Activity } from "../../shared/types.ts";
import { type AssetName, damp, type Kit, part } from "./kit.ts";
import type { SpotPose } from "./layout.ts";

interface Pose {
  /** Forward lean of the body in radians. */
  lean: number;
  turn: number;
  /** 0 arms out to the sides, 1 arms reaching forward to the keyboard. */
  reach: number;
  raiseL: number;
  raiseR: number;
  eyeOpen: number;
  eyeUp: number;
  type: number;
  wave: number;
  hop: number;
  scan: number;
  sway: number;
}

const REST: Pose = {
  lean: 0,
  turn: 0,
  reach: 0,
  raiseL: 0,
  raiseR: 0,
  eyeOpen: 1,
  eyeUp: 0,
  type: 0,
  wave: 0,
  hop: 0,
  scan: 0,
  sway: 0,
};

const POSES: Record<Activity, Partial<Pose>> = {
  writing: { lean: 0.13, reach: 1, type: 1 },
  terminal: { lean: 0.1, reach: 1, type: 1 },
  reading: { lean: 0.2, reach: 0.35, scan: 1 },
  web: { lean: 0.14, reach: 0.7, scan: 0.6, type: 0.25 },
  tool: { lean: 0.08, reach: 1, type: 0.5 },
  thinking: { lean: -0.14, raiseR: 0.75, eyeUp: 1, sway: 1 },
  delegating: { lean: -0.06, reach: 0.25, sway: 0.4 },
  waiting: { hop: 1, raiseL: 1.25, wave: 1, eyeOpen: 1.12 },
  done: { lean: -0.2, sway: 0.5 },
  idle: { sway: 0.6 },
  sleeping: { lean: 0.4, eyeOpen: 0.1, raiseL: -0.35, raiseR: -0.35 },
  away: {},
};

/**
 * What a Clawd does away from its desk: the spot's pose, or a part in a game
 * (thinking over a chess move, making one, talking or listening).
 */
export type Doing = SpotPose | "ponder" | "move" | "talk" | "listen" | "ready";

const DOINGS: Record<Doing, Partial<Pose>> = {
  stand: { sway: 0.6 },
  sit: { sway: 0.4 },
  sip: { reach: 0.55, raiseR: 0.15, sway: 0.4 },
  read: { lean: 0.15, reach: 0.8, scan: 0.7, eyeUp: -0.4 },
  browse: { lean: 0.04, scan: 1, sway: 0.3, eyeUp: 0.3 },
  gaze: { lean: -0.06, eyeUp: 0.8, sway: 0.3 },
  scope: { lean: 0.3, reach: 0.65, eyeUp: 0.5 },
  warm: { reach: 1.15, lean: 0.06, eyeOpen: 0.45, sway: 0.5, type: 0.25 },
  water: { reach: 0.9, lean: 0.14, raiseR: 0.3, eyeUp: -0.6 },
  fish: { reach: 0.75, raiseR: 0.45, lean: -0.04, sway: 0.2 },
  nap: { lean: -0.25, eyeOpen: 0.06, raiseL: -0.3, raiseR: -0.3 },
  float: { sway: 0.9, raiseL: 0.55, raiseR: 0.55, eyeOpen: 1.05 },
  play: { reach: 0.75, lean: 0.12, raiseR: 0.25, eyeOpen: 1.1, hop: 0.25 },
  chat: { sway: 0.8 },
  swing: { lean: -0.32, eyeOpen: 0.45, raiseL: 1.05, raiseR: 1.05, sway: 0.3 },
  sun: { lean: -0.38, eyeOpen: 0.06, raiseL: 1.15, raiseR: 1.15 },
  ponder: { lean: -0.12, raiseR: 0.75, eyeUp: 1, sway: 0.6 },
  move: { lean: 0.24, reach: 0.95, raiseR: 0.15, eyeUp: -0.5 },
  talk: { sway: 1, lean: 0.04 },
  listen: { sway: 0.3, lean: -0.04, eyeOpen: 1.05 },
  ready: { sway: 0.6, scan: 0.8, hop: 0.12 },
};

/** Where each held prop sits in the right claw, in the arm's own space. */
const GRIP: Partial<Record<AssetName, { at: [number, number, number]; rot?: [number, number, number]; scale?: number }>> = {
  Mug: { at: [0.11, -0.035, 0.05], scale: 1.15 },
  HeldBook: { at: [0.09, 0.0, 0.09], rot: [-0.25, 0.5, 0] },
  Paddle: { at: [0.12, -0.03, 0.04], rot: [0.35, 0, -0.35] },
  BeachPaddle: { at: [0.12, -0.03, 0.04], rot: [0.35, 0, -0.35] },
  FishingRod: { at: [0.11, -0.03, 0.05], rot: [1.0, 0, -0.2] },
  WateringCan: { at: [0.12, -0.11, 0.06], scale: 0.85 },
};

/** One Clawd: the Blender model plus procedural animation of its parts. */
export class Clawd {
  readonly root = new THREE.Group();
  activity: Activity = "idle";
  /** Walk cycle speed in world units per second; zero stands still. */
  walkSpeed = 0;
  /** When false the desk poses are replaced by a neutral standing pose. */
  atDesk = true;
  /** What it is up to away from the desk, once it has stopped walking. */
  doing: Doing | null = null;

  private rig: THREE.Object3D;
  private body: THREE.Object3D;
  private bodyY: number;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private eyes: THREE.Object3D[];
  private eyeBase: THREE.Vector3[];
  private legs: THREE.Object3D[];
  private pose: Pose = { ...REST };
  private walkW = 0;
  private walkPhase = 0;
  private cheerW = 0;
  private shakeW = 0;
  private swatW = 0;
  private held: THREE.Object3D | null = null;
  private hat: THREE.Object3D | null = null;
  private nextBlink = 1 + Math.random() * 3;
  private blinkUntil = 0;
  private readonly seed = Math.random() * 100;

  constructor(kit: Kit, scale: number) {
    this.rig = kit.make("Clawd");
    this.rig.scale.setScalar(scale);
    this.root.add(this.rig);
    this.body = part(this.rig, "Clawd_Body");
    this.bodyY = this.body.position.y;
    this.armL = part(this.rig, "Clawd_ArmL");
    this.armR = part(this.rig, "Clawd_ArmR");
    this.eyes = [part(this.rig, "Clawd_EyeL"), part(this.rig, "Clawd_EyeR")];
    this.eyeBase = this.eyes.map((e) => e.position.clone());
    this.legs = ["FL", "FR", "BL", "BR"].map((n) => part(this.rig, `Clawd_Leg${n}`));
  }

  /** Arms up for a moment, used when a turn finishes. */
  cheer() {
    this.cheerW = 1;
  }

  /** A startled shake, used when a tool call fails. */
  flinch() {
    this.shakeW = 1;
  }

  /** A quick swing of the right claw, to return a ball. */
  swat() {
    this.swatW = 1;
  }

  /** Puts something in the right claw, or empties it. */
  hold(kit: Kit, asset: AssetName | null) {
    if (this.held?.userData.asset === asset) return;
    if (this.held) this.armR.remove(this.held);
    this.held = null;
    const grip = asset && GRIP[asset];
    if (!asset || !grip || !kit.has(asset)) return;
    const prop = kit.make(asset);
    prop.userData.asset = asset;
    prop.position.set(...grip.at);
    if (grip.rot) prop.rotation.set(...grip.rot);
    prop.scale.setScalar(grip.scale ?? 1);
    this.armR.add(prop);
    this.held = prop;
  }

  /** Puts a hat on the Clawd's head (or sunglasses on its face), replacing any other. */
  wear(hat: THREE.Object3D | null) {
    if (this.hat) this.body.remove(this.hat);
    this.hat = hat;
    if (!hat) return;
    if (hat.name === "Hat_Sunglasses") hat.position.set(0, 0.245, 0.225);
    else hat.position.y = 0.385;
    this.body.add(hat);
  }

  update(t: number, dt: number) {
    const still0 = this.walkSpeed <= 0.01;
    const doing = !this.atDesk && still0 ? this.doing : null;
    const target: Pose = { ...REST, ...(this.atDesk ? POSES[this.activity] : DOINGS[doing ?? "stand"]) };
    const ts = t + this.seed;

    // Terminal work comes in bursts: type a command, then watch it run.
    if (this.atDesk && this.activity === "terminal" && Math.sin(ts * 1.4) < -0.25) {
      target.type = 0;
      target.scan = 0.6;
    }
    // Hangouts have their own little rhythms.
    const beat = (period: number, length: number) => ts % period < length;
    if (doing === "sip" && beat(6, 1.3)) {
      target.raiseR = 1.15;
      target.reach = 0.95;
      target.eyeOpen = 0.12;
      target.lean = -0.08;
    } else if (doing === "browse" && beat(7, 1.4)) {
      target.raiseR = 0.85;
      target.reach = 0.7;
    } else if (doing === "water") {
      target.raiseR = 0.3 + Math.max(0, Math.sin(ts * 1.1)) * 0.5;
    } else if (doing === "fish" && beat(9, 0.5)) {
      target.raiseR = 1.2;
      target.eyeOpen = 1.2;
    } else if (doing === "talk") {
      target.raiseR = 0.45 + Math.sin(ts * 3.1) * 0.4;
      target.raiseL = 0.3 + Math.sin(ts * 2.3 + 1) * 0.3;
    } else if (doing === "listen") {
      target.lean = Math.sin(ts * 4) * 0.06;
    } else if (doing === "chat") {
      // A chat partner waiting for someone to talk to looks about.
      target.scan = 0.8;
    }

    const p = this.pose;
    for (const key of Object.keys(p) as (keyof Pose)[]) p[key] = damp(p[key], target[key], 9, dt);

    const walking = this.walkSpeed > 0.01;
    this.walkW = damp(this.walkW, walking ? 1 : 0, 12, dt);
    this.walkPhase += dt * (4 + this.walkSpeed * 4.5);
    this.cheerW = Math.max(0, this.cheerW - dt / 1.4);
    this.shakeW = Math.max(0, this.shakeW - dt / 0.6);
    this.swatW = Math.max(0, this.swatW - dt / 0.35);
    const still = 1 - this.walkW;

    const hop = Math.abs(Math.sin(ts * 6.5)) * p.hop * still;
    const stride = Math.sin(this.walkPhase);
    // In zero gravity a resting Clawd drifts a little above its seat.
    const drift = doing === "float" ? 0.1 + Math.sin(ts * 1.2) * 0.07 : 0;
    this.rig.position.y = hop * 0.16 + Math.abs(stride) * 0.04 * this.walkW + drift;

    // Breathing and landing squash both act on the body, which pivots at its base.
    const slow = this.activity === "sleeping" || doing === "nap" || doing === "sun";
    const breathe = Math.sin(ts * (slow ? 1.3 : 2.4)) * 0.018;
    const squash = 1 + breathe - (p.hop > 0.2 && hop < 0.25 * p.hop ? 0.07 : 0);
    // Leaning forward lifts the back of the base, so sink the body to keep it on its back legs.
    this.body.position.y = this.bodyY - Math.max(0, p.lean * still) * 0.09;
    this.body.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);
    this.body.rotation.set(
      p.lean * still + Math.sin(ts * 15) * 0.012 * p.type,
      p.turn + Math.sin(ts * 0.6) * 0.35 * p.sway * still * (this.activity === "delegating" ? 1.4 : 0.5),
      Math.sin(ts * 1.1) * 0.05 * p.sway * still +
        stride * 0.07 * this.walkW +
        Math.sin(t * 46) * 0.13 * this.shakeW +
        (doing === "float" ? Math.sin(ts * 0.7) * 0.12 : 0),
    );

    const reach = p.reach * still * 1.3;
    const typeL = Math.sin(ts * 17) * 0.3 * p.type * still;
    const typeR = Math.sin(ts * 17 + 2.1) * 0.3 * p.type * still;
    const wave = Math.sin(ts * 11) * 0.45 * p.wave;
    const cheer = Math.sin(Math.min(1, this.cheerW * 2) * Math.PI * 0.5) * 1.2;
    const swing = stride * 0.5 * this.walkW;
    const swat = Math.sin(this.swatW * Math.PI);
    this.armL.rotation.set(0, reach + swing, -(p.raiseL * still + wave + cheer + Math.max(0, typeL)));
    this.armR.rotation.set(0, -reach + swing - swat * 0.9, p.raiseR * still + cheer + Math.max(0, typeR) + swat * 0.5);

    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.13;
      this.nextBlink = t + 1.8 + Math.random() * 4;
    }
    const open = t < this.blinkUntil ? 0.1 : p.eyeOpen;
    const scan = Math.sin(ts * 2.6) * 0.018 * p.scan;
    this.eyes.forEach((eye, i) => {
      const base = this.eyeBase[i]!;
      // One eye shut to look through a telescope.
      eye.scale.y = damp(eye.scale.y, doing === "scope" && i === 0 ? 0.1 : open, 30, dt);
      eye.position.set(base.x + scan, base.y + p.eyeUp * 0.022, base.z);
    });

    const legSwing = stride * 0.7 * this.walkW;
    this.legs[0]!.rotation.x = legSwing;
    this.legs[3]!.rotation.x = legSwing;
    this.legs[1]!.rotation.x = -legSwing;
    this.legs[2]!.rotation.x = -legSwing;

    // A prop is only held at the spot it belongs to; walking there, it is tucked away.
    if (this.held) this.held.visible = still > 0.5 && !this.atDesk;
  }
}

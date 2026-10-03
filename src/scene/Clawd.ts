import * as THREE from "three/webgpu";
import type { Activity } from "../../shared/types.ts";
import { damp, type Kit, part } from "./kit.ts";

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

/** One Clawd: the Blender model plus procedural animation of its parts. */
export class Clawd {
  readonly root = new THREE.Group();
  activity: Activity = "idle";
  /** Walk cycle speed in world units per second; zero stands still. */
  walkSpeed = 0;
  /** When false the desk poses are replaced by a neutral standing pose. */
  atDesk = true;

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

  update(t: number, dt: number) {
    const target: Pose = { ...REST, ...(this.atDesk ? POSES[this.activity] : { sway: 0.6 }) };
    const ts = t + this.seed;

    // Terminal work comes in bursts: type a command, then watch it run.
    if (this.atDesk && this.activity === "terminal" && Math.sin(ts * 1.4) < -0.25) {
      target.type = 0;
      target.scan = 0.6;
    }

    const p = this.pose;
    for (const key of Object.keys(p) as (keyof Pose)[]) p[key] = damp(p[key], target[key], 9, dt);

    const walking = this.walkSpeed > 0.01;
    this.walkW = damp(this.walkW, walking ? 1 : 0, 12, dt);
    this.walkPhase += dt * (4 + this.walkSpeed * 4.5);
    this.cheerW = Math.max(0, this.cheerW - dt / 1.4);
    this.shakeW = Math.max(0, this.shakeW - dt / 0.6);
    const still = 1 - this.walkW;

    const hop = Math.abs(Math.sin(ts * 6.5)) * p.hop * still;
    const stride = Math.sin(this.walkPhase);
    this.rig.position.y = hop * 0.16 + Math.abs(stride) * 0.04 * this.walkW;

    // Breathing and landing squash both act on the body, which pivots at its base.
    const breathe = Math.sin(ts * (this.activity === "sleeping" ? 1.3 : 2.4)) * 0.018;
    const squash = 1 + breathe - (p.hop > 0.2 && hop < 0.25 * p.hop ? 0.07 : 0);
    // Leaning forward lifts the back of the base, so sink the body to keep it on its back legs.
    this.body.position.y = this.bodyY - Math.max(0, p.lean * still) * 0.09;
    this.body.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);
    this.body.rotation.set(
      p.lean * still + Math.sin(ts * 15) * 0.012 * p.type,
      p.turn + Math.sin(ts * 0.6) * 0.35 * p.sway * still * (this.activity === "delegating" ? 1.4 : 0.5),
      Math.sin(ts * 1.1) * 0.05 * p.sway * still + stride * 0.07 * this.walkW + Math.sin(t * 46) * 0.13 * this.shakeW,
    );

    const reach = p.reach * still * 1.3;
    const typeL = Math.sin(ts * 17) * 0.3 * p.type * still;
    const typeR = Math.sin(ts * 17 + 2.1) * 0.3 * p.type * still;
    const wave = Math.sin(ts * 11) * 0.45 * p.wave;
    const cheer = Math.sin(Math.min(1, this.cheerW * 2) * Math.PI * 0.5) * 1.2;
    const swing = stride * 0.5 * this.walkW;
    this.armL.rotation.set(0, reach + swing, -(p.raiseL * still + wave + cheer + Math.max(0, typeL)));
    this.armR.rotation.set(0, -reach + swing, p.raiseR * still + cheer + Math.max(0, typeR));

    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.13;
      this.nextBlink = t + 1.8 + Math.random() * 4;
    }
    const open = t < this.blinkUntil ? 0.1 : p.eyeOpen;
    const scan = Math.sin(ts * 2.6) * 0.018 * p.scan;
    this.eyes.forEach((eye, i) => {
      const base = this.eyeBase[i]!;
      eye.scale.y = damp(eye.scale.y, open, 30, dt);
      eye.position.set(base.x + scan, base.y + p.eyeUp * 0.022, base.z);
    });

    const legSwing = stride * 0.7 * this.walkW;
    this.legs[0]!.rotation.x = legSwing;
    this.legs[3]!.rotation.x = legSwing;
    this.legs[1]!.rotation.x = -legSwing;
    this.legs[2]!.rotation.x = -legSwing;
  }
}

import * as THREE from "three/webgpu";
import { type AssetName, damp, type Kit, parts } from "./kit.ts";
import type { PetHome } from "./layout.ts";
import type { PetKind } from "./themes.ts";

// The office pet: it naps at home, potters along the shared strip, sniffs
// around the hangouts and goes to sit with Clawds who are on a break. Click
// it and it hops.

interface Gait {
  speed: number;
  /** Seconds it stays put, at home and elsewhere. */
  rest: [number, number];
  linger: [number, number];
  /** Flies at this height instead of walking. */
  hover?: number;
  /** Walks sideways, like a crab. */
  sideways?: boolean;
  scale: number;
}

const GAITS: Record<PetKind, Gait> = {
  vacuum: { speed: 0.55, rest: [14, 30], linger: [4, 9], scale: 1.25 },
  tortoise: { speed: 0.16, rest: [20, 45], linger: [8, 16], scale: 1.55 },
  cat: { speed: 0.8, rest: [18, 45], linger: [6, 14], scale: 1.4 },
  drone: { speed: 0.9, rest: [10, 22], linger: [4, 9], hover: 1.35, scale: 1.3 },
  crab: { speed: 0.5, rest: [10, 25], linger: [4, 10], sideways: true, scale: 1.5 },
};

export interface PetWorld {
  width: number;
  /** Z of the lane it travels along between places. */
  lane: number;
  home: PetHome;
  /** Clawds out on a break, which the pet may go and sit with. */
  friends: THREE.Vector3[];
  /** Hangouts worth a sniff. */
  sights: THREE.Vector3[];
}

type Goal = "home" | "friend" | "sight" | "lane";

export class Pet {
  readonly root = new THREE.Group();
  readonly kind: PetKind;
  readonly name: string;
  /** Set when it arrives next to a friend, for the office to show a heart. */
  greeted: THREE.Vector3 | null = null;

  private gait: Gait;
  private model: THREE.Object3D;
  private legs: THREE.Object3D[];
  private head: THREE.Object3D | null;
  private tail: THREE.Object3D | null;
  private claws: THREE.Object3D[];
  private rotors: THREE.Object3D[];
  private glow: THREE.MeshStandardMaterial | null = null;
  private path: THREE.Vector3[] = [];
  private goal: Goal = "home";
  private until = 0;
  private heading = 0;
  private facing = 0;
  private phase = 0;
  private moving = 0;
  private hopW = 0;
  private lieW = 0;
  private placed = false;
  private arrivalFacing: number | null = null;

  constructor(kit: Kit, kind: PetKind, asset: AssetName, name: string) {
    this.kind = kind;
    this.name = name;
    this.gait = GAITS[kind];
    this.model = kit.make(asset);
    this.model.scale.setScalar(this.gait.scale);
    this.root.add(this.model);
    this.root.userData.pet = true;
    const prefix = asset;
    // Legs in the order front-left, front-right, back-left, back-right; a crab's left side then its right.
    const fours = ["FL", "FR", "BL", "BR"].map((n) => this.model.getObjectByName(`${prefix}_Leg${n}`));
    this.legs = fours.every((o) => o !== undefined)
      ? fours
      : parts(this.model, `${prefix}_Leg`).filter((o) => /_Leg[LR]\d$/.test(o.name));
    this.head = this.model.getObjectByName(`${prefix}_Head`) ?? null;
    this.tail = this.model.getObjectByName(`${prefix}_Tail`) ?? null;
    this.claws = [`${prefix}_ClawL`, `${prefix}_ClawR`].map((n) => this.model.getObjectByName(n)).filter((o) => o !== undefined);
    this.rotors = parts(this.model, `${prefix}_Rotor`).filter((o) => /_Rotor\d$/.test(o.name));
    const light = this.model.getObjectByName("RobotVacuum_Light") ?? this.model.getObjectByName("Drone_Eye");
    if (light instanceof THREE.Mesh && light.material instanceof THREE.MeshStandardMaterial) {
      // Its own copy, so the glow can pulse without touching anything else.
      this.glow = light.material.clone();
      light.material = this.glow;
    }
  }

  /** A pat: it hops and turns to look at you. */
  pat() {
    this.hopW = 1;
    this.lieW = 0;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  update(t: number, dt: number, world: PetWorld) {
    const g = this.gait;
    const pos = this.root.position;
    if (!this.placed) {
      pos.set(world.home.x, g.hover ?? 0, world.home.z);
      this.heading = this.facing = world.home.facing;
      this.until = t + 3 + Math.random() * 6;
      this.placed = true;
    }

    if (this.path.length === 0 && t > this.until) this.decide(t, world);

    // Walk the path at its own pace.
    let moved = 0;
    let budget = g.speed * dt;
    while (budget > 0 && this.path.length > 0) {
      const next = this.path[0]!;
      const dx = next.x - pos.x;
      const dz = next.z - pos.z;
      const flat = Math.hypot(dx, dz);
      if (flat <= budget) {
        pos.x = next.x;
        pos.z = next.z;
        budget -= flat;
        moved += flat;
        this.path.shift();
      } else {
        pos.x += (dx / flat) * budget;
        pos.z += (dz / flat) * budget;
        moved += budget;
        this.facing = Math.atan2(dx, dz);
        budget = 0;
      }
      if (this.path.length === 0) this.arrive(t, world);
    }
    const walking = moved > 0;
    this.moving = damp(this.moving, walking ? 1 : 0, 10, dt);
    if (walking) this.phase += dt * (this.kind === "tortoise" ? 5 : 12);

    // A crab keeps its face to the room and scuttles sideways.
    const want = g.sideways && walking ? this.facing - (Math.PI / 2) * (Math.sign(Math.sin(this.facing)) || 1) : this.facing;
    this.heading = dampAngle(this.heading, want, this.kind === "tortoise" ? 3 : 8, dt);
    this.root.rotation.y = this.heading;

    this.hopW = Math.max(0, this.hopW - dt / 0.7);
    const hop = Math.sin(this.hopW * Math.PI) * (this.kind === "drone" ? 0.25 : 0.16);
    const lying = this.kind === "cat" && this.goal === "home" && !walking && this.hopW === 0;
    this.lieW = damp(this.lieW, lying ? 1 : 0, 3, dt);
    const base = g.hover !== undefined ? g.hover + Math.sin(t * 2.1) * 0.05 : 0;
    pos.y = base + hop;

    this.animate(t, dt);
  }

  private decide(t: number, world: PetWorld) {
    const roll = Math.random();
    let goal: Goal;
    if (world.friends.length > 0 && roll < 0.45) goal = "friend";
    else if (roll < 0.75 && world.sights.length > 0) goal = "sight";
    else if (this.goal !== "home" && roll < 0.92) goal = "home";
    else goal = "lane";

    let to: THREE.Vector3;
    let face: number | null = null;
    if (goal === "friend") {
      const friend = world.friends[Math.floor(Math.random() * world.friends.length)]!;
      // Sit just in front of them, looking up.
      to = new THREE.Vector3(friend.x + (Math.random() - 0.5) * 0.4, 0, Math.min(world.lane, friend.z + 0.6));
      face = Math.atan2(friend.x - to.x, friend.z - to.z);
    } else if (goal === "sight") {
      const sight = world.sights[Math.floor(Math.random() * world.sights.length)]!;
      to = new THREE.Vector3(sight.x + (Math.random() - 0.5) * 0.6, 0, Math.min(world.lane, sight.z + 0.5));
    } else if (goal === "home") {
      to = new THREE.Vector3(world.home.x, 0, world.home.z);
      face = world.home.facing;
    } else {
      to = new THREE.Vector3(1.5 + Math.random() * (world.width - 3), 0, world.lane);
    }
    this.goal = goal;
    this.path = this.route(this.root.position, to, world.lane);
    this.arrivalFacing = face;
    if (this.path.length === 0) this.arrive(t, world);
  }

  private arrive(t: number, world: PetWorld) {
    const [lo, hi] = this.goal === "home" ? this.gait.rest : this.gait.linger;
    this.until = t + lo + Math.random() * (hi - lo);
    if (this.arrivalFacing !== null) this.facing = this.arrivalFacing;
    if (this.goal === "friend") this.greeted = this.root.position.clone();
    if (this.goal === "home") this.facing = world.home.facing;
  }

  /** Out to the lane, along it, and in: the same way the Clawds keep out of the furniture. */
  private route(from: THREE.Vector3, to: THREE.Vector3, lane: number): THREE.Vector3[] {
    if (this.gait.hover !== undefined) return [to.clone()];
    const path: THREE.Vector3[] = [];
    if (Math.abs(from.z - lane) > 0.05) path.push(new THREE.Vector3(from.x, 0, lane));
    if (Math.abs(from.x - to.x) > 0.05) path.push(new THREE.Vector3(to.x, 0, lane));
    path.push(to.clone());
    return path;
  }

  private animate(t: number, dt: number) {
    const m = this.moving;
    switch (this.kind) {
      case "vacuum": {
        // Bumps along, and spins on the spot while it cleans.
        if (!m && this.goal !== "home" && this.path.length === 0) this.heading += dt * 1.6;
        this.model.rotation.z = Math.sin(t * 9) * 0.015 * m;
        if (this.glow) this.glow.emissiveIntensity = this.goal === "home" ? 0.6 + Math.sin(t * 2) * 0.5 : 1.6;
        break;
      }
      case "tortoise": {
        this.legs.forEach((leg, i) => (leg.rotation.x = Math.sin(this.phase + (i % 3 === 0 ? 0 : Math.PI)) * 0.45 * m));
        if (this.head) {
          this.head.rotation.x = Math.sin(t * 0.8) * 0.12 + (1 - m) * 0.1;
          this.head.rotation.y = Math.sin(t * 0.37) * 0.3 * (1 - m);
        }
        break;
      }
      case "cat": {
        this.legs.forEach((leg, i) => {
          const walk = Math.sin(this.phase + (i % 3 === 0 ? 0 : Math.PI)) * 0.6 * m;
          // Front legs tuck forward and back legs back when it loafs.
          const tuck = (i < 2 ? -1.3 : 1.3) * this.lieW;
          leg.rotation.x = walk + tuck;
        });
        this.model.position.y = -0.07 * this.lieW;
        if (this.tail) {
          this.tail.rotation.z = Math.sin(t * (m ? 6 : 1.6)) * (m ? 0.25 : 0.45);
          this.tail.rotation.x = -0.3 * this.lieW;
        }
        if (this.head) this.head.rotation.y = Math.sin(t * 0.5) * 0.5 * (1 - m) * (1 - this.lieW);
        break;
      }
      case "drone": {
        for (const r of this.rotors) r.rotation.y += dt * 40;
        this.model.rotation.x = 0.18 * m;
        this.model.rotation.z = Math.sin(t * 1.3) * 0.05;
        if (this.glow) this.glow.emissiveIntensity = Math.sin(t * 0.9) > 0.97 ? 0.1 : 2.2;
        break;
      }
      case "crab": {
        this.legs.forEach((leg, i) => (leg.rotation.z = Math.sin(this.phase * 1.4 + i * 1.3) * 0.35 * m));
        this.claws.forEach((claw, i) => {
          const wave = this.hopW > 0 ? 0.6 : 0;
          claw.rotation.x = -wave - Math.max(0, Math.sin(t * 3 + i * 2)) * 0.25 * (1 - m);
        });
        break;
      }
    }
  }

  dispose() {
    this.glow?.dispose();
  }
}

function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

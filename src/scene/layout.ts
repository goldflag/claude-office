import type { AgentSnapshot } from "../../shared/types.ts";

// The room's origin is its back-left corner. X runs right, Z runs toward the
// camera. The shared area is a strip along the back wall; project pods sit in
// front of it.

export const CELL_W = 2.1;
export const CELL_D = 2.7;
/** Desk center within a cell, measured from the cell's back edge. */
export const DESK_Z = 1.5;
export const SEAT_X = -0.15;
export const SEAT_Y = 0.48;
export const SEAT_Z = -0.52;
export const AISLE_Z = -1.15;
/** Z of the walkway that runs along the front of the shared area. */
export const WALK_Z = 2.9;
// The door is in the left wall at the end of the walkway.
export const DOOR_INSIDE_X = 0.8;
export const DOOR_OUTSIDE_X = -0.1;
const PODS_Z = 3.7;
const SIDE_PAD = 1.3;
const COLUMN_GAP = 1.4;
const POD_GAP = 1.1;
const MIN_WIDTH = 15;
const FRONT_PAD = 1.3;
/** Width to depth ratio the room aims for. */
const TARGET_ASPECT = 1.75;

export const POD_COLORS = ["#7DB8AE", "#E8C66C", "#B59AC9", "#8DB6DE", "#EEA9B8", "#A2CC8E", "#F0B88A", "#9AA8D8"];

export interface Cell {
  /** Desk center in room coordinates. */
  x: number;
  z: number;
  /** X of the corridor this desk uses to reach the shared area. */
  corridorX: number;
}

export interface Pod {
  project: string;
  color: string;
  x: number;
  z: number;
  w: number;
  d: number;
  count: number;
}

export interface Spot {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Heading in radians; 0 faces the camera side (+Z). */
  facing: number;
}

export interface Furniture {
  asset: "PlantBig" | "Bookshelf" | "FilingCabinet" | "CoffeeBar" | "WaterCooler" | "Couch" | "CoffeeTable" | "Beanbag";
  x: number;
  z: number;
  rotation: number;
  scale: number;
}

export interface RoomLayout {
  width: number;
  depth: number;
  pods: Pod[];
  cells: Map<string, Cell>;
  spots: Spot[];
  furniture: Furniture[];
  /** Changes whenever anything that affects static room geometry changes. */
  key: string;
}

/**
 * One color per project, shared by the rugs and the roster. It depends on the
 * full set of projects, including ones with nobody in the office right now.
 */
export function projectColors(projects: Iterable<string>): Map<string, string> {
  const colors = new Map<string, string>();
  const taken = new Set<string>();
  for (const project of [...new Set(projects)].sort()) {
    let h = 0;
    for (let i = 0; i < project.length; i++) h = (h * 31 + project.charCodeAt(i)) >>> 0;
    let color = POD_COLORS[h % POD_COLORS.length]!;
    for (let i = 0; i < POD_COLORS.length; i++) {
      const candidate = POD_COLORS[(h + i) % POD_COLORS.length]!;
      if (!taken.has(candidate)) {
        color = candidate;
        break;
      }
    }
    taken.add(color);
    colors.set(project, color);
  }
  return colors;
}

interface PodGroup {
  project: string;
  members: AgentSnapshot[];
  cols: number;
  w: number;
  d: number;
}

function pack(groups: PodGroup[], colors: Map<string, string>, maxDepth: number) {
  const pods: Pod[] = [];
  const cells = new Map<string, Cell>();
  let colX = SIDE_PAD;
  let colW = 0;
  let colDepth = 0;
  let deepest = CELL_D;
  let column: { pod: Pod; group: PodGroup }[] = [];

  const commitColumn = () => {
    const corridorLeft = colX - COLUMN_GAP / 2;
    const corridorRight = colX + colW + COLUMN_GAP / 2;
    for (const { pod, group } of column) {
      group.members.forEach((agent, i) => {
        const x = pod.x + ((i % group.cols) + 0.5) * CELL_W;
        const z = pod.z + Math.floor(i / group.cols) * CELL_D + DESK_Z;
        cells.set(agent.id, { x, z, corridorX: x - corridorLeft <= corridorRight - x ? corridorLeft : corridorRight });
      });
    }
    column = [];
  };

  for (const group of groups) {
    if (colDepth > 0 && colDepth + POD_GAP + group.d > maxDepth + 1e-6) {
      commitColumn();
      colX += colW + COLUMN_GAP;
      colW = 0;
      colDepth = 0;
    }
    const z = PODS_Z + (colDepth > 0 ? colDepth + POD_GAP : 0);
    const pod: Pod = {
      project: group.project,
      color: colors.get(group.project) ?? POD_COLORS[0]!,
      x: colX,
      z,
      w: group.w,
      d: group.d,
      count: group.members.length,
    };
    pods.push(pod);
    column.push({ pod, group });
    colW = Math.max(colW, group.w);
    colDepth = z - PODS_Z + group.d;
    deepest = Math.max(deepest, colDepth);
  }
  commitColumn();

  const podsRight = colX + colW;
  const width = Math.max(MIN_WIDTH, podsRight + SIDE_PAD);
  // Narrow offices are centered rather than hugging the left wall.
  const shift = (width - (podsRight + SIDE_PAD)) / 2;
  if (shift > 0) {
    for (const pod of pods) pod.x += shift;
    for (const cell of cells.values()) {
      cell.x += shift;
      cell.corridorX += shift;
    }
  }
  return { pods, cells, width, depth: PODS_Z + deepest + FRONT_PAD };
}

/** Lays out desks for the agents who are in the office. */
export function computeLayout(agents: AgentSnapshot[], colors = projectColors(agents.map((a) => a.project))): RoomLayout {
  const byProject = new Map<string, AgentSnapshot[]>();
  for (const agent of agents) {
    const list = byProject.get(agent.project) ?? [];
    list.push(agent);
    byProject.set(agent.project, list);
  }

  const groups = [...byProject.entries()]
    .map(([project, members]) => {
      members.sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
      const cols = Math.ceil(Math.sqrt(members.length));
      const rows = Math.ceil(members.length / cols);
      return { project, members, cols, rows, w: cols * CELL_W, d: rows * CELL_D };
    })
    .sort((a, b) => b.members.length - a.members.length || a.project.localeCompare(b.project));

  // Pods fill columns front to back, so small projects stack beside big ones.
  // How deep a column may get is chosen for the best-proportioned room.
  const tallest = Math.max(CELL_D, ...groups.map((g) => g.d));
  let best: ReturnType<typeof pack> | null = null;
  let bestScore = Infinity;
  for (let extra = 0; extra <= 3; extra++) {
    const packed = pack(groups, colors, tallest + extra * (CELL_D + POD_GAP));
    const score = Math.abs(Math.log(packed.width / packed.depth / TARGET_ASPECT));
    if (score < bestScore - 1e-6) {
      best = packed;
      bestScore = score;
    }
  }
  const { pods, cells, width, depth } = best!;

  const kitchen = width / 2;
  const lounge = width - 3.6;
  const furniture: Furniture[] = [
    { asset: "PlantBig", x: 0.85, z: 0.75, rotation: 0.4, scale: 1 },
    { asset: "Bookshelf", x: 2.3, z: 0.32, rotation: 0, scale: 1 },
    { asset: "FilingCabinet", x: 3.5, z: 0.42, rotation: 0, scale: 1 },
    { asset: "FilingCabinet", x: 4.06, z: 0.42, rotation: 0, scale: 1 },
    { asset: "CoffeeBar", x: kitchen - 0.4, z: 0.45, rotation: 0, scale: 1 },
    { asset: "WaterCooler", x: kitchen + 0.95, z: 0.4, rotation: 0, scale: 1 },
    { asset: "Couch", x: lounge, z: 0.6, rotation: 0, scale: 1 },
    { asset: "CoffeeTable", x: lounge, z: 1.85, rotation: 0, scale: 0.8 },
    { asset: "Beanbag", x: lounge - 1.55, z: 1.75, rotation: 0.9, scale: 1 },
    { asset: "Beanbag", x: lounge + 1.6, z: 1.85, rotation: -1.0, scale: 1 },
    { asset: "PlantBig", x: width - 0.85, z: 0.8, rotation: 2.1, scale: 0.9 },
  ];

  const back = Math.PI;
  const spots: Spot[] = [
    { id: "coffee-a", x: kitchen - 0.78, y: 0, z: 1.2, facing: back },
    { id: "couch-a", x: lounge - 0.4, y: 0.46, z: 0.52, facing: 0 },
    { id: "books-a", x: 2.0, y: 0, z: 1.05, facing: back },
    { id: "bean-a", x: lounge - 1.55, y: 0.34, z: 1.72, facing: 0.9 },
    { id: "water", x: kitchen + 0.95, y: 0, z: 1.1, facing: back },
    { id: "couch-b", x: lounge + 0.4, y: 0.46, z: 0.52, facing: 0 },
    { id: "coffee-b", x: kitchen - 0.02, y: 0, z: 1.25, facing: back },
    { id: "bean-b", x: lounge + 1.6, y: 0.34, z: 1.82, facing: -1.0 },
    { id: "books-b", x: 2.75, y: 0, z: 1.1, facing: back },
    { id: "window", x: 0.85, y: 0, z: 1.5, facing: -Math.PI / 2 },
    { id: "files", x: 3.78, y: 0, z: 1.2, facing: back },
    { id: "chat-a", x: lounge - 0.75, y: 0, z: 2.35, facing: 0.7 },
    { id: "chat-b", x: lounge + 0.8, y: 0, z: 2.4, facing: -0.7 },
  ];

  const key = [width.toFixed(2), depth.toFixed(2), ...pods.map((p) => `${p.project}:${p.x}:${p.z}:${p.w}:${p.d}:${p.count}`)].join("|");
  return { width, depth, pods, cells, spots, furniture, key };
}

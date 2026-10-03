import type { AssetName } from "./kit.ts";
import type { Amenities, Furniture, Game, Spot, SpotPose } from "./layout.ts";
import type { WainscotStyle } from "./surfaces.ts";

// An office theme dresses the same room of desks differently: the floor and
// walls, the view out of the windows, the light, what stands in the shared
// strip along the back wall and what the Clawds do there, a resident pet,
// hats and desk trinkets. Pods, desks and walking routes are shared.

export type ThemeId = "studio" | "greenhouse" | "lodge" | "orbital" | "seaside";
export type FloorStyle = "check" | "terracotta" | "planks" | "deck" | "plating";
export type WallStyle = "plain" | "trellis" | "logs" | "shiplap" | "panels";
export type ViewId = "city" | "garden" | "snow" | "space" | "ocean";
export type PetKind = "vacuum" | "tortoise" | "cat" | "drone" | "crab";
export type AmbientKind = "butterflies" | "fireflies" | "embers" | "motes";
/** A desk ornament; "Figurine" is a tiny Clawd. */
export type Trinket = AssetName | "Figurine";

export interface Lighting {
  background: string;
  sky: string;
  ground: string;
  sun: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  blurb: string;
  /** Three colors for the theme picker's chip. */
  swatch: [string, string, string];
  day: Lighting;
  night: Lighting;
  floor: { style: FloorStyle; colors: string[]; seam: string };
  walls: {
    style: WallStyle;
    color: string;
    accent: string;
    wainscot: string;
    wainscotStyle: WainscotStyle;
    trim: string;
    /** The trim is a strip of light rather than painted wood. */
    glowTrim?: boolean;
  };
  /** Color of the floor slab's sides. */
  base: string;
  window: "Window" | "Porthole";
  view: ViewId;
  /** Hung on the back wall between windows. */
  wallDecor: AssetName[];
  pet: { kind: PetKind; name: string; asset: AssetName };
  hats: { assets: AssetName[]; colors?: string[] } | null;
  trinkets: Trinket[];
  ambient: AmbientKind[];
  amenities(width: number): Amenities;
}

const BACK = Math.PI;
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

const item = (asset: AssetName, x: number, z: number, rotation = 0, scale = 1, extra: Partial<Furniture> = {}): Furniture => ({
  asset,
  x,
  z,
  rotation,
  scale,
  ...extra,
});

const spot = (
  id: string,
  x: number,
  y: number,
  z: number,
  facing: number,
  pose: SpotPose,
  extra: Partial<Spot> = {},
): Spot => ({ id, x, y, z, facing, pose, ...extra });

/** Two players facing each other across x = `cx`, `gap` from it, for a game. */
function pair(id: string, cx: number, z: number, gap: number, y: number, pose: SpotPose, prop?: AssetName): [Spot, Spot] {
  return [spot(`${id}-a`, cx - gap, y, z, EAST, pose, { prop }), spot(`${id}-b`, cx + gap, y, z, WEST, pose, { prop })];
}

const lounge = (W: number, sofa: AssetName, bean: AssetName, bob: boolean): { furniture: Furniture[]; spots: Spot[] } => {
  const R = W - 3.6;
  return {
    furniture: [
      item(sofa, R, 0.6),
      item("CoffeeTable", R, 1.85, 0, 0.8),
      item(bean, R - 1.55, 1.75, 0.9, 1, { bob }),
      item(bean, R + 1.6, 1.85, -1.0, 1, { bob }),
    ],
    spots: [
      spot("couch-a", R - 0.4, 0.46, 0.52, 0, "read", { prop: "HeldBook" }),
      spot("couch-b", R + 0.4, 0.46, 0.52, 0, "nap"),
      spot("bean-a", R - 1.55, 0.34, 1.72, 0.9, bob ? "float" : "nap"),
      spot("bean-b", R + 1.6, 0.34, 1.82, -1.0, bob ? "float" : "read", bob ? {} : { prop: "HeldBook" }),
      spot("chat-a", R - 0.75, 0, 2.35, 0.7, "chat"),
      spot("chat-b", R + 0.8, 0, 2.4, -0.7, "chat"),
    ],
  };
};

const chat: Game = { id: "chat", a: "chat-a", b: "chat-b", kind: "turns" };

// ------------------------------------------------------------------ studio

const studio: Theme = {
  id: "studio",
  name: "Studio",
  blurb: "The original: coffee bar, couch, and a ping-pong table that is never free.",
  swatch: ["#B4CDE9", "#7FA3B0", "#D97757"],
  day: { background: "#B4CDE9", sky: "#FFFFFF", ground: "#C9C2B6", sun: "#FFF1DA" },
  night: { background: "#2A3158", sky: "#C2C8F2", ground: "#6B6072", sun: "#FFDDB0" },
  floor: { style: "check", colors: ["#DCE3E9", "#CFD8E0"], seam: "#CFD8E0" },
  walls: { style: "plain", color: "#F5F1E9", accent: "#F5F1E9", wainscot: "#7FA3B0", wainscotStyle: "plain", trim: "#F5F1E9" },
  base: "#F1ECE3",
  window: "Window",
  view: "city",
  wallDecor: [],
  pet: { kind: "vacuum", name: "Dusty", asset: "RobotVacuum" },
  hats: null,
  trinkets: ["PlantSmall", "RubberDuck", "PhotoFrame", "BookStack", "Figurine"],
  ambient: [],
  amenities(W) {
    const C = W / 2;
    const cabinets = W >= 17.5;
    const room = lounge(W, "Couch", "Beanbag", false);
    const pong = pair("pong", 4.6, 1.45, 0.95, 0, "play", "Paddle");
    return {
      furniture: [
        item("PlantBig", 0.85, 0.75, 0.4),
        item("VacuumDock", 1.38, 0.09),
        item("Bookshelf", 2.3, 0.32),
        item("PingPongTable", 4.6, 1.45, 0, 0.8),
        item("CoffeeBar", C - 0.4, 0.45),
        item("WaterCooler", C + 0.95, 0.4),
        ...(cabinets ? [item("FilingCabinet", C + 1.75, 0.42), item("FilingCabinet", C + 2.31, 0.42)] : []),
        ...room.furniture,
        item("PlantBig", W - 0.85, 0.8, 2.1, 0.9),
      ],
      spots: [
        spot("coffee-a", C - 0.78, 0, 1.2, BACK, "sip", { prop: "Mug" }),
        ...pong,
        spot("books-a", 2.0, 0, 1.05, BACK, "browse"),
        spot("water", C + 0.95, 0, 1.1, BACK, "sip", { prop: "Mug" }),
        spot("coffee-b", C - 0.02, 0, 1.25, BACK, "sip", { prop: "Mug" }),
        spot("books-b", 2.7, 0, 1.1, BACK, "read", { prop: "HeldBook" }),
        spot("window", 0.85, 0, 1.5, WEST, "gaze"),
        ...(cabinets ? [spot("files", C + 2.03, 0, 1.15, BACK, "browse")] : []),
        ...room.spots,
      ],
      games: [{ id: "pong", a: "pong-a", b: "pong-b", kind: "pong", rest: { x: 4.6, y: 0.43, z: 1.45 }, hitY: 0.62, ball: "#FFFFFF" }, chat],
      rugs: [{ shape: "circle", x: W - 3.6, z: 1.55, w: 3.5, d: 3.5, color: "#F0DCC0" }],
      pet: { x: 1.38, z: 0.38, facing: BACK },
      wallBlocks: [],
      clockX: C + 0.2,
    };
  },
};

// -------------------------------------------------------------- greenhouse

const greenhouse: Theme = {
  id: "greenhouse",
  name: "Greenhouse",
  blurb: "A glasshouse with a koi pond, a hammock and tea for two. Butterflies by day, fireflies at night.",
  swatch: ["#CFE6D2", "#7E9C5B", "#C8734F"],
  day: { background: "#C8E6D3", sky: "#FFFFFF", ground: "#C7C6A2", sun: "#FFF4D6" },
  night: { background: "#1D3536", sky: "#B9D9CB", ground: "#4F5E4A", sun: "#E8DFB2" },
  floor: { style: "terracotta", colors: ["#D88A64", "#CF7F5A", "#E09A73"], seam: "#EADBC9" },
  walls: { style: "trellis", color: "#E3EEDB", accent: "#FFFFFF", wainscot: "#C27A57", wainscotStyle: "brick", trim: "#F7F4EC" },
  base: "#EFE4D6",
  window: "Window",
  view: "garden",
  wallDecor: ["HangingPlant"],
  pet: { kind: "tortoise", name: "Sheldon", asset: "Tortoise" },
  hats: { assets: ["Hat_Sprout"] },
  trinkets: ["PlantSmall", "Cactus", "Succulent", "Succulent"],
  ambient: ["butterflies", "fireflies"],
  amenities(W) {
    const C = W / 2;
    const tea = pair("tea", 5.0, 1.4, 0.55, 0.3, "sip", "Mug");
    const toPond = Math.atan2(1.25, -0.3);
    return {
      furniture: [
        item("FigTree", 0.95, 0.7, 0.3),
        item("PottingBench", 2.65, 0.3),
        item("WateringCan", 3.55, 0.35, -0.5, 1.4),
        item("PlantBig", 5.0, 0.45, 1.2),
        item("TeaTable", 5.0, 1.4),
        item("Stool", 4.45, 1.4),
        item("Stool", 5.55, 1.4, 1.1),
        item("PlantSmall", C - 1.5, 0.4, 0, 2.6),
        item("KoiPond", C, 1.3),
        item("PlantSmall", C + 1.35, 0.35, 1, 3),
        item("GardenBench", C + 2.3, 0.32),
        item("Hammock", W - 3.5, 0.8),
        item("PlantBig", W - 0.85, 0.75, 2.1, 1.05),
      ],
      spots: [
        spot("potting", 2.65, 0, 1.0, BACK, "water", { prop: "WateringCan" }),
        ...tea,
        spot("pond-a", C - 1.25, 0, 1.6, toPond, "fish", { prop: "FishingRod" }),
        spot("pond-b", C + 1.25, 0, 1.6, -toPond, "gaze"),
        spot("bench-a", C + 2.0, 0.4, 0.42, 0, "chat"),
        spot("bench-b", C + 2.6, 0.4, 0.42, 0, "chat"),
        spot("hammock", W - 3.4, 0.42, 0.8, 0, "swing"),
        spot("window", 0.85, 0, 1.6, WEST, "gaze"),
      ],
      games: [
        { id: "tea", a: "tea-a", b: "tea-b", kind: "turns" },
        { id: "bench", a: "bench-a", b: "bench-b", kind: "turns" },
      ],
      rugs: [{ shape: "circle", x: 5.0, z: 1.4, w: 2.0, d: 2.0, color: "#C9DDB4" }],
      pet: { x: C, z: 2.45, facing: BACK },
      wallBlocks: [],
      clockX: C,
    };
  },
};

// ------------------------------------------------------------------- lodge

const lodge: Theme = {
  id: "lodge",
  name: "Ski Lodge",
  blurb: "Log walls, a crackling fire, chess by the hearth and cocoa on tap. Snow outside, a cat inside.",
  swatch: ["#C8935E", "#B8433A", "#F4F6F8"],
  day: { background: "#D3E1EC", sky: "#FFFFFF", ground: "#C6B6A2", sun: "#FFF0DA" },
  night: { background: "#191F3C", sky: "#BBC2EC", ground: "#6E5852", sun: "#FFCF9A" },
  floor: { style: "planks", colors: ["#C99561", "#BE8955", "#D3A06C", "#C48F5B"], seam: "#8E6238" },
  walls: { style: "logs", color: "#C98F57", accent: "#A6713D", wainscot: "#9C968E", wainscotStyle: "stone", trim: "#6E4A2C" },
  base: "#8A6A4A",
  window: "Window",
  view: "snow",
  wallDecor: ["Wreath"],
  pet: { kind: "cat", name: "Biscuit", asset: "Cat" },
  hats: { assets: ["Hat_Beanie"], colors: ["#D2584F", "#E5B94E", "#6FA8A0", "#8E6C9E", "#4F9160", "#5C7FB8", "#F4F6F8"] },
  trinkets: ["MiniPine", "Candle", "Candle", "BookStack", "PlantSmall"],
  ambient: ["embers"],
  amenities(W) {
    const C = W / 2;
    const chess = pair("chess", 4.65, 1.45, 0.55, 0.32, "sit");
    return {
      furniture: [
        item("SkiRack", 1.9, 0.16),
        item("Firewood", 3.05, 0.3),
        item("ChessTable", 4.65, 1.45),
        item("LogStool", 4.1, 1.45),
        item("LogStool", 5.2, 1.45, 1.3),
        item("Fireplace", C, 0.3),
        item("Armchair", C - 1.35, 1.5, 2.2),
        item("Armchair", C + 1.35, 1.5, -2.2),
        item("CatBed", C, 1.3),
        item("CocoaBar", C + 3.0, 0.33),
        item("SofaPlaid", W - 2.7, 0.6),
        item("MiniPine", W - 0.8, 0.7, 0.4, 9),
      ],
      spots: [
        ...chess,
        spot("arm-a", C - 1.35, 0.42, 1.5, 2.2, "warm", { via: { x: C - 0.75, z: 1.15 } }),
        spot("arm-b", C + 1.35, 0.42, 1.5, -2.2, "read", { prop: "HeldBook", via: { x: C + 0.75, z: 1.15 } }),
        spot("cocoa-a", C + 2.65, 0, 1.05, BACK, "sip", { prop: "Mug" }),
        spot("cocoa-b", C + 3.35, 0, 1.05, BACK, "sip", { prop: "Mug" }),
        spot("sofa-a", W - 3.1, 0.46, 0.52, 0, "nap"),
        spot("sofa-b", W - 2.3, 0.46, 0.52, 0, "read", { prop: "HeldBook" }),
        spot("skis", 1.9, 0, 0.95, BACK, "browse"),
        spot("window", 0.85, 0, 1.6, WEST, "gaze"),
      ],
      games: [{ id: "chess", a: "chess-a", b: "chess-b", kind: "turns" }],
      rugs: [{ shape: "rect", x: C, z: 1.6, w: 4.2, d: 1.7, color: "#A9463C" }],
      pet: { x: C, z: 1.3, facing: 0 },
      wallBlocks: [[C, 0.65]],
      clockX: C - 2.6,
    };
  },
};

// ----------------------------------------------------------------- orbital

const orbital: Theme = {
  id: "orbital",
  name: "Orbital",
  blurb: "A space station office: portholes, air hockey, space lettuce and zero-g beanbags.",
  swatch: ["#0E1430", "#4FE0E6", "#8B78D8"],
  day: { background: "#0D1330", sky: "#E8EEFF", ground: "#5A6080", sun: "#F2F6FF" },
  night: { background: "#05071A", sky: "#8E9BE2", ground: "#352E58", sun: "#B8C4FF" },
  floor: { style: "plating", colors: ["#3D4558", "#373F51"], seam: "#262B38" },
  walls: { style: "panels", color: "#30384B", accent: "#262C3C", wainscot: "#1F2433", wainscotStyle: "plate", trim: "#4FE0E6", glowTrim: true },
  base: "#1B2030",
  window: "Porthole",
  view: "space",
  wallDecor: [],
  pet: { kind: "drone", name: "Sputnik", asset: "Drone" },
  hats: { assets: ["Hat_Antenna"], colors: ["#FF6B6B", "#4FE0E6", "#F4CF5D", "#FF6FB5", "#9BE36B"] },
  trinkets: ["MiniRocket", "Globe", "RubberDuck", "Figurine"],
  ambient: ["motes"],
  amenities(W) {
    const C = W / 2;
    const room = lounge(W, "SofaOrbital", "BeanbagViolet", true);
    const hockey = pair("hockey", 4.75, 1.45, 0.95, 0, "play");
    return {
      furniture: [
        item("Telescope", 0.95, 1.05, EAST),
        item("Hydroponics", 2.45, 0.27),
        item("AirHockeyTable", 4.75, 1.45, 0, 0.8),
        item("VendingMachine", C - 0.7, 0.32),
        item("PodChair", C + 0.45, 0.4),
        item("PodChair", C + 1.35, 0.4),
        ...room.furniture,
        item("Globe", W - 0.85, 0.75, 0.6, 7),
      ],
      spots: [
        spot("scope", 1.4, 0, 1.05, WEST, "scope"),
        spot("hydro", 2.45, 0, 0.98, BACK, "water", { prop: "WateringCan" }),
        ...hockey,
        spot("snack", C - 0.7, 0, 1.05, BACK, "browse"),
        spot("pod-a", C + 0.45, 0.38, 0.38, 0, "sit"),
        spot("pod-b", C + 1.35, 0.38, 0.38, 0, "read", { prop: "HeldBook" }),
        ...room.spots,
      ],
      games: [{ id: "hockey", a: "hockey-a", b: "hockey-b", kind: "hockey", rest: { x: 4.75, y: 0.41, z: 1.45 }, ball: "#FF6FB5" }, chat],
      rugs: [{ shape: "circle", x: W - 3.6, z: 1.55, w: 3.5, d: 3.5, color: "#2B3357" }],
      pet: { x: 2.45, z: 1.35, facing: BACK },
      wallBlocks: [],
      clockX: C + 0.2,
    };
  },
};

// ----------------------------------------------------------------- seaside

const seaside: Theme = {
  id: "seaside",
  name: "Seaside",
  blurb: "A beach shack with a juice bar, a hammock and paddleball in the sand. Mind the crab.",
  swatch: ["#A9DDF0", "#F4CF5D", "#EE7C6B"],
  day: { background: "#A6DCEF", sky: "#FFFFFF", ground: "#E3D3B0", sun: "#FFF3D6" },
  night: { background: "#28254F", sky: "#C6C2F2", ground: "#6E6078", sun: "#FFC9A8" },
  floor: { style: "deck", colors: ["#EAE0D0", "#E2D7C4", "#EFE7DA", "#E6DCCB"], seam: "#C8B79F" },
  walls: { style: "shiplap", color: "#F2F7F7", accent: "#D9E5E8", wainscot: "#2F5E7A", wainscotStyle: "beadboard", trim: "#FFFFFF" },
  base: "#E8E0D0",
  window: "Window",
  view: "ocean",
  wallDecor: ["Lifebuoy"],
  pet: { kind: "crab", name: "Pinchy", asset: "Crab" },
  hats: { assets: ["Hat_Straw", "Hat_Sunglasses"] },
  trinkets: ["Seashell", "Pail", "PlantSmall", "Cactus"],
  ambient: [],
  amenities(W) {
    const C = W / 2;
    const toss = pair("toss", 4.65, 1.55, 1.05, 0, "play", "BeachPaddle");
    return {
      furniture: [
        item("PalmPlant", 0.9, 0.7, 0.5),
        item("SurfboardRack", 2.3, 0.22),
        item("JuiceBar", C - 0.2, 0.36),
        item("Hammock", C + 2.35, 0.8),
        item("DeckChair", W - 3.5, 1.0),
        item("DeckChair", W - 2.5, 1.0),
        item("BeachUmbrella", W - 3.0, 1.05),
        item("PalmPlant", W - 0.8, 0.7, 2.4),
      ],
      spots: [
        spot("surf", 2.3, 0, 1.0, BACK, "browse"),
        ...toss,
        spot("juice-a", C - 0.55, 0, 1.15, BACK, "sip", { prop: "Mug" }),
        spot("juice-b", C + 0.15, 0, 1.15, BACK, "sip", { prop: "Mug" }),
        spot("hammock", C + 2.45, 0.42, 0.8, 0, "swing"),
        spot("deck-a", W - 3.5, 0.3, 1.05, 0, "sun"),
        spot("deck-b", W - 2.5, 0.3, 1.05, 0, "sun"),
        spot("window", 0.85, 0, 1.6, WEST, "gaze"),
      ],
      games: [{ id: "toss", a: "toss-a", b: "toss-b", kind: "toss", rest: { x: 4.65, y: 0.07, z: 1.85 }, hitY: 0.6, ball: "#F4CF5D" }],
      rugs: [
        { shape: "blob", x: 4.65, z: 1.55, w: 3.3, d: 1.6, color: "#EAD8AE" },
        { shape: "blob", x: W - 3.0, z: 1.25, w: 2.9, d: 1.9, color: "#EAD8AE" },
      ],
      pet: { x: W - 3.0, z: 2.15, facing: 0 },
      wallBlocks: [[C - 0.2, 0.9]],
      clockX: C + 2.4,
    };
  },
};

export const THEMES: Theme[] = [studio, greenhouse, lodge, orbital, seaside];

export function themeById(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? studio;
}

export const isThemeId = (id: unknown): id is ThemeId => THEMES.some((t) => t.id === id);


"""Assets for the lodge theme: a stone fireplace, plaid armchair, cocoa bar, skis and a cat."""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .core import blob as _core_blob
from .core import box, colors, cyl, lathe, material, mesh, rod, root, torus
from .office import couch

colors(
    lodge_bark=("#7A5538", 0.85),
    lodge_soot=("#2B2422", 0.95),
    lodge_stone_light=("#CEC8BE", 0.85),
    lodge_stone_warm=("#B8A792", 0.85),
    lodge_stone_cool=("#9EA2A6", 0.85),
    lodge_mortar=("#625C57", 0.95),
    lodge_flame=("#F5863A", 0.5),
    lodge_flame_core=("#FFD35C", 0.5),
    lodge_glow=("#F09A4A", 0.6),
    lodge_ember=("#E8582E", 0.5),
    lodge_cocoa=("#5A3424", 0.3),
    lodge_jar=("#9E3A33", 0.35),
    lodge_ginger_dark=("#C8773C", 0.7),
    lodge_knit=("#5677A6", 0.95),
    lodge_walnut=("#8E6542", 0.55),
)


# ------------------------------------------------------------------ helpers


def _soft(obj):
    """Plain smooth normals for round shapes (the weighted-normal pass is for boxes)."""
    obj.modifiers.clear()
    return obj


def blob(*args, **kwargs):
    return _soft(_core_blob(*args, **kwargs))


def _rot(obj, angle, axis="X", about=(0, 0, 0)):
    """Rotates a part's mesh about a point in its own space, leaving its pivot where it is."""
    p = Vector(about)
    obj.data.transform(Matrix.Translation(p) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-p))
    return obj


def _xf(objs, matrix):
    for o in objs:
        o.data.transform(matrix)
    return objs


def _join(objs, name):
    """Merges parts that share a parent and a material into the first one."""
    target = objs[0]
    bm = bmesh.new()
    bm.from_mesh(target.data)
    inv = target.matrix_basis.inverted()
    for o in objs[1:]:
        me = o.data.copy()
        me.transform(inv @ o.matrix_basis)
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        old = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        bpy.data.meshes.remove(old)
    bm.to_mesh(target.data)
    bm.free()
    target.name = name
    target.data.name = name
    return target


def _spline(points, steps=6):
    """Catmull-Rom curve through `points`."""
    pts = [Vector(p) for p in points]
    ext = [pts[0] * 2 - pts[1], *pts, pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(steps):
            t = s / steps
            out.append(
                0.5
                * (
                    2 * p1
                    + (-p0 + p2) * t
                    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                    + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
                )
            )
    out.append(pts[-1])
    return out


def _tube(name, points, radius, mat, parent, origin=(0, 0, 0), sides=8, radius_end=None, closed=False):
    """A round tube swept along a polyline."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    tangents = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[i - 1]
        else:
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        tangents.append(t.normalized())
    ref = Vector((0, 0, 1)) if abs(tangents[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tangents[0].cross(ref).normalized()
    verts, faces = [], []
    for i, (p, t) in enumerate(zip(pts, tangents)):
        nrm = (nrm - t * nrm.dot(t)).normalized()
        bi = t.cross(nrm)
        rr = radius if radius_end is None else radius + (radius_end - radius) * i / (n - 1)
        for j in range(sides):
            a = j / sides * math.tau
            verts.append(tuple(p + (nrm * math.cos(a) + bi * math.sin(a)) * rr))
    for i in range(n if closed else n - 1):
        i2 = (i + 1) % n
        for j in range(sides):
            j2 = (j + 1) % sides
            faces.append((i * sides + j, i * sides + j2, i2 * sides + j2, i2 * sides + j))
    if not closed:
        faces.append(tuple(range(sides))[::-1])
        faces.append(tuple(range((n - 1) * sides, n * sides)))
    return _soft(mesh(name, verts, faces, mat, parent, origin=origin, smooth=True))


def _leaf(name, length, width, mat, parent, base=(0, 0, 0), yaw=0.0, pitch=0.0, roll=0.0, thick=None, curl=0.0, fold=0.15,
          origin=(0, 0, 0), rows=6, sides=6):
    """A pointed leaf growing from `base` along +X, then pitched up and turned by `yaw` (radians)."""
    thick = thick if thick is not None else width * 0.22
    verts = [(0.0, 0.0, 0.0)]
    faces = []
    for k in range(1, rows):
        t = k / rows
        w = width / 2 * math.sin(math.pi * t**0.8)
        h = thick / 2 * (0.35 + 0.65 * math.sin(math.pi * t**0.8))
        cx, cz = t * length, curl * t * t * length
        for j in range(sides):
            a = j / sides * math.tau
            y = w * math.cos(a)
            verts.append((cx, y, cz + h * math.sin(a) + fold * abs(y)))
    tip = len(verts)
    verts.append((length, 0.0, curl * length))
    for j in range(sides):
        faces.append((0, 1 + (j + 1) % sides, 1 + j))
    for k in range(rows - 2):
        a0, a1 = 1 + k * sides, 1 + (k + 1) * sides
        for j in range(sides):
            j2 = (j + 1) % sides
            faces.append((a0 + j, a0 + j2, a1 + j2, a1 + j))
    last = 1 + (rows - 2) * sides
    for j in range(sides):
        faces.append((last + j, last + (j + 1) % sides, tip))
    m = Matrix.Translation(Vector(base)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(-pitch, 4, "Y") @ Matrix.Rotation(roll, 4, "X")
    verts = [tuple(m @ Vector(v)) for v in verts]
    return _soft(mesh(name, verts, faces, mat, parent, origin=origin, smooth=True))


def _teardrop(name, radius, height, mat, parent, origin, squash=1.0, segments=16):
    """A flame: round belly low down, pointed tip on top; its origin is the base."""
    prof = []
    for k in range(11):
        t = k / 10
        prof.append((radius * math.sin(math.pi * t**0.62) ** 1.15, height * t))
    obj = _soft(lathe(name, prof, mat, parent, origin=origin, segments=segments))
    if squash != 1.0:
        obj.data.transform(Matrix.Diagonal((1, squash, 1, 1)))
    return obj


def _log(prefix, parent, start, end, radius, bark="lodge_bark"):
    """A split-free firewood log: bark cylinder with pale cut ends and a growth ring."""
    a, b = Vector(start), Vector(end)
    axis = (b - a).normalized()
    parts_bark = [rod(f"{prefix}Bark", tuple(a), tuple(b), radius, bark, parent, segments=12)]
    ends = []
    for k, (p, d) in enumerate(((a, -axis), (b, axis))):
        ends.append(rod(f"{prefix}End{k}", tuple(p - d * 0.004), tuple(p + d * 0.004), radius * 0.86, "wood", parent, segments=12))
        ends.append(rod(f"{prefix}Ring{k}", tuple(p + d * 0.004), tuple(p + d * 0.006), radius * 0.45, "wood_dark", parent, segments=10))
    return parts_bark, ends


def _pine(prefix, parent, base, scale=1.0, pot="red"):
    """A little potted pine: stacked cones, a gold star and a few baubles."""
    x, y, z = base
    s = scale
    lathe(f"{prefix}Pot", [(0, 0), (0.024 * s, 0), (0.03 * s, 0.03 * s), (0.034 * s, 0.03 * s), (0.034 * s, 0.038 * s), (0, 0.038 * s)], pot,
          parent, origin=(x, y, z), segments=18)
    cones = []
    for k, (r1, h, zb) in enumerate(((0.042, 0.048, 0.038), (0.034, 0.042, 0.068), (0.024, 0.036, 0.094))):
        cones.append(cyl(f"{prefix}Cone{k}", r1 * s, 0.002 * s, h * s, (0, 0, zb * s), "forest", parent, origin=(x, y, z), segments=16))
    _join(cones, f"{prefix}Tree")
    pts = []
    for k in range(10):
        a = math.pi / 2 + k * math.tau / 10
        rr = (0.014 if k % 2 == 0 else 0.006) * s
        pts.append((math.cos(a) * rr, math.sin(a) * rr))
    t = 0.004 * s
    verts = [(px, -t, pz) for px, pz in pts] + [(px, t, pz) for px, pz in pts] + [(0, -t * 1.6, 0), (0, t * 1.6, 0)]
    faces = []
    for k in range(10):
        k2 = (k + 1) % 10
        faces.append((20, k2, k))
        faces.append((21, 10 + k, 10 + k2))
        faces.append((k, k2, 10 + k2, 10 + k))
    mesh(f"{prefix}Star", verts, faces, "gold", parent, origin=(x, y, z + 0.138 * s))
    baubles = []
    for k, (bx, by, bz, m) in enumerate(((0.02, -0.025, 0.06, "red"), (-0.022, -0.02, 0.085, "gold"), (0.012, -0.018, 0.105, "gold"),
                                         (-0.03, 0.01, 0.055, "red"))):
        baubles.append((m, blob(f"{prefix}Bauble{k}", 0.0055 * s, (bx * s, by * s, bz * s), (1, 1, 1), m, parent, origin=(x, y, z),
                                subdivisions=1)))
    for m in ("red", "gold"):
        objs = [o for mm, o in baubles if mm == m]
        _join(objs, f"{prefix}Baubles_{m}")


# ------------------------------------------------------------------- assets


def _stone_courses(prefix, x0, x1, z0, z1, y0, y1, courses, parent, seed, store):
    """Fills a block of wall with rounded fieldstones in a running bond, sorted into shades in `store`."""
    shades = ("stone", "lodge_stone_light", "lodge_stone_warm", "lodge_stone_cool", "stone", "lodge_stone_light", "lodge_stone_warm")

    def noise(*v):
        return math.sin(sum(c * f for c, f in zip(v, (12.9898, 78.233, 37.719))) + seed * 4.1) * 0.5 + 0.5

    ch = (z1 - z0) / courses
    k = 0
    for row in range(courses):
        z = z0 + row * ch
        span = x1 - x0
        n = max(1, round(span / 0.3))
        base = span / n
        offset = 0.5 if (row + seed) % 2 else 0.0
        cuts = [x0]
        for i in range(1, n):
            cuts.append(x0 + i * base + (offset - 0.25) * base * 0.7 + (noise(row, i) - 0.5) * 0.35 * base)
        cuts.append(x1)
        for i in range(len(cuts) - 1):
            a, b = cuts[i], cuts[i + 1]
            if b - a < 0.07:
                continue
            hz = ch * (0.8 + 0.14 * noise(row, i, 1))
            cz = z + ch / 2 + (noise(row, i, 2) - 0.5) * 0.02
            bulge = 0.016 * noise(row, i, 3)
            shade = shades[int(noise(row, i, 4) * 997) % len(shades)]
            stone = box(f"{prefix}{k}", (b - a - 0.022, y1 - y0 + bulge, hz), (0, -bulge / 2, 0), shade, parent, radius=0.042, segments=2,
                        origin=((a + b) / 2, (y0 + y1) / 2, cz))
            _rot(stone, (noise(row, i, 5) - 0.5) * 0.09, "Y")
            store.setdefault(shade, []).append(stone)
            k += 1
    return store


def build_fireplace():
    r = root("Fireplace")
    w, d, mantel = 1.70, 0.55, 1.15
    ow, oz0, oz1 = 0.8, 0.12, 0.72
    yf, yb = -d / 2, d / 2
    cav = 0.1  # back wall of the firebox
    shelf = 0.08
    body_top = mantel - shelf
    # Mortar core, shaped around the firebox, shows in the gaps between stones.
    core = [
        box("Fireplace_CoreL", (w / 2 - ow / 2 - 0.02, d - 0.02, body_top), (-(w / 2 + ow / 2) / 2, 0.01, body_top / 2), "lodge_mortar", r, radius=0.0),
        box("Fireplace_CoreR", (w / 2 - ow / 2 - 0.02, d - 0.02, body_top), ((w / 2 + ow / 2) / 2, 0.01, body_top / 2), "lodge_mortar", r, radius=0.0),
        box("Fireplace_CoreT", (ow + 0.02, d - 0.02, body_top - oz1), (0, 0.01, (oz1 + body_top) / 2), "lodge_mortar", r, radius=0.0),
        box("Fireplace_CoreB", (ow + 0.02, d - 0.02, oz0), (0, 0.01, oz0 / 2), "lodge_mortar", r, radius=0.0),
        box("Fireplace_CoreBack", (ow + 0.02, yb - cav, oz1 - oz0 + 0.02), (0, (cav + yb) / 2, (oz0 + oz1) / 2), "lodge_mortar", r, radius=0.0),
        box("Fireplace_CoreChimney", (1.16, 0.43, 2.7 - mantel), (0, yb - 0.225, (mantel + 2.7) / 2 - 0.01), "lodge_mortar", r, radius=0.0),
    ]
    _join(core, "Fireplace_Core")
    stones = {}
    _stone_courses("Fireplace_StoneL", -w / 2, -ow / 2, 0, body_top, yf, yb, 7, r, 0, stones)
    _stone_courses("Fireplace_StoneR", ow / 2, w / 2, 0, body_top, yf, yb, 7, r, 1, stones)
    _stone_courses("Fireplace_StoneT", -ow / 2 - 0.01, ow / 2 + 0.01, oz1 + 0.005, body_top, yf, yb - 0.02, 2, r, 2, stones)
    _stone_courses("Fireplace_StoneB", -ow / 2 - 0.01, ow / 2 + 0.01, 0, oz0, yf, yb - 0.02, 1, r, 3, stones)
    _stone_courses("Fireplace_StoneC", -0.6, 0.6, mantel, 2.64, yb - 0.45, yb, 8, r, 4, stones)
    box("Fireplace_ChimneyCap", (1.26, 0.49, 0.06), (0, yb - 0.245, 2.67), "lodge_stone_light", r, radius=0.02)
    for shade, objs in stones.items():
        _join(objs, f"Fireplace_Stones_{shade}")
    # The firebox: sooty lining, a glowing back panel, logs on a grate and three flames.
    lining = [
        box("Fireplace_SootFloor", (ow, cav - yf, 0.01), (0, (yf + cav) / 2, oz0 + 0.005), "lodge_soot", r, radius=0.0),
        box("Fireplace_SootBack", (ow, 0.01, oz1 - oz0), (0, cav - 0.005, (oz0 + oz1) / 2), "lodge_soot", r, radius=0.0),
        box("Fireplace_SootL", (0.01, cav - yf, oz1 - oz0), (-ow / 2 + 0.005, (yf + cav) / 2, (oz0 + oz1) / 2), "lodge_soot", r, radius=0.0),
        box("Fireplace_SootR", (0.01, cav - yf, oz1 - oz0), (ow / 2 - 0.005, (yf + cav) / 2, (oz0 + oz1) / 2), "lodge_soot", r, radius=0.0),
        box("Fireplace_SootTop", (ow, cav - yf, 0.01), (0, (yf + cav) / 2, oz1 - 0.005), "lodge_soot", r, radius=0.0),
    ]
    _join(lining, "Fireplace_Firebox")
    box("Fireplace_Glow", (ow - 0.16, 0.008, 0.36), (0, cav - 0.014, oz0 + 0.2), material("lodge_glow", emission=1.0), r, radius=0.004)
    grate = [box("Fireplace_GrateBar0", (0.5, 0.02, 0.02), (0, -0.16, oz0 + 0.03), "charcoal", r, radius=0.006),
             box("Fireplace_GrateBar1", (0.5, 0.02, 0.02), (0, 0.0, oz0 + 0.03), "charcoal", r, radius=0.006)]
    for k, x in enumerate((-0.22, 0.22)):
        grate.append(box(f"Fireplace_GrateLeg{k}", (0.02, 0.2, 0.04), (x, -0.08, oz0 + 0.02), "charcoal", r, radius=0.006))
    _join(grate, "Fireplace_Grate")
    bark, ends = [], []
    for k, (s, e, rad) in enumerate((((-0.26, -0.15, 0.2), (0.2, 0.0, 0.2), 0.045), ((0.26, -0.15, 0.2), (-0.2, 0.01, 0.2), 0.042),
                                     ((-0.2, -0.04, 0.27), (0.22, -0.1, 0.27), 0.04))):
        b_, e_ = _log(f"Fireplace_Log{k}", r, s, e, rad)
        bark += b_
        ends += e_
    _join(bark, "Fireplace_Logs")
    _join(ends, "Fireplace_LogEnds")
    embers = [blob(f"Fireplace_Ember{k}", 0.025, (x, y, oz0 + 0.02), (1.4, 1, 0.5), "lodge_ember", r, subdivisions=1)
              for k, (x, y) in enumerate(((-0.1, -0.08), (0.08, -0.12), (0.0, -0.02), (0.17, -0.05)))]
    _join(embers, "Fireplace_Embers")
    flame_mat = material("lodge_flame", emission=1.4)
    core_mat = material("lodge_flame_core", emission=1.6)
    for k, (x, y, z, rad, h) in enumerate(((0.0, -0.1, 0.24, 0.07, 0.32), (-0.13, -0.08, 0.22, 0.055, 0.22), (0.13, -0.11, 0.22, 0.05, 0.2))):
        flame = _teardrop(f"Fireplace_Flame{k}", rad, h, flame_mat, r, origin=(x, y, z), squash=0.75)
        _teardrop(f"Fireplace_Core{k}", rad * 0.55, h * 0.6, core_mat, flame, origin=(0, -rad * 0.32, 0.0), squash=0.7)
    # Hearth slab, mantel shelf with corbels, two candles and a potted pine.
    box("Fireplace_Hearth", (1.5, 0.34, 0.08), (0, yf - 0.13, 0.04), "lodge_stone_light", r, radius=0.02)
    box("Fireplace_Mantel", (w + 0.14, d + 0.07, shelf), (0, -0.035, mantel - shelf / 2), "lodge_walnut", r, radius=0.018)
    corbels = [box(f"Fireplace_Corbel{k}", (0.07, 0.07, 0.12), (sx * 0.8, yf - 0.02, body_top - 0.06), "lodge_walnut", r, radius=0.015)
               for k, sx in enumerate((-1, 1))]
    _join(corbels, "Fireplace_Corbels")
    ledge_y = yf - 0.0
    for k, (x, h) in enumerate(((-0.66, 0.16), (-0.54, 0.11))):
        cyl(f"Fireplace_Candle{k}", 0.032, 0.032, h, (x, ledge_y, mantel), "cream", r, radius=0.006, segments=18)
        rod(f"Fireplace_CandleWick{k}", (x, ledge_y, mantel + h - 0.002), (x, ledge_y, mantel + h + 0.012), 0.002, "charcoal", r, segments=6)
        _teardrop(f"Fireplace_CandleFlame{k}", 0.011, 0.034, flame_mat, r, origin=(x, ledge_y, mantel + h + 0.008))
    _pine("Fireplace_Pine", r, (0.62, ledge_y, mantel), scale=1.5, pot="terracotta")
    return r


def build_armchair():
    r = root("Armchair")
    for k, (x, y) in enumerate(((-0.31, -0.28), (0.31, -0.28), (-0.31, 0.28), (0.31, 0.28))):
        lathe(f"Armchair_Foot{k}", [(0, 0), (0.022, 0), (0.026, 0.02), (0.034, 0.05), (0.036, 0.08), (0, 0.08)], "wood_dark", r, origin=(x, y, 0),
              segments=14)
    box("Armchair_Base", (0.78, 0.72, 0.27), (0, 0, 0.215), "plaid", r, radius=0.05, segments=4)
    box("Armchair_Seat", (0.52, 0.6, 0.1), (0, -0.07, 0.37), "cream", r, radius=0.045, segments=4)
    back = box("Armchair_Back", (0.66, 0.17, 0.66), (0, 0, 0), "plaid", r, radius=0.07, segments=4, origin=(0, 0.27, 0.665))
    _rot(back, math.radians(-6))
    cushion = box("Armchair_BackCushion", (0.5, 0.1, 0.44), (0, 0, 0), "plaid", r, radius=0.05, segments=4, origin=(0, 0.17, 0.66))
    _rot(cushion, math.radians(-6))
    for k, sx in enumerate((-1, 1)):
        x = sx * 0.33
        box(f"Armchair_Arm{k}", (0.14, 0.68, 0.24), (x, -0.02, 0.44), "plaid", r, radius=0.06, segments=4)
        rod(f"Armchair_Roll{k}", (x + sx * 0.005, -0.35, 0.565), (x + sx * 0.005, 0.25, 0.565), 0.065, "plaid", r, segments=20)
        for j, yy in enumerate((-0.35, 0.25)):
            blob(f"Armchair_RollEnd{k}{j}", 0.065, (x + sx * 0.005, yy, 0.565), (1, 0.45, 1), "plaid", r, subdivisions=2)
        wing = box(f"Armchair_Wing{k}", (0.12, 0.3, 0.42), (0, 0, 0), "plaid", r, radius=0.055, segments=4, origin=(x + sx * 0.005, 0.12, 0.79))
        _rot(wing, sx * math.radians(-8), "Y")
    return r


def _piece(prefix, kind, x, y, z, mat, parent, store):
    """A chunky chess piece standing on (x, y, z)."""
    o = (x, y, z)
    base = [(0, 0), (0.03, 0), (0.031, 0.006), (0.03, 0.012), (0.022, 0.018)]
    if kind == "pawn":
        store.append(lathe(f"{prefix}", base + [(0.014, 0.04), (0.02, 0.044), (0.02, 0.048), (0, 0.048)], mat, parent, origin=o, segments=18))
        store.append(blob(f"{prefix}Head", 0.018, (x, y, z + 0.062), (1, 1, 1), mat, parent, subdivisions=2))
    elif kind == "rook":
        store.append(lathe(f"{prefix}", base + [(0.021, 0.055), (0.027, 0.06), (0.027, 0.074), (0, 0.074)], mat, parent, origin=o, segments=18))
        for k in range(4):
            a = k * math.tau / 4 + math.pi / 4
            store.append(box(f"{prefix}Merlon{k}", (0.014, 0.014, 0.014), (x + math.cos(a) * 0.019, y + math.sin(a) * 0.019, z + 0.079), mat, parent,
                             radius=0.003))
    elif kind == "bishop":
        store.append(lathe(f"{prefix}", base + [(0.013, 0.05), (0.02, 0.055), (0, 0.055)], mat, parent, origin=o, segments=18))
        store.append(blob(f"{prefix}Head", 0.017, (x, y, z + 0.072), (1, 1, 1.35), mat, parent, subdivisions=2))
        store.append(blob(f"{prefix}Tip", 0.006, (x, y, z + 0.098), (1, 1, 1), mat, parent, subdivisions=1))
    elif kind == "queen":
        store.append(lathe(f"{prefix}", base + [(0.013, 0.06), (0.022, 0.068), (0.024, 0.08), (0.016, 0.084), (0, 0.084)], mat, parent, origin=o,
                           segments=18))
        store.append(blob(f"{prefix}Ball", 0.01, (x, y, z + 0.092), (1, 1, 1), mat, parent, subdivisions=2))
    elif kind == "king":
        store.append(lathe(f"{prefix}", base + [(0.014, 0.064), (0.022, 0.072), (0.022, 0.084), (0, 0.084)], mat, parent, origin=o, segments=18))
        store.append(box(f"{prefix}CrossV", (0.009, 0.009, 0.032), (x, y, z + 0.098), mat, parent, radius=0.002))
        store.append(box(f"{prefix}CrossH", (0.024, 0.009, 0.009), (x, y, z + 0.102), mat, parent, radius=0.002))


def build_chess_table():
    r = root("ChessTable")
    top = 0.45
    box("ChessTable_Top", (0.5, 0.5, 0.045), (0, 0, top - 0.0225), "lodge_walnut", r, radius=0.015)
    lathe("ChessTable_Post", [(0.05, 0.05), (0.04, 0.09), (0.04, 0.3), (0.05, 0.36), (0.062, 0.4), (0.062, 0.41), (0, 0.41)], "lodge_walnut", r,
          segments=24)
    lathe("ChessTable_Base", [(0, 0), (0.17, 0), (0.17, 0.018), (0.14, 0.04), (0.06, 0.06), (0, 0.06)], "lodge_walnut", r, segments=32)
    tiles = {"cream": [], "wood_dark": []}
    t = 0.092
    for i in range(4):
        for j in range(4):
            m = "cream" if (i + j) % 2 == 0 else "wood_dark"
            tiles[m].append(box(f"ChessTable_Tile{i}{j}", (t, t, 0.006), ((i - 1.5) * t, (j - 1.5) * t, top + 0.001), m, r, radius=0.0))
    _join(tiles["cream"], "ChessTable_TilesLight")
    _join(tiles["wood_dark"], "ChessTable_TilesDark")
    light, dark = [], []
    z = top + 0.004
    for k, (kind, i, j) in enumerate((("king", 1, 0), ("pawn", 2, 1), ("rook", 3, 0))):
        _piece(f"ChessTable_Light{k}", kind, (i - 1.5) * t, (j - 1.5) * t, z, "cream", r, light)
    for k, (kind, i, j) in enumerate((("queen", 2, 3), ("pawn", 1, 2), ("bishop", 0, 3))):
        _piece(f"ChessTable_Dark{k}", kind, (i - 1.5) * t, (j - 1.5) * t, z, "charcoal", r, dark)
    _join(light, "ChessTable_PiecesLight")
    _join(dark, "ChessTable_PiecesDark")
    return r


def build_log_stool():
    r = root("LogStool")
    h = 0.31
    seg = 32
    verts, faces = [], []
    levels = [(0.0, 1.12), (0.03, 1.04), (0.07, 1.0), (0.16, 0.98), (0.25, 0.99), (h, 1.0)]
    for z, s in levels:
        for j in range(seg):
            a = j / seg * math.tau
            rr = 0.16 * s * (1 + 0.035 * math.sin(11 * a + z * 9) + 0.025 * math.sin(5 * a + 1.3))
            verts.append((math.cos(a) * rr, math.sin(a) * rr, z))
    for k in range(len(levels) - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((k * seg + j, k * seg + j2, (k + 1) * seg + j2, (k + 1) * seg + j))
    faces.append(tuple(range(seg))[::-1])
    faces.append(tuple(range((len(levels) - 1) * seg, len(levels) * seg)))
    _soft(mesh("LogStool_Bark", verts, faces, "lodge_bark", r, smooth=True))
    cyl("LogStool_Top", 0.148, 0.148, 0.014, (0, 0, h - 0.004), "wood", r, radius=0.004, segments=32)
    rings = [torus("LogStool_Ring0", 0.098, 0.0045, (0, 0, h + 0.009), "wood_dark", r, segments=32, sides=6),
             torus("LogStool_Ring1", 0.05, 0.004, (0, 0, h + 0.009), "wood_dark", r, segments=24, sides=6)]
    for o in rings:
        o.data.transform(Matrix.Translation((0, 0, h + 0.009)) @ Matrix.Diagonal((1, 1, 0.4, 1)) @ Matrix.Translation((0, 0, -(h + 0.009))))
    _join(rings, "LogStool_Rings")
    blob("LogStool_Heart", 0.012, (0, 0, h + 0.009), (1, 1, 0.3), "wood_dark", r, subdivisions=1)
    return r


def _ski(name, x, path, width, thick, mat, parent):
    """A ski swept along a path in the YZ plane; it narrows to a rounded tip at the end."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    verts, faces = [], []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = Vector((0, -t.z, t.y))  # perpendicular in YZ, toward the front for an upright ski
        f = i / (n - 1)
        w = width / 2 * (1.0 if f < 0.9 else 0.55 + 0.45 * math.cos((f - 0.9) / 0.1 * math.pi / 2))
        if f < 0.03:
            w *= 0.85
        for sx, sn in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append((x + sx * w, p.y + nrm.y * sn * thick / 2, p.z + nrm.z * sn * thick / 2))
    for i in range(n - 1):
        for j in range(4):
            j2 = (j + 1) % 4
            faces.append((i * 4 + j, i * 4 + j2, (i + 1) * 4 + j2, (i + 1) * 4 + j))
    faces.append((3, 2, 1, 0))
    faces.append(tuple(range((n - 1) * 4, n * 4)))
    return mesh(name, verts, faces, mat, parent, smooth=False)


def build_ski_rack():
    r = root("SkiRack")
    frame = []
    for k, x in enumerate((-0.425, 0.425)):
        frame.append(box(f"SkiRack_Post{k}", (0.05, 0.05, 1.0), (x, 0.09, 0.5), "lodge_walnut", r, radius=0.012))
    frame.append(box("SkiRack_TopRail", (0.9, 0.06, 0.06), (0, 0.075, 0.92), "lodge_walnut", r, radius=0.015))
    frame.append(box("SkiRack_MidRail", (0.85, 0.03, 0.06), (0, 0.105, 0.45), "lodge_walnut", r, radius=0.01))
    frame.append(box("SkiRack_Tray", (0.9, 0.24, 0.04), (0, 0.0, 0.02), "lodge_walnut", r, radius=0.012))
    frame.append(box("SkiRack_Lip", (0.9, 0.03, 0.09), (0, -0.11, 0.045), "lodge_walnut", r, radius=0.01))
    _join(frame, "SkiRack_Frame")
    # Skis lean from the tray onto the top rail and curl forward at the tips.
    y0, z0 = -0.07, 0.04
    lean = (0.075 - 0.03 - 0.008 - y0) / (0.92 - z0)
    length = 1.55

    def ski_path():
        pts = []
        straight = 1.38
        for k in range(12):
            s = straight * k / 11
            pts.append((0, y0 + lean * s, z0 + s))
        top = Vector(pts[-1])
        ang0 = math.atan(lean)
        for k in range(1, 9):
            a = ang0 - math.radians(80) * k / 8
            prev = Vector(pts[-1])
            step = (length - straight) / 8
            pts.append(tuple(prev + Vector((0, math.sin(a), math.cos(a))) * step))
        del top
        return pts

    path = ski_path()
    for k, (x, m) in enumerate(((-0.31, "red"), (-0.225, "red"), (-0.04, "teal"), (0.045, "teal"))):
        _ski(f"SkiRack_Ski{k}", x, path, 0.075, 0.016, m, r)
    bind = []
    for k, x in enumerate((-0.31, -0.225, -0.04, 0.045)):
        s = 0.62
        p = Vector((x, y0 + lean * s - 0.022, z0 + s))
        bind.append(box(f"SkiRack_Binding{k}", (0.06, 0.03, 0.16), tuple(p), "charcoal", r, radius=0.01))
    for k, cx in enumerate((-0.2675, 0.0025)):
        s = 0.3
        bind.append(box(f"SkiRack_Strap{k}", (0.18, 0.028, 0.035), (cx, y0 + lean * s - 0.008, z0 + s), "charcoal", r, radius=0.008))
    _join(bind, "SkiRack_Bindings")
    poles, grips = [], []
    for k, x in enumerate((0.22, 0.3)):
        b = Vector((x, -0.05, 0.04))
        t = Vector((x + (k - 0.5) * 0.04, 0.065, 1.22))
        poles.append(rod(f"SkiRack_Pole{k}", tuple(b), tuple(t), 0.009, "steel", r, segments=8))
        axis = (t - b).normalized()
        grips.append(rod(f"SkiRack_Grip{k}", tuple(t - axis * 0.12), tuple(t + axis * 0.01), 0.018, "charcoal", r, segments=12))
        ring = torus(f"SkiRack_Basket{k}", 0.035, 0.006, tuple(b + axis * 0.1), "charcoal", r, segments=16, sides=6)
        grips.append(ring)
    _join(poles, "SkiRack_Poles")
    _join(grips, "SkiRack_Grips")
    return r


def build_firewood():
    r = root("Firewood")
    crate = [
        box("Firewood_Floor", (0.7, 0.4, 0.04), (0, 0, 0.02), "wood", r, radius=0.01),
        box("Firewood_RailF", (0.7, 0.03, 0.11), (0, -0.185, 0.095), "wood", r, radius=0.01),
        box("Firewood_RailB", (0.7, 0.03, 0.11), (0, 0.185, 0.095), "wood", r, radius=0.01),
    ]
    for k, x in enumerate((-0.33, 0.33)):
        crate.append(box(f"Firewood_End{k}", (0.04, 0.4, 0.09), (x, 0, 0.085), "wood", r, radius=0.01))
        for j, y in enumerate((-0.18, 0.18)):
            crate.append(box(f"Firewood_Corner{k}{j}", (0.045, 0.045, 0.26), (x, y, 0.13), "wood", r, radius=0.012))
    _join(crate, "Firewood_Crate")
    rad = 0.056
    stack = []
    for y in (-0.11, 0.0, 0.11):
        stack.append((y, 0.04 + rad))
    for y in (-0.11, 0.0, 0.11):
        stack.append((y, 0.04 + 3 * rad))
    for y in (-0.055, 0.055):
        stack.append((y, 0.04 + 3 * rad + rad * 1.73))
    stack.append((0.0, 0.04 + 3 * rad + rad * 3.46))
    bark, ends = [], []
    for k, (y, z) in enumerate(stack):
        half = 0.29 + 0.025 * math.sin(k * 2.7)
        dx = 0.02 * math.sin(k * 1.9)
        yaw = math.radians(3 * math.sin(k * 3.3))
        rr = rad * (0.95 + 0.06 * math.cos(k * 2.1))
        a = Vector((dx - half, y - math.sin(yaw) * half, z))
        b = Vector((dx + half, y + math.sin(yaw) * half, z))
        b_, e_ = _log(f"Firewood_Log{k}", r, tuple(a), tuple(b), rr)
        bark += b_
        ends += e_
    _join(bark, "Firewood_Logs")
    _join(ends, "Firewood_LogEnds")
    return r


def _mug(prefix, x, y, z, mat, parent, marsh=3):
    cyl(f"{prefix}", 0.04, 0.043, 0.09, (x, y, z), mat, parent, radius=0.008, segments=20)
    cyl(f"{prefix}Cocoa", 0.035, 0.035, 0.004, (x, y, z + 0.082), "lodge_cocoa", parent, segments=18)
    _tube(f"{prefix}Handle", _spline([(x + 0.038, y, z + 0.072), (x + 0.066, y, z + 0.066), (x + 0.068, y, z + 0.035), (x + 0.04, y, z + 0.022)], 3),
          0.008, mat, parent, sides=8)
    cubes = []
    for k in range(marsh):
        a = k * 2.2 + x * 10
        c = box(f"{prefix}Marsh{k}", (0.022, 0.022, 0.02), (0, 0, 0), "white", parent, radius=0.005,
                origin=(x + math.cos(a) * 0.014, y + math.sin(a) * 0.014, z + 0.092 + 0.004 * (k % 2)))
        _rot(c, a, "Z")
        _rot(c, 0.3 * math.sin(a), "X")
        cubes.append(c)
    _join(cubes, f"{prefix}Marshmallows")


def build_cocoa_bar():
    r = root("CocoaBar")
    w, d, top = 1.4, 0.55, 0.78
    box("CocoaBar_Cabinet", (w - 0.06, d - 0.05, top - 0.05), (0, 0.02, (top - 0.05) / 2), "wood", r, radius=0.025)
    box("CocoaBar_Top", (w, d, 0.05), (0, 0, top - 0.025), "lodge_walnut", r, radius=0.018)
    box("CocoaBar_Kick", (w - 0.1, 0.02, 0.06), (0, -0.215, 0.03), "lodge_walnut", r, radius=0.006)
    dw = (w - 0.06 - 0.08) / 3
    for k in range(3):
        x = (k - 1) * (dw + 0.02)
        box(f"CocoaBar_Door{k}", (dw - 0.02, 0.02, 0.56), (x, -0.235, 0.38), "wood_dark", r, radius=0.012)
        box(f"CocoaBar_Panel{k}", (dw - 0.12, 0.012, 0.44), (x, -0.247, 0.38), "lodge_walnut", r, radius=0.008)
        blob(f"CocoaBar_Knob{k}", 0.016, (x + (dw / 2 - 0.05) * (1 if k < 2 else -1), -0.258, 0.5), (1, 0.8, 1), "copper", r, subdivisions=2)
    # The cocoa pot on a little burner.
    px, py = -0.4, 0.04
    lathe("CocoaBar_Burner", [(0, 0), (0.085, 0), (0.085, 0.012), (0.07, 0.02), (0.07, 0.07), (0.08, 0.075), (0.08, 0.085), (0, 0.085)], "charcoal",
          r, origin=(px, py, top), segments=24)
    box("CocoaBar_BurnerWindow", (0.07, 0.01, 0.03), (px, py - 0.068, top + 0.04), material("lodge_ember", emission=1.5), r, radius=0.006)
    pz = top + 0.085
    lathe("CocoaBar_Pot", [(0, 0), (0.08, 0), (0.095, 0.015), (0.098, 0.1), (0.104, 0.105), (0.104, 0.112), (0.09, 0.112), (0.088, 0.02), (0, 0.02)],
          "copper", r, origin=(px, py, pz), segments=28)
    cyl("CocoaBar_PotCocoa", 0.09, 0.09, 0.004, (px, py, pz + 0.088), "lodge_cocoa", r, segments=24)
    handles = [_tube(f"CocoaBar_PotHandle{k}", _spline([(px + sx * 0.095, py, pz + 0.085), (px + sx * 0.13, py, pz + 0.09), (px + sx * 0.13, py, pz + 0.06),
                                                        (px + sx * 0.096, py, pz + 0.055)], 3), 0.008, "copper", r, sides=8)
               for k, sx in enumerate((-1, 1))]
    _join(handles, "CocoaBar_PotHandles")
    rod("CocoaBar_Ladle", (px + 0.02, py + 0.02, pz + 0.06), (px + 0.07, py + 0.09, pz + 0.24), 0.007, "steel", r, segments=8)
    # A tray of mugs topped with marshmallows.
    box("CocoaBar_Tray", (0.42, 0.2, 0.016), (0.18, -0.04, top + 0.008), "lodge_walnut", r, radius=0.006)
    for k, (x, m) in enumerate(((0.04, "plaid"), (0.18, "cream"), (0.32, "plaid"))):
        _mug(f"CocoaBar_Mug{k}", x, -0.04 + 0.02 * (k % 2), top + 0.016, m, r)
    lathe("CocoaBar_Jar", [(0, 0), (0.05, 0), (0.052, 0.01), (0.052, 0.12), (0.04, 0.13), (0, 0.13)], material("glass", alpha=0.45), r,
          origin=(0.55, 0.12, top), segments=20)
    cyl("CocoaBar_JarLid", 0.042, 0.042, 0.022, (0.55, 0.12, top + 0.125), "copper", r, radius=0.006, segments=20)
    fill = [box(f"CocoaBar_JarMarsh{k}", (0.026, 0.026, 0.024), (0, 0, 0), "white", r, radius=0.006,
                origin=(0.55 + 0.022 * math.cos(k * 2.4), 0.12 + 0.022 * math.sin(k * 2.4), top + 0.018 + 0.022 * (k // 3))) for k in range(10)]
    for k, c in enumerate(fill):
        _rot(c, k * 0.7, "Z")
    _join(fill, "CocoaBar_JarMarshmallows")
    return r


def build_sofa_plaid():
    return couch("SofaPlaid", frame="plaid", cushion="cream", pillow="forest")


def build_cat():
    r = root("Cat")
    box("Cat_Body", (0.17, 0.26, 0.13), (0, 0.02, 0.16), "ginger", r, radius=0.06, segments=4)
    blob("Cat_Chest", 0.05, (0, -0.1, 0.15), (1.2, 0.7, 1.0), "cream", r, subdivisions=2)
    stripes = [box(f"Cat_Stripe{k}", (0.12, 0.022, 0.03), (0, y, 0.218), "lodge_ginger_dark", r, radius=0.01) for k, y in enumerate((-0.01, 0.045, 0.1))]
    _join(stripes, "Cat_Stripes")
    head = box("Cat_Head", (0.16, 0.13, 0.12), (0, -0.065, 0.035), "ginger", r, radius=0.05, segments=4, origin=(0, -0.09, 0.19))
    for side, sx in (("L", -1), ("R", 1)):
        ear = cyl(f"Cat_Ear{side}", 0.032, 0.004, 0.05, (0, 0, -0.008), "ginger", head, origin=(sx * 0.048, -0.06, 0.088), segments=12)
        _rot(ear, sx * math.radians(-16), "Y")
        inner = cyl(f"Cat_EarInner{side}", 0.018, 0.003, 0.03, (0, 0, -0.004), "pink", head, origin=(sx * 0.048, -0.075, 0.089), segments=10)
        _rot(inner, sx * math.radians(-16), "Y")
        _rot(inner, math.radians(14), "X")
        box(f"Cat_Eye{side}", (0.02, 0.012, 0.032), (0, 0, 0), "eye", head, radius=0.009, origin=(sx * 0.036, -0.131, 0.05))
    blob("Cat_Muzzle", 0.026, (0, -0.128, 0.012), (1.5, 0.55, 0.8), "cream", head, subdivisions=2)
    blob("Cat_Nose", 0.008, (0, -0.142, 0.026), (1.3, 0.8, 0.8), "pink", head, subdivisions=1)
    box("Cat_Forehead", (0.06, 0.012, 0.022), (0, -0.128, 0.083), "lodge_ginger_dark", head, radius=0.005)
    for name, x, y in (("FL", -0.05, -0.07), ("FR", 0.05, -0.07), ("BL", -0.05, 0.1), ("BR", 0.05, 0.1)):
        leg = box(f"Cat_Leg{name}", (0.05, 0.05, 0.09), (0, 0, -0.045), "ginger", r, radius=0.02, origin=(x, y, 0.11))
        box(f"Cat_Paw{name}", (0.056, 0.066, 0.032), (0, -0.008, -0.094), "cream", leg, radius=0.014)
    tail = _tube("Cat_Tail", _spline([(0, -0.01, -0.005), (0, 0.035, 0.0), (0, 0.065, 0.035), (0, 0.075, 0.08), (0, 0.06, 0.115)], 4), 0.02, "ginger",
                 r, origin=(0, 0.14, 0.18), sides=10, radius_end=0.017)
    blob("Cat_Tuft", 0.019, (0, 0.059, 0.118), (1, 1, 1), "cream", tail, subdivisions=2)
    return r


def build_cat_bed():
    r = root("CatBed")
    cyl("CatBed_Base", 0.22, 0.21, 0.03, (0, 0, 0), "plaid", r, radius=0.01, segments=36)
    rim = torus("CatBed_Rim", 0.195, 0.05, (0, 0, 0.05), "plaid", r, segments=40, sides=12)
    _soft(rim)
    lathe("CatBed_Cushion", [(0, 0.02), (0.15, 0.02), (0.165, 0.035), (0.16, 0.055), (0.13, 0.068), (0, 0.07)], "cream", r, segments=32)
    return r


def _superellipse(a, b, n, segments):
    pts = []
    for j in range(segments):
        t = j / segments * math.tau
        c, s = math.cos(t), math.sin(t)
        pts.append((a * math.copysign(abs(c) ** (2 / n), c), b * math.copysign(abs(s) ** (2 / n), s), t))
    return pts


def _ring_sweep(name, a, b, n, profile, mat, parent, segments=64, ribs=0, rib_depth=0.0):
    """Sweeps a closed (offset, z) profile around a superellipse of half-extents a, b: cuffs and bands."""
    verts, faces = [], []
    pts = _superellipse(1.0, 1.0, n, segments)
    for off, z in profile:
        for x, y, ang in pts:
            rib = 1 + rib_depth * math.cos(ang * ribs) if ribs else 1
            verts.append((x * (a + off) * rib, y * (b + off) * rib, z))
    rows = len(profile)
    for k in range(rows):
        k2 = (k + 1) % rows
        for j in range(segments):
            j2 = (j + 1) % segments
            faces.append((k * segments + j, k * segments + j2, k2 * segments + j2, k2 * segments + j))
    return _soft(mesh(name, verts, faces, mat, parent, smooth=True))


def build_hat_beanie():
    r = root("Hat_Beanie")
    a, b, h, z0 = 0.236, 0.176, 0.14, 0.035
    seg, rows = 64, 10
    verts, faces = [], []
    for k in range(rows):
        t = k / rows
        z = z0 + (h - z0) * math.sin(t * math.pi / 2)
        s = math.cos(t * math.pi / 2) ** 0.45
        for x, y, ang in _superellipse(a, b, 3.4, seg):
            rib = 1 + 0.03 * math.cos(ang * 32)
            verts.append((x * s * rib, y * s * rib, z))
    apex = len(verts)
    verts.append((0, 0, h))
    for k in range(rows - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((k * seg + j, k * seg + j2, (k + 1) * seg + j2, (k + 1) * seg + j))
    for j in range(seg):
        faces.append(((rows - 1) * seg + j, (rows - 1) * seg + (j + 1) % seg, apex))
    faces.append(tuple(range(seg))[::-1])
    _soft(mesh("Hat_Beanie_Knit", verts, faces, material("lodge_knit"), r, smooth=True))
    # The rolled cuff: a soft rounded band, outer size 0.52 x 0.40 x 0.05.
    cuff = [(-0.02, 0.0), (-0.004, 0.0), (0.006, 0.006), (0.01, 0.018), (0.01, 0.032), (0.006, 0.044), (-0.004, 0.05), (-0.02, 0.05)]
    _ring_sweep("Hat_Beanie_Band", 0.25, 0.19, 3.4, cuff, "cream", r, ribs=40, rib_depth=0.012)
    # A fluffy pompom: an icosphere with its vertices nudged in and out.
    pom = blob("Hat_Beanie_Pom", 0.06, (0, 0, 0), (1, 1, 1), "cream", r, origin=(0, 0, h + 0.04), subdivisions=2)
    for v in pom.data.vertices:
        p = v.co
        n = 1 + 0.07 * math.sin(p.x * 211 + p.y * 97) * math.cos(p.z * 157 + p.x * 53)
        v.co = p * n
    return r


def build_mini_pine():
    r = root("MiniPine")
    _pine("MiniPine_", r, (0, 0, 0))
    return r


def build_candle():
    r = root("Candle")
    lathe("Candle_Jar", [(0, 0), (0.031, 0), (0.035, 0.005), (0.035, 0.06), (0.03, 0.06), (0.03, 0.006), (0, 0.006)], "lodge_jar", r, segments=24)
    cyl("Candle_Band", 0.0358, 0.0358, 0.008, (0, 0, 0.024), "gold", r, segments=24)
    cyl("Candle_Wax", 0.0305, 0.0305, 0.044, (0, 0, 0.006), "cream", r, segments=20)
    rod("Candle_Wick", (0, 0, 0.049), (0, 0, 0.06), 0.0018, "charcoal", r, segments=6)
    _teardrop("Candle_Flame", 0.009, 0.03, material("lodge_flame", emission=1.4), r, origin=(0, 0, 0.056), segments=12)
    return r


def build_wreath():
    r = root("Wreath")
    major, y = 0.18, -0.045
    base = torus("Wreath_Base", major, 0.042, (0, y, 0), "forest", r, upright=True, segments=32, sides=10)
    _soft(base)
    leaves = {"forest": [], "leaf_dark": [], "moss": []}
    n = 26
    for k in range(n):
        a = k / n * math.tau
        for layer, (rr, m, tilt) in enumerate(((major + 0.03, "leaf_dark", 0.5), (major - 0.02, "moss" if k % 2 else "forest", -0.6))):
            cx, cz = math.cos(a) * rr, math.sin(a) * rr
            leaf = _leaf(f"Wreath_Leaf{layer}_{k}", 0.085, 0.04, m, r, thick=0.012, fold=0.25, curl=0.15)
            leaf.data.transform(Matrix.Translation((cx, y - 0.025 - 0.012 * layer, cz)) @ Matrix.Rotation(-(a + math.pi / 2 + tilt), 4, "Y")
                                @ Matrix.Rotation(math.radians(90), 4, "X"))
            leaves[m].append(leaf)
    for m, objs in leaves.items():
        if objs:
            _join(objs, f"Wreath_Leaves_{m}")
    berries = []
    for k in range(7):
        a = math.radians(30 + k * 52)
        for j in range(3):
            off = (math.cos(j * 2.1) * 0.014, math.sin(j * 2.1) * 0.014)
            berries.append(blob(f"Wreath_Berry{k}_{j}", 0.011, (math.cos(a) * major + off[0], y - 0.065, math.sin(a) * major + off[1]), (1, 1, 1), "red",
                                r, subdivisions=1))
    _join(berries, "Wreath_Berries")
    bz = -major - 0.01
    bow = [
        blob("Wreath_BowL", 0.045, (-0.05, y - 0.07, bz + 0.012), (1.15, 0.45, 0.7), "red", r, subdivisions=2),
        blob("Wreath_BowR", 0.045, (0.05, y - 0.07, bz + 0.012), (1.15, 0.45, 0.7), "red", r, subdivisions=2),
        blob("Wreath_Knot", 0.022, (0, y - 0.085, bz + 0.005), (1.1, 0.8, 1.0), "red", r, subdivisions=2),
    ]
    for k, sx in enumerate((-1, 1)):
        tail = box(f"Wreath_Ribbon{k}", (0.032, 0.012, 0.1), (0, 0, -0.05), "red", r, radius=0.005, origin=(sx * 0.012, y - 0.072, bz))
        _rot(tail, sx * math.radians(22), "Y")
        bow.append(tail)
    _join(bow, "Wreath_Bow")
    return r


BUILDERS = [
    build_fireplace,
    build_armchair,
    build_chess_table,
    build_log_stool,
    build_ski_rack,
    build_firewood,
    build_cocoa_bar,
    build_sofa_plaid,
    build_cat,
    build_cat_bed,
    build_hat_beanie,
    build_mini_pine,
    build_candle,
    build_wreath,
]

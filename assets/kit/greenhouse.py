"""Assets for the greenhouse theme: potting bench, koi pond, hammock, tortoise and plants."""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .core import blob as _core_blob
from .core import box, colors, cyl, lathe, material, mesh, rod, root, torus

colors(
    gh_pond=("#2C4A52", 0.9),
    gh_koi=("#F07A36", 0.45),
    gh_tea=("#B9772F", 0.2),
    gh_shell=("#B08552", 0.7),
    gh_shell_dark=("#7E5B36", 0.7),
    gh_skin=("#A2BE7E", 0.7),
    gh_rope=("#E6D7B8", 0.9),
    gh_packet=("#F2E6CF", 0.8),
)


# ------------------------------------------------------------------ helpers


def _soft(obj):
    """Plain smooth normals: the weighted-normal pass flattens round shapes into facets."""
    obj.modifiers.clear()
    return obj


def blob(*args, **kwargs):
    return _soft(_core_blob(*args, **kwargs))


def _ball(name, radius, center, scale, mat, parent, origin=(0, 0, 0), segments=24, rings=12):
    """A smooth UV ellipsoid: rounder than an icosphere for the same triangle count on big blobs."""
    prof = [(radius * math.sin(math.pi * k / rings), -radius * math.cos(math.pi * k / rings)) for k in range(rings + 1)]
    obj = _soft(lathe(name, prof, mat, parent, origin=origin, segments=segments))
    obj.data.transform(Matrix.Translation(Vector(center)) @ Matrix.Diagonal((*scale, 1)))
    return obj


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
    """A round tube swept along a polyline (ropes, vines, iron scrolls, stems)."""
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


def _leaf(name, length, width, mat, parent, base=(0, 0, 0), yaw=0.0, pitch=0.0, roll=0.0, thick=None, curl=0.0,
          fold=0.15, origin=(0, 0, 0), rows=7, sides=8):
    """A pointed leaf growing from `base`: along +X, then pitched up and turned by `yaw` (radians)."""
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


def _pot(prefix, r_bottom, r_top, height, base, mat, parent, rim=0.012, soil="coffee", hollow=False, segments=24):
    """A flower pot with a rolled rim; filled with soil unless `hollow`."""
    x, y, z = base
    lip = rim * 0.7
    wall = max(0.004, rim * 0.5)
    profile = [
        (0, 0),
        (r_bottom - 0.003, 0),
        (r_bottom, 0.004),
        (r_top - (r_top - r_bottom) * rim * 1.6 / height, height - rim * 1.6),
        (r_top + lip, height - rim * 1.6),
        (r_top + lip, height - 0.002),
        (r_top + lip - 0.003, height),
        (r_top - wall, height),
    ]
    if hollow:
        profile += [(r_bottom - wall, wall * 2), (0, wall * 2)]
    else:
        profile += [(r_top - wall, height - rim * 1.5), (0, height - rim * 1.5)]
    lathe(f"{prefix}", profile, mat, parent, origin=(x, y, z), segments=segments)
    if soil and not hollow:
        cyl(f"{prefix}Soil", r_top - wall, r_top - wall, 0.004, (0, 0, height - rim * 1.5 - 0.002), soil, parent,
            origin=(x, y, z), segments=segments)


def _scroll(cy, cz, r0, turns, start, direction=1, steps=40, shrink=0.75):
    """An iron curl in the YZ plane: a spiral around (cy, cz) that tightens as it turns."""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        a = start + direction * t * turns * math.tau
        rr = r0 * (1 - shrink * t)
        pts.append((cy + math.cos(a) * rr, cz + math.sin(a) * rr))
    return pts


# ------------------------------------------------------------------- assets


def _trowel(prefix, parent, base, yaw, pitch, handle="sage"):
    """A hand trowel; `base` is where the blade meets the handle, the blade points along +X before turning."""
    m = Matrix.Translation(Vector(base)) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Rotation(-pitch, 4, "Y")
    blade = _leaf(f"{prefix}Blade", 0.12, 0.065, "steel", parent, thick=0.006, fold=0.35)
    neck = rod(f"{prefix}Neck", (-0.025, 0, 0.004), (0.005, 0, 0.002), 0.006, "steel", parent)
    grip = rod(f"{prefix}Grip", (-0.13, 0, 0.006), (-0.025, 0, 0.006), 0.014, handle, parent, radius_end=0.012, segments=14)
    cap = blob(f"{prefix}Cap", 0.015, (-0.13, 0, 0.006), (1, 1, 1), handle, parent, subdivisions=2)
    _xf((blade, neck, grip, cap), m)


def _sprout(prefix, parent, base, height, scale=1.0, yaw=0.0):
    x, y, z = base
    _tube(f"{prefix}Stem", [(x, y, z), (x + 0.004, y, z + height * 0.6), (x, y, z + height)], 0.004 * scale, "leaf_dark",
          parent, sides=6, radius_end=0.003 * scale)
    leaves = [
        _leaf(f"{prefix}Leaf{i}", 0.04 * scale, 0.024 * scale, "leaf", parent, base=(x, y, z + height), yaw=yaw + i * math.pi,
              pitch=math.radians(25), curl=0.25, rows=5, sides=6)
        for i in range(2)
    ]
    _join(leaves, f"{prefix}Leaves")


def build_potting_bench():
    r = root("PottingBench")
    w, d, top = 1.30, 0.50, 0.75
    planks = []
    gap = 0.008
    pd = (d - 0.04 - gap * 2) / 3
    for i in range(3):
        y = -d / 2 + pd / 2 + i * (pd + gap)
        planks.append(box(f"PottingBench_Plank{i}", (w, pd, 0.045), (0, y, top - 0.0225), "wood", r, radius=0.01))
    _join(planks, "PottingBench_Top")
    back = [
        box("PottingBench_BackBoard", (w, 0.04, 0.52), (0, d / 2 - 0.02, top + 0.25), "wood", r, radius=0.012),
        box("PottingBench_BackCap", (w + 0.03, 0.07, 0.035), (0, d / 2 - 0.035, top + 0.51), "wood", r, radius=0.01),
    ]
    _join(back, "PottingBench_Back")
    frame = []
    for i, (x, y) in enumerate(((-0.6, -0.2), (0.6, -0.2), (-0.6, 0.2), (0.6, 0.2))):
        frame.append(box(f"PottingBench_Leg{i}", (0.06, 0.06, top - 0.045), (x, y, (top - 0.045) / 2), "wood_dark", r, radius=0.012))
    frame.append(box("PottingBench_Apron", (w - 0.12, 0.03, 0.08), (0, -0.2, top - 0.085), "wood_dark", r, radius=0.01))
    for i, x in enumerate((-0.6, 0.6)):
        frame.append(box(f"PottingBench_Rail{i}", (0.045, 0.42, 0.045), (x, 0, 0.16), "wood_dark", r, radius=0.01))
    _join(frame, "PottingBench_Frame")
    box("PottingBench_Shelf", (1.24, 0.44, 0.03), (0, 0, 0.185), "wood", r, radius=0.008)

    # Tools hanging from pegs on the back board.
    bz, by = top + 0.42, d / 2 - 0.04
    for i, x in enumerate((-0.42, -0.2)):
        rod(f"PottingBench_Peg{i}", (x, by + 0.01, bz), (x, by - 0.045, bz + 0.004), 0.008, "wood_dark", r)
    x = -0.42
    rod("PottingBench_RakeGrip", (x, by - 0.03, bz + 0.02), (x, by - 0.03, bz - 0.13), 0.014, "red", r, radius_end=0.012, segments=14)
    tines = [rod("PottingBench_RakeBar", (x - 0.04, by - 0.03, bz - 0.135), (x + 0.04, by - 0.03, bz - 0.135), 0.006, "steel", r)]
    for k, dx in enumerate((-0.035, 0.0, 0.035)):
        pts = [(x + dx, by - 0.03, bz - 0.135), (x + dx, by - 0.032, bz - 0.19), (x + dx, by - 0.05, bz - 0.225), (x + dx, by - 0.075, bz - 0.23)]
        tines.append(_tube(f"PottingBench_Tine{k}", _spline(pts, 4), 0.005, "steel", r, sides=6, radius_end=0.003))
    _join(tines, "PottingBench_RakeHead")
    _trowel("PottingBench_Hung", r, (-0.2, by - 0.03, bz - 0.13), 0, math.radians(-90), handle="sage")
    # A coiled garden hose on a third peg.
    rod("PottingBench_Peg2", (0.42, by + 0.01, bz), (0.42, by - 0.05, bz + 0.004), 0.008, "wood_dark", r)
    coil = [torus(f"PottingBench_Hose{k}", 0.085 - k * 0.004, 0.011, (0.42 + (k - 1) * 0.012, by - 0.026 - k * 0.012, bz - 0.075), "teal", r,
                  upright=True, segments=28, sides=8) for k in range(3)]
    _join(coil, "PottingBench_Hose")

    # Stacked terracotta pots on the lower shelf.
    for i in range(3):
        _pot(f"PottingBench_StackA{i}", 0.058, 0.08, 0.12, (-0.32, 0.02, 0.2 + i * 0.04), "terracotta", r, hollow=True)
    for i in range(2):
        _pot(f"PottingBench_StackB{i}", 0.05, 0.068, 0.1, (-0.08, -0.03, 0.2 + i * 0.035), "terracotta", r, hollow=True)
    lathe("PottingBench_Upturned", [(0, 0), (0.07, 0), (0.07, 0.016), (0.062, 0.02), (0.048, 0.1), (0, 0.1)],
                   "terracotta", r, origin=(0.3, 0.02, 0.2), segments=24)
    box("PottingBench_Sack", (0.2, 0.15, 0.17), (0.0, 0.0, 0.085), "straw", r, radius=0.05, origin=(0.52, 0.02, 0.2))
    blob("PottingBench_SackTop", 0.05, (0, 0, 0.18), (1.7, 1.2, 0.6), "straw", r, origin=(0.52, 0.02, 0.2), subdivisions=2)

    # On the bench: three seedlings, a trowel and seed packets.
    for i, (x, y) in enumerate(((0.18, -0.02), (0.33, 0.06), (0.48, -0.04))):
        _pot(f"PottingBench_Seedling{i}", 0.032, 0.045, 0.07, (x, y, top), "terracotta", r, rim=0.009)
        _sprout(f"PottingBench_Sprout{i}", r, (x, y, top + 0.064), 0.05 + 0.015 * (i % 2), scale=1.0, yaw=0.6 * i)
    _trowel("PottingBench_Trowel", r, (-0.12, -0.1, top + 0.008), math.radians(160), 0, handle="wood_dark")
    for i, (x, y, yaw, tilt) in enumerate(((-0.42, 0.18, 0, 14), (-0.5, -0.08, 22, 90))):
        packet = [
            box(f"PottingBench_Packet{i}", (0.075, 0.004, 0.1), (0, 0, 0.05), "gh_packet", r, radius=0.002, origin=(x, y, top)),
            box(f"PottingBench_PacketBand{i}", (0.075, 0.006, 0.024), (0, 0, 0.088), "leaf" if i else "sunny", r, radius=0.0015, origin=(x, y, top)),
            blob(f"PottingBench_PacketArt{i}", 0.017, (0, -0.003, 0.045), (1, 0.15, 1), "red" if i else "pink", r, origin=(x, y, top), subdivisions=2),
        ]
        for o in packet:
            _rot(o, math.radians(-tilt), "X", about=(0, 0.002, 0))
            _rot(o, math.radians(yaw), "Z")
    return r


def build_watering_can():
    r = root("WateringCan")
    lathe("WateringCan_Body", [(0, 0), (0.064, 0), (0.07, 0.008), (0.07, 0.108), (0.062, 0.12), (0.03, 0.126), (0, 0.126)], "sage", r, segments=32)
    cyl("WateringCan_Band", 0.073, 0.073, 0.014, (0, 0, 0.008), "steel", r, radius=0.004, segments=32)
    cyl("WateringCan_Fill", 0.028, 0.026, 0.022, (0, 0.03, 0.118), "sage", r, radius=0.004, segments=20)
    cyl("WateringCan_Hole", 0.02, 0.02, 0.002, (0, 0.03, 0.14), "charcoal", r, segments=20)
    tip = Vector((0, -0.165, 0.155))
    rod("WateringCan_Spout", (0, -0.04, 0.035), tuple(tip), 0.014, "sage", r, radius_end=0.008, segments=14)
    axis = (tip - Vector((0, -0.04, 0.035))).normalized()
    rod("WateringCan_Rose", tuple(tip - axis * 0.004), tuple(tip + axis * 0.024), 0.009, "steel", r, radius_end=0.024, segments=18)
    arch = _spline([(0, -0.045, 0.118), (0, -0.02, 0.185), (0, 0.04, 0.2), (0, 0.075, 0.15), (0, 0.068, 0.11)], 5)
    _tube("WateringCan_Handle", arch, 0.01, "sage", r, sides=10)
    return r


def build_fishing_rod():
    r = root("FishingRod")
    cyl("FishingRod_Butt", 0.017, 0.016, 0.018, (0, 0, -0.1), "charcoal", r, radius=0.005, segments=16)
    cyl("FishingRod_Grip", 0.015, 0.012, 0.14, (0, 0, -0.082), "wood", r, radius=0.004, segments=16)
    cyl("FishingRod_Seat", 0.011, 0.011, 0.04, (0, 0, 0.055), "steel", r, segments=14)
    tip = (0, -0.07, 0.5)
    shaft = _spline([(0, 0, 0.09), (0, -0.004, 0.3), (0, -0.03, 0.43), tip], 6)
    _tube("FishingRod_Shaft", shaft, 0.0065, "navy", r, sides=8, radius_end=0.0028)
    blob("FishingRod_Tip", 0.005, tip, (1, 1, 1), "red", r, subdivisions=1)
    # The reel hangs in front of the grip.
    rod("FishingRod_ReelStem", (0, -0.008, 0.075), (0, -0.03, 0.075), 0.005, "charcoal", r)
    rod("FishingRod_Spool", (-0.012, -0.045, 0.075), (0.012, -0.045, 0.075), 0.022, "charcoal", r, segments=20)
    rod("FishingRod_SpoolFace", (0.011, -0.045, 0.075), (0.016, -0.045, 0.075), 0.017, "steel", r, segments=20)
    rod("FishingRod_Crank", (0.016, -0.045, 0.075), (0.022, -0.045, 0.06), 0.0035, "steel", r)
    blob("FishingRod_Knob", 0.006, (0.026, -0.045, 0.058), (1, 1, 1), "wood_dark", r, subdivisions=1)
    # The line hangs from the tip; its origin is at the tip so it can be swung back to vertical.
    line = rod("FishingRod_Line", (0, 0, 0), (0, 0, -0.3), 0.0016, "white", r, origin=tip, segments=6)
    lathe("FishingRod_BobberTop", [(0.02, 0), (0.017, 0.01), (0.01, 0.017), (0, 0.02)], "red", line, origin=(0, 0, -0.32), segments=18)
    lathe("FishingRod_BobberBottom", [(0, -0.02), (0.01, -0.017), (0.017, -0.01), (0.02, 0)], "white", line, origin=(0, 0, -0.32), segments=18)
    return r


def _pad(name, radius, center, yaw, mat, parent, notch=0.5, thick=0.006):
    """A lily pad: a disc with a wedge cut out, lying flat."""
    cx, cy, cz = center
    seg = 20
    top, bot = [], []
    verts = [(cx, cy, cz + thick), (cx, cy, cz)]
    for i in range(seg + 1):
        a = yaw + notch / 2 + i / seg * (math.tau - notch)
        x, y = cx + math.cos(a) * radius, cy + math.sin(a) * radius
        top.append(len(verts))
        verts.append((x, y, cz + thick))
        bot.append(len(verts))
        verts.append((x, y, cz))
    faces = []
    for i in range(seg):
        faces.append((0, top[i], top[i + 1]))
        faces.append((1, bot[i + 1], bot[i]))
        faces.append((top[i], bot[i], bot[i + 1], top[i + 1]))
    faces.append((0, 1, bot[0], top[0]))
    faces.append((0, top[-1], bot[-1], 1))
    return mesh(name, verts, faces, mat, parent, smooth=False)


def _koi(i, parent, radius, angle, body, spots):
    """A koi whose pivot is the pond center, facing counterclockwise along its circle."""
    fish = lathe(f"KoiPond_Fish{i}", [(0, 0), (0.012, 0.006), (0.02, 0.022), (0.021, 0.04), (0.016, 0.07), (0.008, 0.095), (0, 0.1)], body, parent,
                 segments=16)
    # The lathe runs along Z from the nose; lay it along +X and flatten it a little.
    fish.data.transform(Matrix.Diagonal((1, 1, 0.75, 1)) @ Matrix.Rotation(math.radians(-90), 4, "Y") @ Matrix.Translation((0, 0, -0.05)))
    tail = [
        _leaf(f"KoiPond_Tail{i}{k}", 0.05, 0.03, spots, fish, base=(-0.04, 0, 0.002), yaw=math.radians(180 + s * 22), pitch=math.radians(4),
              thick=0.003, fold=0.0, rows=5, sides=6)
        for k, s in enumerate((-1, 1))
    ]
    _join(tail, f"KoiPond_Tail{i}")
    fins = [
        _leaf(f"KoiPond_Fin{i}{k}", 0.026, 0.018, spots, fish, base=(0.022, s * 0.012, -0.004), yaw=math.radians(180 - s * 55), pitch=0,
              thick=0.002, fold=0.0, rows=4, sides=6)
        for k, s in enumerate((-1, 1))
    ]
    _join(fins, f"KoiPond_Fins{i}")
    marks = [
        blob(f"KoiPond_Spot{i}a", 0.017, (0.02, 0.0, 0.011), (1.3, 0.85, 0.35), spots, fish, subdivisions=2),
        blob(f"KoiPond_Spot{i}b", 0.014, (-0.02, 0.003, 0.009), (1.2, 0.8, 0.35), spots, fish, subdivisions=2),
    ]
    _join(marks, f"KoiPond_Spots{i}")
    eyes = [blob(f"KoiPond_Eye{i}{k}", 0.0035, (0.037, s * 0.013, 0.005), (1, 1, 1), "eye", fish, subdivisions=1) for k, s in enumerate((-1, 1))]
    _join(eyes, f"KoiPond_Eyes{i}")
    m = Matrix.Rotation(angle, 4, "Z") @ Matrix.Translation((radius, 0, 0.047)) @ Matrix.Rotation(math.radians(90), 4, "Z")
    _xf([fish, *fish.children], m)
    return fish


def build_koi_pond():
    r = root("KoiPond")
    cyl("KoiPond_Floor", 0.82, 0.82, 0.012, (0, 0, 0), "gh_pond", r, segments=48)
    cyl("KoiPond_Water", 0.8, 0.8, 0.006, (0, 0, 0.044), material("water", alpha=0.72), r, segments=48)
    pebbles = []
    for i, (a, d, s) in enumerate(((0.4, 0.55, 0.05), (1.9, 0.62, 0.04), (3.3, 0.5, 0.045), (4.6, 0.6, 0.05), (5.6, 0.2, 0.04))):
        pebbles.append(blob(f"KoiPond_Pebble{i}", s, (math.cos(a) * d, math.sin(a) * d, 0.012), (1.3, 1, 0.45), "stone_dark", r, subdivisions=1))
    _join(pebbles, "KoiPond_Pebbles")
    stones = {0: [], 1: []}
    n = 14
    for i in range(n):
        a = i / n * math.tau + 0.06 * math.sin(i * 2.3)
        k = 1 if i % 3 == 1 else 0
        length = 0.34 + 0.04 * math.sin(i * 1.7)
        depth = 0.2 + 0.025 * math.cos(i * 2.9)
        height = 0.115 + 0.015 * math.sin(i * 3.1)
        rad = 0.85 + 0.015 * math.cos(i * 1.3)
        s = blob(f"KoiPond_Stone{i}", 0.5, (0, 0, 0), (length, depth, height), "stone_dark" if k else "stone", r,
                 origin=(math.cos(a) * rad, math.sin(a) * rad, height / 2), subdivisions=2)
        _rot(s, a + math.pi / 2, "Z")
        stones[k].append(s)
    _join(stones[0], "KoiPond_Stones")
    _join(stones[1], "KoiPond_StonesDark")
    pads = []
    for i, (a, d, pr) in enumerate(((math.radians(110), 0.6, 0.1), (math.radians(160), 0.63, 0.075), (math.radians(318), 0.6, 0.095))):
        pads.append(_pad(f"KoiPond_Pad{i}", pr, (math.cos(a) * d, math.sin(a) * d, 0.049), a + 2.0, "leaf", r))
    _join(pads, "KoiPond_Pads")
    fx, fy = math.cos(math.radians(318)) * 0.6, math.sin(math.radians(318)) * 0.6
    petals = []
    for k in range(6):
        petals.append(_leaf(f"KoiPond_Petal{k}", 0.05, 0.026, "pink", r, base=(fx, fy, 0.056), yaw=k * math.tau / 6, pitch=math.radians(30),
                            curl=0.3, rows=5, sides=6))
    for k in range(4):
        petals.append(_leaf(f"KoiPond_PetalIn{k}", 0.04, 0.022, "pink", r, base=(fx, fy, 0.058), yaw=k * math.tau / 4 + 0.5,
                            pitch=math.radians(62), curl=0.2, rows=5, sides=6))
    _join(petals, "KoiPond_Flower")
    blob("KoiPond_FlowerHeart", 0.012, (fx, fy, 0.066), (1, 1, 0.7), "sunny", r, subdivisions=2)
    _koi(0, r, 0.45, math.radians(245), "gh_koi", "white")
    _koi(1, r, 0.3, math.radians(35), "white", "gh_koi")
    return r


def build_tea_table():
    r = root("TeaTable")
    cyl("TeaTable_Top", 0.28, 0.28, 0.04, (0, 0, 0.36), "wood", r, radius=0.012, segments=40)
    cyl("TeaTable_Post", 0.035, 0.04, 0.32, (0, 0, 0.04), "wood_dark", r, segments=20)
    lathe("TeaTable_Base", [(0, 0), (0.15, 0), (0.15, 0.015), (0.12, 0.035), (0.05, 0.05), (0, 0.05)], "wood_dark", r, segments=32)
    # The teapot.
    lathe("TeaTable_Pot", [(0, 0), (0.04, 0), (0.056, 0.016), (0.062, 0.038), (0.056, 0.062), (0.04, 0.076), (0.03, 0.078), (0, 0.078)], "white", r,
          origin=(0, 0, 0.4), segments=28)
    lathe("TeaTable_Lid", [(0, 0), (0.034, 0), (0.03, 0.012), (0.015, 0.02), (0, 0.022)], "sage", r, origin=(0, 0, 0.475), segments=24)
    blob("TeaTable_Knob", 0.011, (0, 0, 0.5), (1, 1, 0.9), "sage", r, subdivisions=2)
    _tube("TeaTable_Spout", _spline([(-0.045, 0, 0.425), (-0.075, 0, 0.44), (-0.092, 0, 0.47), (-0.1, 0, 0.485)], 4), 0.012, "white", r,
          sides=10, radius_end=0.007)
    _tube("TeaTable_Handle", _spline([(0.05, 0, 0.465), (0.085, 0, 0.47), (0.095, 0, 0.44), (0.075, 0, 0.42), (0.055, 0, 0.418)], 4), 0.008,
          "white", r, sides=8)
    for i, sx in enumerate((-1, 1)):
        x = sx * 0.19
        cyl(f"TeaTable_Saucer{i}", 0.048, 0.04, 0.007, (x, 0.02, 0.4), "sage", r, radius=0.003, segments=24)
        lathe(f"TeaTable_Cup{i}", [(0, 0), (0.024, 0), (0.033, 0.034), (0.035, 0.038), (0.03, 0.038), (0.022, 0.006), (0, 0.006)], "white", r,
              origin=(x, 0.02, 0.407), segments=24)
        cyl(f"TeaTable_Tea{i}", 0.03, 0.03, 0.003, (x, 0.02, 0.437), "gh_tea", r, segments=20)
        _tube(f"TeaTable_CupHandle{i}", _spline([(x, -0.008, 0.437), (x, -0.024, 0.433), (x, -0.025, 0.418), (x, -0.012, 0.414)], 3), 0.0045,
              "white", r, sides=6)
    return r


def build_stool():
    r = root("Stool")
    cyl("Stool_Seat", 0.17, 0.165, 0.035, (0, 0, 0.225), "wood", r, radius=0.01, segments=36)
    lathe("Stool_Cushion", [(0, 0.255), (0.15, 0.255), (0.163, 0.266), (0.163, 0.284), (0.15, 0.297), (0.08, 0.3), (0, 0.299)], "sage", r,
          segments=36)
    blob("Stool_Button", 0.012, (0, 0, 0.297), (1, 1, 0.5), "moss", r, subdivisions=2)
    legs = []
    for i in range(4):
        a = i * math.tau / 4 + math.pi / 4
        legs.append(rod(f"Stool_Leg{i}", (math.cos(a) * 0.1, math.sin(a) * 0.1, 0.23), (math.cos(a) * 0.14, math.sin(a) * 0.14, 0.0), 0.017,
                        "wood_dark", r, radius_end=0.014))
    _join(legs, "Stool_Legs")
    torus("Stool_Ring", 0.124, 0.009, (0, 0, 0.09), "wood_dark", r, segments=32, sides=8)
    return r


def build_fig_tree():
    r = root("FigTree")
    box("FigTree_Planter", (0.53, 0.53, 0.4), (0, 0, 0.2), "terracotta", r, radius=0.03)
    box("FigTree_Rim", (0.55, 0.55, 0.07), (0, 0, 0.415), "terracotta", r, radius=0.025)
    box("FigTree_Band", (0.535, 0.535, 0.035), (0, 0, 0.05), "pot", r, radius=0.012)
    box("FigTree_Soil", (0.47, 0.47, 0.02), (0, 0, 0.44), "coffee", r, radius=0.006)
    wood = [
        _tube("FigTree_Trunk", _spline([(0, 0, 0.42), (0.02, 0.0, 0.75), (-0.015, 0.01, 1.05), (0.0, 0.0, 1.4)], 5), 0.045, "wood_dark", r,
              sides=10, radius_end=0.022),
        _tube("FigTree_Branch0", _spline([(0.01, 0, 0.98), (0.12, 0.03, 1.15), (0.2, 0.05, 1.33)], 4), 0.022, "wood_dark", r, sides=8,
              radius_end=0.012),
        _tube("FigTree_Branch1", _spline([(-0.01, 0.0, 1.08), (-0.12, -0.04, 1.22), (-0.2, -0.07, 1.4)], 4), 0.02, "wood_dark", r, sides=8,
              radius_end=0.012),
    ]
    _join(wood, "FigTree_Wood")
    canopy = (
        (0.0, 0.0, 1.68, 0.32, "leaf"),
        (0.26, 0.08, 1.48, 0.25, "leaf_dark"),
        (-0.26, -0.05, 1.5, 0.26, "leaf"),
        (0.07, -0.26, 1.46, 0.24, "leaf_dark"),
        (-0.07, 0.26, 1.52, 0.24, "moss"),
        (0.2, -0.13, 1.78, 0.21, "moss"),
        (-0.15, 0.11, 1.82, 0.21, "leaf_dark"),
    )
    groups = {}
    for i, (x, y, z, s, m) in enumerate(canopy):
        groups.setdefault(m, []).append(_ball(f"FigTree_Leaf{i}", s, (x, y, z), (1, 1, 0.9), m, r))
    for m, objs in groups.items():
        _join(objs, f"FigTree_Canopy_{m}")
    return r


def _sheet(name, x0, x1, y0, y1, nx, ny, surface, thick, mat, parent, origin=(0, 0, 0)):
    """A thick cloth patch: `surface(x, y)` gives the top height; the patch hangs `thick` below it."""
    verts, faces = [], []

    def vid(layer, i, j):
        return layer * (nx + 1) * (ny + 1) + i * (ny + 1) + j

    for layer, off in ((0, 0.0), (1, -thick)):
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            for j in range(ny + 1):
                y = y0 + (y1 - y0) * j / ny
                px, py, pz = surface(x, y)
                verts.append((px, py, pz + off))
    for i in range(nx):
        for j in range(ny):
            faces.append((vid(0, i, j), vid(0, i + 1, j), vid(0, i + 1, j + 1), vid(0, i, j + 1)))
            faces.append((vid(1, i, j), vid(1, i, j + 1), vid(1, i + 1, j + 1), vid(1, i + 1, j)))
    for i in range(nx):
        faces.append((vid(0, i, 0), vid(1, i, 0), vid(1, i + 1, 0), vid(0, i + 1, 0)))
        faces.append((vid(0, i, ny), vid(0, i + 1, ny), vid(1, i + 1, ny), vid(1, i, ny)))
    for j in range(ny):
        faces.append((vid(0, 0, j), vid(0, 0, j + 1), vid(1, 0, j + 1), vid(1, 0, j)))
        faces.append((vid(0, nx, j), vid(1, nx, j), vid(1, nx, j + 1), vid(0, nx, j + 1)))
    return mesh(name, verts, faces, mat, parent, origin=origin, smooth=True)


def build_hammock():
    r = root("Hammock")
    px, top = 0.95, 1.0
    frame = []
    for i, sx in enumerate((-1, 1)):
        x = sx * px
        frame.append(box(f"Hammock_Post{i}", (0.05, 0.06, top - 0.05), (x, 0, 0.05 + (top - 0.05) / 2), "wood_dark", r, radius=0.012))
        frame.append(box(f"Hammock_Foot{i}", (0.07, 0.55, 0.06), (x, 0, 0.03), "wood_dark", r, radius=0.015))
        for k, sy in enumerate((-1, 1)):
            frame.append(rod(f"Hammock_Brace{i}{k}", (x, sy * 0.2, 0.05), (x, sy * 0.02, 0.32), 0.014, "wood_dark", r))
    _join(frame, "Hammock_Frame")
    caps = [blob(f"Hammock_Cap{i}", 0.033, (sx * px, 0, top), (1, 1, 0.6), "wood", r, subdivisions=2) for i, sx in enumerate((-1, 1))]
    _join(caps, "Hammock_Caps")

    # The bed rocks about X on the line between the post tops.
    pivot_z = 0.95
    half, low, end_z = 0.72, 0.42, 0.8

    def surface(x, y):
        u = x / half
        sag = 1 - u * u
        z = low + (end_z - low) * u * u + 0.075 * sag * (y / 0.25) ** 2
        return x, y * (1 - 0.1 * sag), z - pivot_z

    bed = _sheet("Hammock_Bed", -half, half, -0.25, 0.25, 24, 12, surface, 0.014, "cream", r, origin=(0, 0, pivot_z))
    edges = [-0.25 + k * 0.5 / 7 for k in range(8)]
    for k in (1, 3, 5):
        y0, y1 = edges[k], edges[k + 1]

        def thick_surface(x, y):
            sx_, sy_, sz_ = surface(x, y)
            return sx_, sy_, sz_ + 0.003

        _sheet(f"Hammock_Stripe{k}", -half, half, y0, y1, 24, 2, thick_surface, 0.02, "teal", bed)
    bars = []
    ropes = []
    for i, sx in enumerate((-1, 1)):
        bx = sx * (half + 0.015)
        bz = end_z - pivot_z - 0.004
        bars.append(rod(f"Hammock_Spreader{i}", (bx, -0.29, bz), (bx, 0.29, bz), 0.016, "wood", bed, segments=12))
        ring = (sx * (px - 0.045), 0, 0.0)
        for k, y in enumerate((-0.24, -0.12, 0.0, 0.12, 0.24)):
            ropes.append(rod(f"Hammock_Rope{i}{k}", (bx, y, bz), ring, 0.0045, "gh_rope", bed, segments=6))
    _join(bars, "Hammock_Spreaders")
    _join(ropes, "Hammock_Ropes")
    rings = [torus(f"Hammock_Ring{i}", 0.02, 0.006, (sx * (px - 0.04), 0, 0.0), "steel", bed, upright=True, segments=16, sides=6)
             for i, sx in enumerate((-1, 1))]
    _join(rings, "Hammock_Rings")
    # A pillow at -X, settled into the slope.
    x = -0.5
    _, _, sz = surface(x, 0)
    slope = 2 * (end_z - low) * x / half**2
    ang = math.atan(-slope)
    nrm = Vector((-slope, 0, 1)).normalized()
    c = Vector((x, 0, sz)) + nrm * 0.03
    pillow = box("Hammock_Pillow", (0.15, 0.34, 0.07), (0, 0, 0), "mustard", bed, radius=0.032, origin=tuple(c), segments=4)
    _rot(pillow, ang, "Y")
    return r


def build_garden_bench():
    r = root("GardenBench")
    seat_z = 0.4
    slats = []
    for i in range(4):
        y = -0.18 + i * 0.1
        slats.append(box(f"GardenBench_Slat{i}", (1.06, 0.085, 0.035), (0, y, seat_z - 0.0175), "wood", r, radius=0.01))
    back = []
    for i, z in enumerate((0.5, 0.62, 0.74)):
        b = box(f"GardenBench_Back{i}", (1.06, 0.03, 0.09), (0, 0, 0), "wood", r, radius=0.01, origin=(0, 0.175 + (z - 0.5) * 0.12, z))
        _rot(b, math.radians(-8), "X")
        back.append(b)
    _join(slats, "GardenBench_Seat")
    _join(back, "GardenBench_Backrest")
    for side, sx in (("L", -1), ("R", 1)):
        x = sx * 0.53
        parts = []

        def iron(name, yz, rad=0.016, sm=4):
            pts = _spline(yz, sm) if len(yz) > 2 else yz
            parts.append(_tube(f"GardenBench_{side}{name}", [(x, y, z) for y, z in pts], rad, "charcoal", r, sides=8))

        iron("FrontLeg", [(-0.17, 0.0), (-0.175, 0.3), (-0.17, 0.6)])
        iron("BackLeg", [(0.16, 0.0), (0.165, 0.2), (0.18, 0.45), (0.215, 0.86)])
        iron("Rail", [(-0.2, seat_z - 0.04), (0.18, seat_z - 0.04)], 0.014)
        iron("Arm", [(-0.21, 0.6), (-0.05, 0.615), (0.19, 0.62)], 0.017)
        iron("ArmCurl", _scroll(-0.195, 0.565, 0.045, 0.9, math.radians(90), 1), 0.012, 1)
        iron("SeatCurl0", _scroll(-0.09, 0.22, 0.07, 1.1, math.radians(150), -1), 0.011, 1)
        iron("SeatCurl1", _scroll(0.07, 0.22, 0.07, 1.1, math.radians(30), 1), 0.011, 1)
        parts.append(blob(f"GardenBench_{side}Finial", 0.024, (x, 0.215, 0.87), (1, 1, 1), "charcoal", r, subdivisions=2))
        for k, y in enumerate((-0.17, 0.16)):
            parts.append(blob(f"GardenBench_{side}Foot{k}", 0.028, (x, y, 0.012), (1, 1.3, 0.45), "charcoal", r, subdivisions=2))
        _join(parts, f"GardenBench_Side{side}")
    return r


def build_hanging_plant():
    r = root("HangingPlant")
    iron = [
        box("HangingPlant_Plate", (0.05, 0.012, 0.13), (0, -0.006, -0.035), "charcoal", r, radius=0.006),
        rod("HangingPlant_Arm", (0, -0.006, 0.0), (0, -0.25, 0.0), 0.009, "charcoal", r),
        rod("HangingPlant_Strut", (0, -0.006, -0.09), (0, -0.15, -0.004), 0.007, "charcoal", r),
        _tube("HangingPlant_Curl", [(0, y, z) for y, z in _scroll(-0.07, -0.035, 0.03, 1.0, math.radians(200), -1)], 0.006, "charcoal", r, sides=6),
        _tube("HangingPlant_TipCurl", [(0, y, z) for y, z in _scroll(-0.262, 0.012, 0.014, 0.8, math.radians(-90), 1)], 0.007, "charcoal", r, sides=6),
    ]
    _join(iron, "HangingPlant_Bracket")
    hook = (0, -0.24, -0.008)
    knot = (0, -0.24, -0.12)
    ropes = [rod("HangingPlant_Rope", hook, knot, 0.004, "gh_rope", r, segments=6)]
    for k in range(3):
        a = math.radians(90 + k * 120)
        ropes.append(rod(f"HangingPlant_Rope{k}", knot, (math.cos(a) * 0.115, -0.24 + math.sin(a) * 0.115, -0.25), 0.0035, "gh_rope", r, segments=6))
    _join(ropes, "HangingPlant_Ropes")
    blob("HangingPlant_Knot", 0.012, knot, (1, 1, 1.3), "gh_rope", r, subdivisions=1)
    _pot("HangingPlant_Pot", 0.085, 0.12, 0.16, (0, -0.24, -0.41), "white", r, rim=0.014)
    mound = []
    for i, (x, y, z, s) in enumerate(((0, -0.24, -0.24, 0.085), (0.07, -0.21, -0.255, 0.06), (-0.07, -0.27, -0.255, 0.065), (0.02, -0.31, -0.25, 0.06),
                                      (-0.04, -0.18, -0.25, 0.055))):
        mound.append(blob(f"HangingPlant_Bush{i}", s, (x, y, z), (1, 1, 0.75), "leaf", r, subdivisions=2))
    _join(mound, "HangingPlant_Bush")
    vines, leaves_a, leaves_b = [], [], []
    for v, (a, length) in enumerate(((200, 0.46), (250, 0.34), (300, 0.44), (340, 0.28), (20, 0.36), (160, 0.3))):
        ang = math.radians(a)
        sx, sy = math.cos(ang) * 0.125, -0.24 + math.sin(ang) * 0.125
        out = 0.05
        pts = [(sx, sy, -0.255), (sx + math.cos(ang) * out, sy + math.sin(ang) * out, -0.3), (sx + math.cos(ang) * out * 1.2, sy + math.sin(ang) * out * 1.2,
                                                                                               -0.255 - length * 0.6),
               (sx + math.cos(ang) * out * 0.9 + 0.01, sy + math.sin(ang) * out * 0.9, -0.255 - length)]
        curve = _spline(pts, 5)
        vines.append(_tube(f"HangingPlant_Vine{v}", curve, 0.004, "leaf_dark", r, sides=5))
        for k in range(1, len(curve), 3):
            p = curve[k]
            side = 1 if k % 2 else -1
            yaw = ang + side * 1.2
            leaf = _leaf(f"HangingPlant_VineLeaf{v}_{k}", 0.045, 0.034, "leaf" if (k + v) % 2 else "leaf_dark", r, base=tuple(p), yaw=yaw,
                         pitch=math.radians(-35), thick=0.006, fold=0.2, rows=5, sides=6)
            (leaves_a if (k + v) % 2 else leaves_b).append(leaf)
    _join(vines, "HangingPlant_Vines")
    _join(leaves_a, "HangingPlant_Leaves")
    _join(leaves_b, "HangingPlant_LeavesDark")
    return r


def build_tortoise():
    r = root("Tortoise")
    a, b, c, z0 = 0.17, 0.175, 0.115, 0.045
    prof = [(a * math.cos(t), z0 + c * math.sin(t)) for t in (math.radians(d) for d in (0, 15, 30, 45, 60, 72, 84))] + [(0, z0 + c)]
    shell = lathe("Tortoise_Shell", [(a * 0.96, z0 - 0.004), *prof], "gh_shell", r, segments=36)
    shell.data.transform(Matrix.Diagonal((1, b / a, 1, 1)))
    torus("Tortoise_Rim", 0.162, 0.016, (0, 0, z0 + 0.004), "gh_shell_dark", r, segments=36, sides=8).data.transform(Matrix.Diagonal((1, b / a, 1, 1)))
    blob("Tortoise_Belly", 0.15, (0, 0, 0.05), (1, 1.1, 0.2), "gh_skin", r, subdivisions=2)
    plates = []
    spots = [(math.radians(90), 0.0)] + [(math.radians(42), k * math.tau / 6 + math.pi / 6) for k in range(6)]
    for i, (el, az) in enumerate(spots):
        p = Vector((a * math.cos(el) * math.cos(az), b * math.cos(el) * math.sin(az), z0 + c * math.sin(el)))
        n = Vector(((p.x) / a**2, (p.y) / b**2, (p.z - z0) / c**2)).normalized()
        size = 0.05 if i == 0 else 0.042
        plate = cyl(f"Tortoise_Plate{i}", size, size * 0.9, 0.014, (0, 0, -0.008), "gh_shell_dark", r, radius=0.004, origin=tuple(p), segments=6)
        plate.data.transform(Matrix.Rotation(az + math.pi / 6, 4, "Z"))
        plate.data.transform(Vector((0, 0, 1)).rotation_difference(n).to_matrix().to_4x4())
        plates.append(plate)
    _join(plates, "Tortoise_Plates")

    neck = (0, -0.14, 0.07)
    head = _tube("Tortoise_Head", [(0, 0.03, -0.012), (0, -0.015, 0.0), (0, -0.04, 0.02)], 0.03, "gh_skin", r, origin=neck, sides=10)
    blob("Tortoise_Skull", 0.047, (0, -0.062, 0.034), (0.98, 1.1, 0.9), "gh_skin", head, subdivisions=2)
    eyes = [blob(f"Tortoise_Eye{k}", 0.009, (s * 0.027, -0.095, 0.052), (1, 0.8, 1.25), "eye", head, subdivisions=2) for k, s in enumerate((-1, 1))]
    _join(eyes, "Tortoise_Eyes")
    for name, x, y in (("FL", -0.12, -0.09), ("FR", 0.12, -0.09), ("BL", -0.12, 0.1), ("BR", 0.12, 0.1)):
        sx = 1 if x > 0 else -1
        hip = (x, y, 0.07)
        foot = (sx * 0.036, -0.012 if y < 0 else 0.012, -0.056)
        leg = rod(f"Tortoise_Leg{name}", (0, 0, 0.0), foot, 0.03, "gh_skin", r, origin=hip, radius_end=0.033, segments=14)
        blob(f"Tortoise_Toes{name}", 0.034, (foot[0], foot[1] * 1.6, -0.06), (1.0, 1.15, 0.3), "gh_skin", leg, subdivisions=2)
    rod("Tortoise_Tail", (0, 0.16, 0.06), (0, 0.195, 0.042), 0.014, "gh_skin", r, radius_end=0.003, segments=8)
    return r


def build_hat_sprout():
    r = root("Hat_Sprout")
    blob("Hat_Sprout_Base", 0.02, (0, 0, 0.004), (1, 1, 0.45), "leaf_dark", r, subdivisions=2)
    _tube("Hat_Sprout_Stem", _spline([(0, 0, 0.0), (0.004, 0, 0.04), (-0.002, 0, 0.08), (0, 0, 0.092)], 4), 0.008, "leaf_dark", r, sides=8,
          radius_end=0.006)
    leaves = [
        _leaf(f"Hat_Sprout_Leaf{i}", 0.08, 0.046, "leaf", r, base=(0, 0, 0.088), yaw=yaw, pitch=math.radians(28), curl=0.35, thick=0.009,
              fold=0.25, rows=9, sides=10)
        for i, yaw in enumerate((0, math.pi))
    ]
    _join(leaves, "Hat_Sprout_Leaves")
    return r


def _ribbed(name, radius, bottom, top, mat, parent, origin=(0, 0, 0), ribs=8, depth=0.08, rings=8, segments=24):
    """A cactus column: ribbed cylinder with a domed top."""
    verts, faces = [], []
    h = top - bottom - radius
    zs = [bottom + h * k / 3 for k in range(4)] + [bottom + h + radius * math.sin(math.radians(d)) for d in (25, 50, 70, 85)]
    scales = [1, 1, 1, 1] + [math.cos(math.radians(d)) for d in (25, 50, 70, 85)]
    for z, s in zip(zs, scales):
        for j in range(segments):
            a = j / segments * math.tau
            rr = radius * s * (1 + depth * math.cos(ribs * a))
            verts.append((math.cos(a) * rr, math.sin(a) * rr, z))
    n = len(zs)
    for k in range(n - 1):
        for j in range(segments):
            j2 = (j + 1) % segments
            faces.append((k * segments + j, k * segments + j2, (k + 1) * segments + j2, (k + 1) * segments + j))
    apex = len(verts)
    verts.append((0, 0, top))
    for j in range(segments):
        faces.append(((n - 1) * segments + j, (n - 1) * segments + (j + 1) % segments, apex))
    faces.append(tuple(range(segments))[::-1])
    return mesh(name, verts, faces, mat, parent, origin=origin, smooth=True)


def build_cactus():
    r = root("Cactus")
    _pot("Cactus_Pot", 0.03, 0.04, 0.048, (0, 0, 0), "terracotta", r, rim=0.008, segments=20)
    body = [
        _ribbed("Cactus_Column", 0.021, 0.04, 0.13, "leaf_dark", r),
        _tube("Cactus_ArmR", _spline([(0.012, 0, 0.074), (0.032, 0, 0.074), (0.038, 0, 0.088), (0.038, 0, 0.1)], 3), 0.0105, "leaf_dark", r,
              sides=10),
        blob("Cactus_ArmRTop", 0.0105, (0.038, 0, 0.1), (1, 1, 1), "leaf_dark", r, subdivisions=2),
        _tube("Cactus_ArmL", _spline([(-0.012, 0, 0.064), (-0.028, 0, 0.064), (-0.033, 0, 0.074), (-0.033, 0, 0.082)], 3), 0.009, "leaf_dark", r,
              sides=10),
        blob("Cactus_ArmLTop", 0.009, (-0.033, 0, 0.082), (1, 1, 1), "leaf_dark", r, subdivisions=2),
    ]
    _join(body, "Cactus_Body")
    petals = [blob(f"Cactus_Petal{k}", 0.0065, (math.cos(k * math.tau / 5) * 0.0065, math.sin(k * math.tau / 5) * 0.0065, 0.132), (1, 1, 0.6), "pink",
                   r, subdivisions=1) for k in range(5)]
    _join(petals, "Cactus_Flower")
    blob("Cactus_FlowerHeart", 0.004, (0, 0, 0.135), (1, 1, 0.8), "sunny", r, subdivisions=1)
    return r


def build_succulent():
    r = root("Succulent")
    lathe("Succulent_Pot", [(0, 0), (0.034, 0), (0.038, 0.004), (0.05, 0.028), (0.052, 0.034), (0.046, 0.034), (0.04, 0.026), (0, 0.026)], "white", r,
          segments=28)
    cyl("Succulent_Soil", 0.042, 0.042, 0.004, (0, 0, 0.026), "coffee", r, segments=24)
    outer = [
        _leaf(f"Succulent_Outer{k}", 0.046, 0.026, "sage", r, base=(0, 0, 0.032), yaw=k * math.tau / 5, pitch=math.radians(32), curl=0.25, thick=0.014,
              fold=0.1, rows=6, sides=8)
        for k in range(5)
    ]
    _join(outer, "Succulent_Outer")
    inner = [
        _leaf(f"Succulent_Inner{k}", 0.036, 0.022, "leaf", r, base=(0, 0, 0.034), yaw=k * math.tau / 3 + 0.6, pitch=math.radians(60), curl=0.2,
              thick=0.012, fold=0.1, rows=6, sides=8)
        for k in range(3)
    ]
    _join(inner, "Succulent_Inner")
    blob("Succulent_Bud", 0.009, (0, 0, 0.044), (1, 1, 1.3), "leaf_dark", r, subdivisions=2)
    return r


BUILDERS = [
    build_potting_bench,
    build_watering_can,
    build_fishing_rod,
    build_koi_pond,
    build_tea_table,
    build_stool,
    build_fig_tree,
    build_hammock,
    build_garden_bench,
    build_hanging_plant,
    build_tortoise,
    build_hat_sprout,
    build_cactus,
    build_succulent,
]

"""Assets for the studio theme: ping pong, a robot vacuum and desk trinkets."""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from .core import blob, box, colors, cyl, material, root

colors(
    studio_table=("#3E8F8C", 0.5),
    studio_vacuum_light=("#D97757", 0.4),
    studio_led=("#62D987", 0.3),
    studio_beak=("#F08F3C", 0.5),
)


# ------------------------------------------------------------------ helpers


def _rot(obj, angle, axis="X", about=(0, 0, 0)):
    """Rotates a part's mesh about a point in its own space, leaving its pivot where it is."""
    p = Vector(about)
    obj.data.transform(Matrix.Translation(p) @ Matrix.Rotation(angle, 4, axis) @ Matrix.Translation(-p))
    return obj


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


def _book(prefix, length, width, thick, color, parent, center, orient=None):
    """A closed book lying flat (cover up, spine toward -Y); `orient` turns it about its center."""
    c = 0.004
    cover = _join(
        [
            box(f"{prefix}_CoverT", (length, width, c), (0, 0, thick / 2 - c / 2), color, parent, radius=0.0015, origin=center),
            box(f"{prefix}_CoverB", (length, width, c), (0, 0, -thick / 2 + c / 2), color, parent, radius=0.0015, origin=center),
            box(f"{prefix}_SpineBar", (length, c * 1.5, thick), (0, -width / 2 + c * 0.75, 0), color, parent, radius=0.0015, origin=center),
        ],
        f"{prefix}_Cover",
    )
    pages = box(
        f"{prefix}_Pages",
        (length - 0.007, width - 0.006, thick - 2 * c + 0.001),
        (0, 0.0015, 0),
        "paper",
        parent,
        radius=0.001,
        origin=center,
    )
    parts = [cover, pages]
    if orient is not None:
        for o in parts:
            o.data.transform(orient.to_4x4())
    return parts


# ------------------------------------------------------------------- assets


def build_ping_pong_table():
    r = root("PingPongTable")
    w, d, top = 1.30, 0.74, 0.50
    box("PingPongTable_Top", (w, d, 0.04), (0, 0, top - 0.02), "studio_table", r, radius=0.012)
    box("PingPongTable_Apron", (w - 0.12, d - 0.12, 0.05), (0, 0, top - 0.06), "charcoal", r, radius=0.01)
    # White border lines and the doubles line down the middle.
    lw, lz, inset = 0.018, top + 0.0005, 0.016
    lines = [
        box("PingPongTable_LineN", (w - 2 * inset, lw, 0.004), (0, d / 2 - inset - lw / 2, lz), "white", r, radius=0.0),
        box("PingPongTable_LineS", (w - 2 * inset, lw, 0.004), (0, -d / 2 + inset + lw / 2, lz), "white", r, radius=0.0),
        box("PingPongTable_LineW", (lw, d - 2 * inset, 0.004), (-w / 2 + inset + lw / 2, 0, lz), "white", r, radius=0.0),
        box("PingPongTable_LineE", (lw, d - 2 * inset, 0.004), (w / 2 - inset - lw / 2, 0, lz), "white", r, radius=0.0),
        box("PingPongTable_LineC", (w - 2 * inset, 0.008, 0.004), (0, 0, lz), "white", r, radius=0.0),
    ]
    _join(lines, "PingPongTable_Lines")
    # The net across X = 0, held by clamps whose posts stick out past the sides.
    box("PingPongTable_Net", (0.008, d + 0.04, 0.058), (0, 0, top + 0.031), "white", r, radius=0.002)
    box("PingPongTable_NetTape", (0.016, d + 0.04, 0.012), (0, 0, top + 0.064), "white", r, radius=0.004)
    posts = []
    for i, sy in enumerate((-1, 1)):
        posts.append(box(f"PingPongTable_Post{i}", (0.026, 0.026, 0.11), (0, sy * (d / 2 + 0.035), top + 0.02), "charcoal", r, radius=0.008))
        posts.append(box(f"PingPongTable_Clamp{i}", (0.05, 0.06, 0.06), (0, sy * (d / 2 + 0.012), top - 0.02), "charcoal", r, radius=0.01))
    _join(posts, "PingPongTable_Posts")
    legs = []
    for i, (x, y) in enumerate(((-0.54, -0.26), (0.54, -0.26), (-0.54, 0.26), (0.54, 0.26))):
        legs.append(box(f"PingPongTable_Leg{i}", (0.055, 0.055, top - 0.04), (x, y, (top - 0.04) / 2), "charcoal", r, radius=0.012))
    for i, x in enumerate((-0.54, 0.54)):
        legs.append(box(f"PingPongTable_Brace{i}", (0.035, 0.5, 0.035), (x, 0, 0.14), "charcoal", r, radius=0.01))
    _join(legs, "PingPongTable_Legs")
    feet = [cyl(f"PingPongTable_Foot{i}", 0.04, 0.035, 0.02, (x, y, 0), "slate", r, radius=0.005, segments=16)
            for i, (x, y) in enumerate(((-0.54, -0.26), (0.54, -0.26), (-0.54, 0.26), (0.54, 0.26)))]
    _join(feet, "PingPongTable_Feet")
    return r


def build_paddle():
    r = root("Paddle")
    box("Paddle_Handle", (0.026, 0.021, 0.085), (0, 0, 0.0425), "wood", r, radius=0.009)
    box("Paddle_Throat", (0.036, 0.016, 0.03), (0, 0, 0.075), "wood", r, radius=0.007)
    blade = cyl("Paddle_Blade", 0.055, 0.055, 0.008, (0, 0, -0.004), "wood", r, radius=0.0025, origin=(0, 0, 0.12), segments=32)
    _rot(blade, math.radians(90))
    for i, y in enumerate((-0.0055, 0.0055)):
        rubber = cyl(f"Paddle_Rubber{i}", 0.052, 0.052, 0.003, (0, 0, -0.0015), "red", r, radius=0.001, origin=(0, y, 0.12), segments=32)
        _rot(rubber, math.radians(90))
    return r


def build_held_book():
    r = root("HeldBook")
    # Built flat, then stood up: height along Z, front cover toward -Y, spine at -X.
    stand = Matrix(((0, 1, 0), (0, 0, 1), (1, 0, 0)))
    _book("HeldBook", 0.14, 0.11, 0.03, "teal", r, (0, 0, 0), orient=stand)
    box("HeldBook_Label", (0.055, 0.003, 0.026), (0.006, -0.0155, 0.028), "cream", r, radius=0.001)
    box("HeldBook_Mark", (0.012, 0.003, 0.012), (0.006, -0.0158, 0.028), "clawd", r, radius=0.003)
    return r


def build_robot_vacuum():
    r = root("RobotVacuum")
    cyl("RobotVacuum_Base", 0.18, 0.185, 0.012, (0, 0, 0), "charcoal", r, segments=40)
    cyl("RobotVacuum_Bumper", 0.2, 0.2, 0.038, (0, 0, 0.008), "charcoal", r, radius=0.012, segments=40)
    cyl("RobotVacuum_Shell", 0.188, 0.178, 0.038, (0, 0, 0.026), "white", r, radius=0.016, segments=40)
    cyl("RobotVacuum_Turret", 0.05, 0.046, 0.008, (0, 0.05, 0.06), "white", r, radius=0.004, segments=28)
    cyl("RobotVacuum_Light", 0.032, 0.032, 0.005, (0, 0, 0), "studio_vacuum_light", r, radius=0.002, origin=(0, 0.05, 0.066), segments=28)
    for side, x in (("L", -0.045), ("R", 0.045)):
        blob(f"RobotVacuum_Eye{side}", 0.013, (x, -0.112, 0.063), (0.7, 1.2, 0.4), "eye", r, subdivisions=2)
    brush = [
        box("RobotVacuum_Bristle0", (0.09, 0.008, 0.003), (0, 0, 0), "slate", r, radius=0.0, origin=(-0.13, -0.13, 0.004)),
        box("RobotVacuum_Bristle1", (0.008, 0.09, 0.003), (0, 0, 0), "slate", r, radius=0.0, origin=(-0.13, -0.13, 0.004)),
    ]
    for o in brush:
        _rot(o, math.radians(20), "Z")
    _join(brush, "RobotVacuum_Brush")
    return r


def build_vacuum_dock():
    r = root("VacuumDock")
    box("VacuumDock_Body", (0.36, 0.1, 0.12), (0, 0.02, 0.06), "charcoal", r, radius=0.035, segments=4)
    box("VacuumDock_Ramp", (0.3, 0.07, 0.02), (0, -0.035, 0.01), "charcoal", r, radius=0.008)
    box("VacuumDock_Panel", (0.24, 0.006, 0.05), (0, -0.031, 0.065), "metal", r, radius=0.004)
    for i, x in enumerate((-0.06, 0.06)):
        box(f"VacuumDock_Contact{i}", (0.03, 0.012, 0.006), (x, -0.045, 0.022), "steel", r, radius=0.002)
    blob("VacuumDock_Light", 0.009, (0, -0.034, 0.1), (1, 0.6, 1), material("studio_led", emission=2.0), r, subdivisions=2)
    return r


def build_rubber_duck():
    r = root("RubberDuck")
    blob("RubberDuck_Body", 0.034, (0, 0.006, 0.026), (1.0, 1.25, 0.78), "sunny", r, subdivisions=2)
    blob("RubberDuck_Tail", 0.015, (0, 0.042, 0.042), (0.8, 1.0, 1.0), "sunny", r, subdivisions=2)
    blob("RubberDuck_Head", 0.023, (0, -0.016, 0.06), (1, 1, 1), "sunny", r, subdivisions=2)
    blob("RubberDuck_Beak", 0.012, (0, -0.039, 0.056), (1.15, 1.0, 0.45), "studio_beak", r, subdivisions=2)
    for side, x in (("L", -0.0115), ("R", 0.0115)):
        blob(f"RubberDuck_Eye{side}", 0.0045, (x, -0.034, 0.067), (1, 1, 1.2), "eye", r, subdivisions=1)
        blob(f"RubberDuck_Wing{side}", 0.015, (x * 2.7, 0.01, 0.031), (0.45, 1.2, 0.7), "sunny", r, subdivisions=2)
    return r


def build_photo_frame():
    r = root("PhotoFrame")
    w, h, t, b = 0.10, 0.08, 0.014, 0.012
    parts = [
        box("PhotoFrame_Top", (w, t, b), (0, 0, h - b / 2), "wood", r, radius=0.003),
        box("PhotoFrame_Bottom", (w, t, b), (0, 0, b / 2), "wood", r, radius=0.003),
        box("PhotoFrame_Left", (b, t, h), (-w / 2 + b / 2, 0, h / 2), "wood", r, radius=0.003),
        box("PhotoFrame_Right", (b, t, h), (w / 2 - b / 2, 0, h / 2), "wood", r, radius=0.003),
    ]
    frame = _join(parts, "PhotoFrame_Frame")
    back = box("PhotoFrame_Back", (w - 0.008, 0.004, h - 0.008), (0, t / 2 - 0.002, h / 2), "wood_dark", r, radius=0.001)
    pw, ph = w - 2 * b + 0.002, h - 2 * b + 0.002
    sky = box("PhotoFrame_Sky", (pw, 0.002, ph), (0, 0.001, h / 2), "sky", r, radius=0.0)
    ground = box("PhotoFrame_Ground", (pw, 0.0024, 0.012), (0, 0, b + 0.005), "leaf", r, radius=0.0)
    hill = blob("PhotoFrame_Hill", 0.022, (0.016, 0, b + 0.01), (1, 0.06, 0.5), "leaf", r, subdivisions=2)
    sun = blob("PhotoFrame_Sun", 0.006, (0.026, -0.0005, h - b - 0.01), (1, 0.15, 1), "sunny", r, subdivisions=1)
    clawd = box("PhotoFrame_Clawd", (0.018, 0.003, 0.012), (-0.01, -0.0012, b + 0.016), "clawd", r, radius=0.003)
    # A kickstand behind it, then the whole frame leans back on its bottom back edge.
    stand = box("PhotoFrame_Stand", (0.02, 0.005, 0.06), (0, t / 2 + 0.003, 0.03), "wood_dark", r, radius=0.002)
    _rot(stand, math.radians(28), "X", about=(0, t / 2, 0.055))
    for o in (frame, back, sky, ground, hill, sun, clawd, stand):
        _rot(o, math.radians(-12), "X", about=(0, t / 2, 0))
    return r


def build_book_stack():
    r = root("BookStack")
    books = (
        (0.15, 0.1, 0.022, "red", (0.004, 0.002), 3),
        (0.14, 0.095, 0.025, "mustard", (-0.006, -0.004), -7),
        (0.13, 0.09, 0.02, "teal", (0.008, 0.003), 9),
    )
    z = 0.0
    for i, (length, width, thick, color, (x, y), deg) in enumerate(books):
        _book(f"BookStack_Book{i}", length, width, thick, color, r, (x, y, z + thick / 2), orient=Matrix.Rotation(math.radians(deg), 3, "Z"))
        z += thick + 0.0005
    return r


BUILDERS = [
    build_ping_pong_table,
    build_paddle,
    build_held_book,
    build_robot_vacuum,
    build_vacuum_dock,
    build_rubber_duck,
    build_photo_frame,
    build_book_stack,
]

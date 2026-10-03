"""The original office kit: Clawd, desks and the studio's furniture."""

import math

from .core import blob, box, cyl, material, quad, root


def build_clawd():
    r = root("Clawd")
    body = box("Clawd_Body", (0.62, 0.42, 0.40), (0, 0, 0.20), "clawd", r, radius=0.085, origin=(0, 0, 0.12), segments=5)
    for side, x in (("L", -0.135), ("R", 0.135)):
        box(f"Clawd_Eye{side}", (0.062, 0.03, 0.115), (0, 0, 0), "eye", body, radius=0.028, origin=(x, -0.212, 0.245))
    for side, sx in (("L", -1), ("R", 1)):
        box(
            f"Clawd_Arm{side}",
            (0.15, 0.13, 0.115),
            (sx * 0.06, 0, 0),
            "clawd",
            body,
            radius=0.045,
            origin=(sx * 0.30, 0, 0.17),
            segments=4,
        )
    for name, x, y in (("FL", -0.20, -0.105), ("FR", 0.20, -0.105), ("BL", -0.20, 0.105), ("BR", 0.20, 0.105)):
        box(f"Clawd_Leg{name}", (0.095, 0.095, 0.16), (0, 0, -0.07), "clawd", r, radius=0.035, origin=(x, y, 0.15))
    return r


def build_desk():
    r = root("Desk")
    box("Desk_Top", (1.30, 0.70, 0.055), (0, 0, 0.5925), "wood", r, radius=0.022)
    for i, (x, y) in enumerate(((-0.58, -0.28), (0.58, -0.28), (-0.58, 0.28), (0.58, 0.28))):
        box(f"Desk_Leg{i}", (0.06, 0.06, 0.57), (x, y, 0.285), "white", r, radius=0.015)
    box("Desk_Drawer", (0.34, 0.5, 0.16), (0.40, 0.02, 0.475), "white", r, radius=0.02)
    box("Desk_Handle", (0.12, 0.02, 0.02), (0.40, -0.24, 0.475), "wood_dark", r, radius=0.008)
    return r


def build_chair():
    r = root("Chair")
    cyl("Chair_Base", 0.21, 0.19, 0.035, (0, 0, 0), "white", r, radius=0.012)
    cyl("Chair_Post", 0.03, 0.03, 0.30, (0, 0, 0.03), "steel", r)
    box("Chair_Seat", (0.52, 0.48, 0.09), (0, 0, 0.355), "slate", r, radius=0.04, segments=4)
    box("Chair_Back", (0.48, 0.07, 0.34), (0, 0.235, 0.60), "slate", r, radius=0.032, segments=4)
    box("Chair_Spine", (0.06, 0.035, 0.22), (0, 0.262, 0.44), "white", r, radius=0.012)
    return r


def build_monitor():
    r = root("Monitor")
    box("Monitor_Base", (0.24, 0.16, 0.022), (0, 0, 0.011), "white", r, radius=0.01)
    box("Monitor_Neck", (0.045, 0.035, 0.15), (0, 0.02, 0.09), "white", r, radius=0.01)
    w, h, t, d = 0.58, 0.38, 0.03, 0.04
    cz = 0.16 + h / 2
    # A bezel around a solid back, with the screen recessed into the front.
    box("Monitor_BezelT", (w, d, t), (0, 0, cz + h / 2 - t / 2), "white", r, radius=0.012)
    box("Monitor_BezelB", (w, d, t), (0, 0, cz - h / 2 + t / 2), "white", r, radius=0.012)
    box("Monitor_BezelL", (t, d, h), (-w / 2 + t / 2, 0, cz), "white", r, radius=0.012)
    box("Monitor_BezelR", (t, d, h), (w / 2 - t / 2, 0, cz), "white", r, radius=0.012)
    box("Monitor_Back", (w - t, 0.026, h - t), (0, 0.007, cz), "white", r, radius=0.006)
    box("Monitor_Logo", (0.075, 0.008, 0.05), (0, 0.022, cz + 0.045), "clawd", r, radius=0.003)
    quad("Monitor_Screen", w - t * 1.4, h - t * 1.4, (0, -0.012, cz), material("charcoal", emission=0.4), r)
    return r


def build_keyboard():
    r = root("Keyboard")
    box("Keyboard_Body", (0.36, 0.13, 0.022), (0, 0, 0.011), "white", r, radius=0.009)
    box("Keyboard_Keys", (0.32, 0.09, 0.012), (0, 0, 0.024), "key", r, radius=0.005)
    return r


def build_mug():
    r = root("Mug")
    cyl("Mug_Body", 0.042, 0.046, 0.09, (0, 0, 0), "white", r, radius=0.008)
    cyl("Mug_Coffee", 0.036, 0.036, 0.004, (0, 0, 0.088), "coffee", r)
    box("Mug_Handle", (0.03, 0.018, 0.05), (0.058, 0, 0.045), "white", r, radius=0.008)
    return r


def build_paper():
    r = root("Paper")
    # One unit tall so the client can scale Y directly to a stack height.
    box("Paper_Stack", (0.21, 0.28, 1.0), (0, 0, 0.5), "paper", r, radius=0.0)
    return r


def build_desk_lamp():
    r = root("DeskLamp")
    cyl("DeskLamp_Base", 0.07, 0.06, 0.02, (0, 0, 0), "charcoal", r, radius=0.006)
    cyl("DeskLamp_Arm", 0.011, 0.011, 0.26, (0, 0, 0.02), "steel", r)
    cyl("DeskLamp_Shade", 0.085, 0.045, 0.085, (0, 0, 0.25), "mustard", r, radius=0.008)
    blob("DeskLamp_Bulb", 0.038, (0, 0, 0.255), (1, 1, 0.8), "paper", r)
    return r


def build_plant_small():
    r = root("PlantSmall")
    cyl("PlantSmall_Pot", 0.055, 0.07, 0.09, (0, 0, 0), "pot", r, radius=0.008)
    for i, (x, y, z, s) in enumerate(((0, 0, 0.15, 0.075), (0.045, 0.02, 0.12, 0.05), (-0.04, -0.02, 0.13, 0.055))):
        blob(f"PlantSmall_Leaf{i}", s, (x, y, z), (1, 1, 1.15), "leaf" if i else "leaf_dark", r)
    return r


def build_plant_big():
    r = root("PlantBig")
    cyl("PlantBig_Pot", 0.17, 0.22, 0.34, (0, 0, 0), "white", r, radius=0.02)
    cyl("PlantBig_Soil", 0.195, 0.195, 0.012, (0, 0, 0.335), "coffee", r)
    cyl("PlantBig_Stem", 0.022, 0.016, 0.62, (0, 0, 0.33), "wood_dark", r)
    leaves = (
        (0, 0, 1.10, 0.25, "leaf"),
        (0.18, 0.05, 0.92, 0.19, "leaf_dark"),
        (-0.17, -0.06, 0.95, 0.20, "leaf"),
        (0.02, 0.17, 0.86, 0.16, "leaf_dark"),
        (-0.03, -0.18, 0.84, 0.15, "leaf"),
    )
    for i, (x, y, z, s, m) in enumerate(leaves):
        blob(f"PlantBig_Leaf{i}", s, (x, y, z), (1, 1, 0.92), m, r)
    return r


def couch(name="Couch", frame="teal_dark", cushion="teal", pillow="mustard", feet="wood_dark"):
    """The lounge couch; themes reuse it in their own colors."""
    r = root(name)
    box(f"{name}_Base", (1.7, 0.72, 0.24), (0, 0, 0.19), frame, r, radius=0.06, segments=4)
    box(f"{name}_Back", (1.7, 0.22, 0.52), (0, 0.27, 0.45), frame, r, radius=0.08, segments=4)
    for i, x in enumerate((-0.80, 0.80)):
        box(f"{name}_Arm{i}", (0.2, 0.74, 0.40), (x, 0, 0.33), frame, r, radius=0.08, segments=4)
    for i, x in enumerate((-0.36, 0.36)):
        box(f"{name}_Cushion{i}", (0.68, 0.52, 0.14), (x, -0.07, 0.36), cushion, r, radius=0.06, segments=4)
    box(f"{name}_Pillow", (0.3, 0.12, 0.26), (-0.5, 0.1, 0.55), pillow, r, radius=0.055, segments=4)
    for i, (x, y) in enumerate(((-0.72, -0.26), (0.72, -0.26), (-0.72, 0.26), (0.72, 0.26))):
        cyl(f"{name}_Foot{i}", 0.03, 0.022, 0.08, (x, y, 0), feet, r)
    return r


def build_couch():
    return couch()


def beanbag(name="Beanbag", color="plum"):
    r = root(name)
    blob(f"{name}_Body", 0.36, (0, 0, 0.2), (1.0, 1.0, 0.6), color, r)
    blob(f"{name}_Top", 0.26, (0, 0.1, 0.36), (1.0, 0.75, 0.75), color, r)
    return r


def build_beanbag():
    return beanbag()


def build_coffee_bar():
    r = root("CoffeeBar")
    box("CoffeeBar_Cabinet", (1.5, 0.56, 0.74), (0, 0, 0.37), "white", r, radius=0.03)
    box("CoffeeBar_Top", (1.56, 0.62, 0.05), (0, 0, 0.765), "wood", r, radius=0.02)
    for i, x in enumerate((-0.37, 0.37)):
        box(f"CoffeeBar_Door{i}", (0.68, 0.02, 0.56), (x, -0.285, 0.38), "cream", r, radius=0.015)
        box(f"CoffeeBar_Knob{i}", (0.03, 0.03, 0.12), (x - 0.27 * (1 if x > 0 else -1), -0.305, 0.5), "wood_dark", r, radius=0.01)
    # The machine itself.
    box("CoffeeBar_Machine", (0.34, 0.34, 0.42), (-0.35, 0.05, 1.0), "red", r, radius=0.05, segments=4)
    box("CoffeeBar_MachineTop", (0.26, 0.26, 0.05), (-0.35, 0.05, 1.225), "charcoal", r, radius=0.02)
    box("CoffeeBar_Nozzle", (0.08, 0.1, 0.06), (-0.35, -0.15, 1.03), "steel", r, radius=0.015)
    box("CoffeeBar_Tray", (0.24, 0.16, 0.02), (-0.35, -0.2, 0.80), "steel", r, radius=0.008)
    cyl("CoffeeBar_Cup", 0.035, 0.04, 0.075, (-0.35, -0.2, 0.81), "white", r, radius=0.006)
    blob("CoffeeBar_Light", 0.018, (-0.25, -0.125, 1.13), (1, 0.5, 1), "mustard", r)
    # A tidy stack of spare mugs and a jar.
    for i, (x, y) in enumerate(((0.2, 0.05), (0.33, 0.08), (0.26, -0.08))):
        cyl(f"CoffeeBar_Spare{i}", 0.04, 0.044, 0.085, (x, y, 0.79), "white" if i != 1 else "sky", r, radius=0.007)
    cyl("CoffeeBar_Jar", 0.06, 0.06, 0.16, (0.56, 0.06, 0.79), "wood_dark", r, radius=0.012)
    cyl("CoffeeBar_JarLid", 0.063, 0.063, 0.025, (0.56, 0.06, 0.95), "charcoal", r, radius=0.008)
    return r


def build_water_cooler():
    r = root("WaterCooler")
    box("WaterCooler_Body", (0.34, 0.34, 0.86), (0, 0, 0.43), "white", r, radius=0.04, segments=4)
    box("WaterCooler_Panel", (0.22, 0.02, 0.2), (0, -0.172, 0.6), "cream", r, radius=0.012)
    box("WaterCooler_TapHot", (0.035, 0.04, 0.035), (-0.05, -0.19, 0.62), "red", r, radius=0.01)
    box("WaterCooler_TapCold", (0.035, 0.04, 0.035), (0.05, -0.19, 0.62), "sky", r, radius=0.01)
    cyl("WaterCooler_Bottle", 0.14, 0.14, 0.34, (0, 0, 0.86), material("sky", alpha=0.55), r, radius=0.04)
    cyl("WaterCooler_Neck", 0.05, 0.14, 0.06, (0, 0, 0.84), material("sky", alpha=0.55), r)
    return r


def build_filing_cabinet():
    r = root("FilingCabinet")
    box("FilingCabinet_Body", (0.5, 0.52, 1.02), (0, 0, 0.51), "sky", r, radius=0.03)
    for i in range(3):
        z = 0.2 + i * 0.31
        box(f"FilingCabinet_Drawer{i}", (0.43, 0.03, 0.27), (0, -0.262, z), "white", r, radius=0.015)
        box(f"FilingCabinet_Handle{i}", (0.16, 0.025, 0.03), (0, -0.285, z + 0.04), "steel", r, radius=0.01)
    return r


def build_bookshelf():
    r = root("Bookshelf")
    w, d, h = 1.1, 0.32, 1.5
    box("Bookshelf_Back", (w, 0.03, h), (0, d / 2 - 0.015, h / 2), "wood_dark", r, radius=0.008)
    for i, x in enumerate((-w / 2 + 0.025, w / 2 - 0.025)):
        box(f"Bookshelf_Side{i}", (0.05, d, h), (x, 0, h / 2), "wood", r, radius=0.012)
    shelf_z = (0.03, 0.39, 0.75, 1.11, 1.47)
    for i, z in enumerate(shelf_z):
        box(f"Bookshelf_Shelf{i}", (w, d, 0.05), (0, 0, z), "wood", r, radius=0.012)
    colors = ("red", "mustard", "teal", "plum", "sky", "clawd", "leaf", "cream", "slate")
    n = 0
    for row, z in enumerate(shelf_z[:-1]):
        x = -w / 2 + 0.08
        k = 0
        while x < w / 2 - 0.14:
            seed = (row * 7 + k * 13) % 11
            bw = 0.045 + (seed % 4) * 0.012
            bh = 0.20 + (seed % 5) * 0.022
            if seed == 5:
                x += 0.09  # a gap, so shelves do not look machine-filled
            else:
                box(
                    f"Bookshelf_Book{n}",
                    (bw, 0.2, bh),
                    (x + bw / 2, -0.02, z + 0.025 + bh / 2),
                    colors[(row * 3 + k) % len(colors)],
                    r,
                    radius=0.008,
                )
                x += bw + 0.006
                n += 1
            k += 1
    return r


def build_window():
    r = root("Window")
    w, h, t = 1.5, 1.2, 0.07
    box("Window_FrameT", (w, 0.09, t), (0, 0, h / 2 - t / 2), "white", r, radius=0.02)
    box("Window_FrameB", (w + 0.1, 0.14, t), (0, -0.02, -h / 2 + t / 2), "white", r, radius=0.02)
    box("Window_FrameL", (t, 0.09, h), (-w / 2 + t / 2, 0, 0), "white", r, radius=0.02)
    box("Window_FrameR", (t, 0.09, h), (w / 2 - t / 2, 0, 0), "white", r, radius=0.02)
    box("Window_Mullion", (0.045, 0.06, h - t), (0, 0, 0), "white", r, radius=0.012)
    quad("Window_Glass", w - t, h - t, (0, 0.01, 0), material("sky", emission=1.0), r)
    return r


def build_sign():
    r = root("Sign")
    cyl("Sign_Base", 0.13, 0.11, 0.03, (0, 0, 0), "charcoal", r, radius=0.01)
    cyl("Sign_Post", 0.018, 0.018, 0.62, (0, 0, 0.03), "steel", r)
    box("Sign_Board", (0.92, 0.05, 0.3), (0, 0, 0.78), "white", r, radius=0.022)
    quad("Sign_Face", 0.86, 0.24, (0, -0.0265, 0.78), "paper", r)
    return r


def build_laptop():
    r = root("Laptop")
    box("Laptop_Base", (0.26, 0.18, 0.014), (0, 0, 0.007), "steel", r, radius=0.006)
    box("Laptop_Keys", (0.22, 0.09, 0.004), (0, -0.02, 0.015), "charcoal", r, radius=0.0)
    lid_tilt = math.radians(-18)
    lid = box("Laptop_Lid", (0.26, 0.012, 0.17), (0, 0, 0.085), "steel", r, radius=0.005, origin=(0, 0.09, 0.012))
    lid.rotation_euler = (lid_tilt, 0, 0)
    screen = quad("Laptop_Screen", 0.235, 0.145, (0, -0.0068, 0.088), material("charcoal", emission=0.4), r, origin=(0, 0.09, 0.012))
    screen.rotation_euler = (lid_tilt, 0, 0)
    return r


def build_mini_desk():
    r = root("MiniDesk")
    box("MiniDesk_Top", (0.56, 0.4, 0.035), (0, 0, 0.2425), "wood", r, radius=0.014)
    for i, (x, y) in enumerate(((-0.23, -0.15), (0.23, -0.15), (-0.23, 0.15), (0.23, 0.15))):
        box(f"MiniDesk_Leg{i}", (0.04, 0.04, 0.225), (x, y, 0.1125), "white", r, radius=0.01)
    return r


def build_clock():
    r = root("Clock")
    # Hangs on a wall: the face looks toward -Y and hands pivot at the center.
    rim = cyl("Clock_Rim", 0.2, 0.2, 0.05, (0, 0, -0.025), "charcoal", r, radius=0.012, segments=40)
    rim.rotation_euler = (math.radians(90), 0, 0)
    face = cyl("Clock_Face", 0.17, 0.17, 0.012, (0, 0, 0.022), "paper", r, segments=40)
    face.rotation_euler = (math.radians(90), 0, 0)
    box("Clock_Hour", (0.022, 0.012, 0.10), (0, 0, 0.04), "charcoal", r, radius=0.005, origin=(0, -0.04, 0))
    box("Clock_Minute", (0.016, 0.012, 0.145), (0, 0, 0.0625), "red", r, radius=0.004, origin=(0, -0.048, 0))
    cyl("Clock_Pin", 0.014, 0.014, 0.02, (0, 0, -0.01), "charcoal", r, origin=(0, -0.05, 0)).rotation_euler = (
        math.radians(90),
        0,
        0,
    )
    return r


def build_coffee_table():
    r = root("CoffeeTable")
    cyl("CoffeeTable_Top", 0.4, 0.4, 0.045, (0, 0, 0.3), "wood", r, radius=0.015, segments=40)
    for i in range(3):
        a = i * math.tau / 3 + 0.4
        cyl(f"CoffeeTable_Leg{i}", 0.022, 0.016, 0.3, (math.cos(a) * 0.27, math.sin(a) * 0.27, 0), "white", r)
    return r


def build_door():
    r = root("Door")
    w, h = 1.2, 2.1
    for side, sx in (("L", -1), ("R", 1)):
        box(f"Door_Frame{side}", (0.09, 0.12, h + 0.09), (sx * (w / 2 + 0.045), 0, (h + 0.09) / 2), "white", r, radius=0.02)
    box("Door_FrameT", (w + 0.18, 0.12, 0.09), (0, 0, h + 0.045), "white", r, radius=0.02)
    # The dark doorway that shows when the panel swings open.
    box("Door_Void", (w, 0.02, h), (0, 0.02, h / 2), "eye", r, radius=0.0)
    # The panel pivots at its hinge so the client can swing it open.
    panel = box("Door_Panel", (w, 0.05, h), (w / 2, 0, h / 2), "teal_dark", r, radius=0.015, origin=(-w / 2, -0.035, 0))
    for i, z in enumerate((0.58, 1.52)):
        box(f"Door_Inset{i}", (w - 0.32, 0.02, 0.74), (w / 2, -0.03, z), "teal", panel, radius=0.01)
    blob("Door_Knob", 0.045, (w - 0.13, -0.06, 1.02), (1, 1, 1), "mustard", panel)
    box("Door_Mat", (1.05, 0.55, 0.02), (0, -0.46, 0.01), "slate", r, radius=0.008)
    return r


BUILDERS = [
    build_clawd,
    build_desk,
    build_chair,
    build_monitor,
    build_keyboard,
    build_mug,
    build_paper,
    build_desk_lamp,
    build_plant_small,
    build_plant_big,
    build_couch,
    build_beanbag,
    build_coffee_bar,
    build_water_cooler,
    build_filing_cabinet,
    build_bookshelf,
    build_window,
    build_sign,
    build_laptop,
    build_mini_desk,
    build_clock,
    build_coffee_table,
    build_door,
]

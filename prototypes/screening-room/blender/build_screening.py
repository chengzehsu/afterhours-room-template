"""放映室：我家客廳。Poly Haven（CC0）家具＋自己做的片櫃、布幕、投影機、立燈、窗簾，烘焙三層光、匯出 glb。

執行（指令必須以 Blender 執行檔開頭，才會走沙盒排除清單）：
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P <本檔> -- \
      --out prototypes/screening-room/home/room --samples 192 [--size 4096] [--passes night,lamp,screen] [--preview <dir>] [--skip-bake 1]

三層光（網頁上相加）：
  night  播放室那頭的燈從門口漏進來＋窗外月光（一直都在的底）
  lamp   立燈＋片櫃燈條（「開小燈」）
  screen 銀幕本身的光，白色；網頁乘上正在放的那部片的顏色
座標：一律寫 Three.js 的 (x, y, z)，P() 轉成 Blender（Z 朝上）。會動的東西（門、DVD、播放機、銀幕畫面、燈罩）在 build_props.py。
"""
import json
import math
import os
import random
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
MINE = os.path.join(HERE, "assets")
SHARED = os.path.abspath(os.path.join(HERE, "..", "..", "..", "web", "blender", "assets"))
argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OPT = {"--out": "prototypes/screening-room/home/room", "--samples": "192", "--size": "4096", "--passes": "night,lamp,screen", "--preview": "", "--skip-bake": "0", "--doorway": ""}
for i in range(0, len(argv) - 1, 2):
    OPT[argv[i]] = argv[i + 1]
OUT = os.path.abspath(OPT["--out"])
SAMPLES = int(OPT["--samples"])
SIZE = int(OPT["--size"])
PASSES = [p for p in OPT["--passes"].split(",") if p]
random.seed(7)


def P(x, y, z):
    return Vector((x, -z, y))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------------------------------------------------------------- 材質
def lin(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c] + [1.0]


def tex_dir(name):
    for base in (MINE, SHARED):
        p = os.path.join(base, "textures", name)
        if os.path.isdir(p):
            return p
    raise FileNotFoundError(name)


def textured(name, tex, scale=1.0, tint=None, nor=0.5, rough=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    bsdf = N["Principled BSDF"]
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / scale,) * 3
    L.new(tc.outputs["Object"], mp.inputs["Vector"])
    folder = tex_dir(tex)

    def img(kind, non_color):
        path = os.path.join(folder, f"{kind}.jpg")
        if not os.path.exists(path):
            return None
        n = N.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(path, check_existing=True)
        if non_color:
            n.image.colorspace_settings.name = "Non-Color"
        n.projection = "BOX"
        n.projection_blend = 0.25
        L.new(mp.outputs["Vector"], n.inputs["Vector"])
        return n

    d = img("diff", False)
    if d:
        if tint:
            mix = N.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.inputs["B"].default_value = lin(tint)
            L.new(d.outputs["Color"], mix.inputs["A"])
            L.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
        else:
            L.new(d.outputs["Color"], bsdf.inputs["Base Color"])
    r = img("rough", True)
    if r and rough is None:
        L.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = rough if rough is not None else 0.8
    n = img("nor", True)
    if n and nor > 0:
        nm = N.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nor
        L.new(n.outputs["Color"], nm.inputs["Color"])
        L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = 0.0
    return m


def flat(name, color, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    return m


M = {
    "floor": textured("floor", "wood_floor_worn", scale=2.0, tint="#b89a7c"),
    "wall": textured("wall", "painted_plaster_wall", scale=3.0, tint="#b39a82", nor=0.12),
    "accent": textured("accent", "painted_plaster_wall", scale=3.0, tint="#4a3a32", nor=0.12),
    "ceiling": textured("ceiling", "painted_plaster_wall", scale=4.0, tint="#7a6656", nor=0.1),
    "brick": textured("brick", "brick_wall_02", scale=1.6, nor=0.8),
    "walnut": textured("walnut", "walnut_veneer", scale=1.0, tint="#9a7050"),
    "walnutDark": textured("walnutDark", "walnut_veneer", scale=1.0, tint="#6b4a33"),
    "curtain": textured("curtain", "velour_velvet", scale=0.6, tint="#7a2a1e", nor=0.6),
    "rug": textured("rug", "poly_wool_herringbone", scale=0.8, tint="#9a7a5e", nor=0.6),
    "blanket": textured("blanket", "wool_boucle", scale=0.4, tint="#e6d7ba", nor=0.8),
    "oxblood": flat("oxblood", "#5e2219", 0.5),
    "frameDark": flat("frameDark", "#141210", 0.45),
    "screenCloth": flat("screenCloth", "#d9d6cf", 0.95),
    "screenBorder": flat("screenBorder", "#0e0c0b", 0.9),
    "metalDark": flat("metalDark", "#1d1b19", 0.35),
    "metal": flat("metal", "#6d6862", 0.35),
    "kraft": flat("kraft", "#e6d7ba", 0.9),
    "paper": flat("paper", "#efe8da", 0.95),
    "ink": flat("ink", "#2a1c13", 0.9),
    "popcorn": flat("popcorn", "#f4e3b8", 0.9),
    "plasticBlack": flat("plasticBlack", "#121111", 0.3),
    "mug": flat("mug", "#c9b9a0", 0.4),
    "tape": flat("tape", "#e9dcbf", 0.85),
}

STATIC = []


def box(name, size, at, mat, bevel=0.004, rot=None):
    sx, sy, sz = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(*at))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sz, sy)
    if rot:
        o.rotation_euler = Euler(rot)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 2
        b.limit_method = "ANGLE"
    o.data.materials.append(mat)
    STATIC.append(o)
    return o


def cyl(name, r, h, at, mat, verts=32, axis="y", r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=P(*at))
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=P(*at))
    o = bpy.context.object
    o.name = name
    if axis == "z":  # Three 的 z 軸＝Blender 的 -y
        o.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == "x":
        o.rotation_euler = (0, math.pi / 2, 0)
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    STATIC.append(o)
    return o


def model_dir(name):
    for base in (MINE, SHARED):
        p = os.path.join(base, "models", name)
        if os.path.isdir(p):
            return p
    raise FileNotFoundError(name)


def place(model, at, yaw=0.0, scale=1.0):
    """yaw 0 = 模型正面朝 Three 的 +z（朝門口）；180 = 朝 -z（朝銀幕）"""
    folder = model_dir(model)
    gltf = next(f for f in os.listdir(folder) if f.endswith(".gltf"))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(folder, gltf))
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(f"{model}_root", None)
    scene.collection.objects.link(root)
    for o in new:
        if o.parent is None:
            o.parent = root
    root.location = P(*at)
    root.rotation_euler = Euler((0, 0, math.radians(yaw)))
    root.scale = (scale,) * 3
    bpy.context.view_layer.update()
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        for m in o.data.materials:
            if m and m.node_tree:
                for n in m.node_tree.nodes:
                    if n.type == "BSDF_PRINCIPLED":
                        for link in list(n.inputs["Metallic"].links):
                            m.node_tree.links.remove(link)
                        n.inputs["Metallic"].default_value = 0.0
    STATIC.extend(meshes)
    return meshes


# ---------------------------------------------------------------- 尺寸（網頁也會讀 layout.json）
R = {"x0": 0.7, "x1": 6.7, "z0": -4.06, "z1": -10.8, "h": 2.9}
DOOR = {"x0": 2.76, "x1": 3.74, "h": 2.08}
cx = (R["x0"] + R["x1"]) / 2
SCREEN = {"x": 3.7, "y": 1.73, "z": -10.72, "w": 2.6, "h": 1.4625}
WIN = {"z0": -6.85, "z1": -8.05, "y0": 0.9, "y1": 2.3}
LAMP = (2.05, 1.5, -6.95)
LENS = (3.7, 2.47, -6.78)
SHELF = {"x_back": R["x1"], "depth": 0.27, "z0": -4.72, "z1": -5.98, "y_boards": [0.08, 0.46, 0.84, 1.22, 1.60, 1.978], "t": 0.022, "h": 2.0}
CAB_TOP = 0.68
PLAYER = {"x": 3.3, "y": CAB_TOP, "z": -10.47, "w": 0.43, "h": 0.065, "d": 0.29}
POSTER = {"x": R["x0"] + 0.02, "y": 1.6, "z": -5.25, "w": 0.6, "h": 0.9}

# ---------------------------------------------------------------- 播放室這一側（門口那段畫面要看到的部分，位置同 web/blender/build_room.py）
box("pr_floor", (3.6, 0.04, 3.8), (2.4, -0.02, -2.1), M["floor"], bevel=0)
box("pr_ceiling", (3.6, 0.04, 3.8), (2.4, 3.22, -2.1), M["ceiling"], bevel=0)
box("pr_wall_right", (0.04, 3.2, 3.8), (4.02, 1.6, -2.1), M["wall"], bevel=0)
# 播放室的後牆（磚）：門的位置挖空
box("pr_back_l", (DOOR["x0"] - 0.6, 3.2, 0.04), ((0.6 + DOOR["x0"]) / 2, 1.6, -4.02), M["brick"], bevel=0)
box("pr_back_r", (4.04 - DOOR["x1"], 3.2, 0.04), ((DOOR["x1"] + 4.04) / 2, 1.6, -4.02), M["brick"], bevel=0)
box("pr_back_top", (DOOR["x1"] - DOOR["x0"], 3.2 - DOOR["h"], 0.04), (3.25, (3.2 + DOOR["h"]) / 2, -4.02), M["brick"], bevel=0)
box("door_jamb_l", (0.085, 2.2, 0.1), (DOOR["x0"] - 0.0425, 1.1, -4.03), M["walnutDark"], bevel=0.006)
box("door_jamb_r", (0.085, 2.2, 0.1), (DOOR["x1"] + 0.0425, 1.1, -4.03), M["walnutDark"], bevel=0.006)
box("door_head", (DOOR["x1"] - DOOR["x0"] + 0.17, 0.12, 0.1), (3.25, DOOR["h"] + 0.06, -4.03), M["walnutDark"], bevel=0.006)
box("sign_back", (1.12, 0.42, 0.03), (3.25, 2.42, -3.985), M["walnutDark"], bevel=0.008)
box("crate", (0.72, 0.36, 0.42), (2.45, 0.18, -3.55), M["walnut"], bevel=0.01)
place("potted_plant_02", (1.3, 0, -3.5), yaw=20, scale=1.0)

# ---------------------------------------------------------------- 客廳外殼
rw, rd = R["x1"] - R["x0"], R["z0"] - R["z1"]
rz = (R["z0"] + R["z1"]) / 2
box("floor", (rw, 0.04, rd), (cx, -0.02, rz), M["floor"], bevel=0)
box("ceiling", (rw, 0.04, rd), (cx, R["h"] + 0.02, rz), M["ceiling"], bevel=0)
box("wall_screen", (rw, R["h"], 0.04), (cx, R["h"] / 2, R["z1"] - 0.02), M["accent"], bevel=0)
box("wall_right", (0.04, R["h"], rd), (R["x1"] + 0.02, R["h"] / 2, rz), M["wall"], bevel=0)
# 門那面牆（客廳這一側），門口挖空
box("wall_front_l", (DOOR["x0"] - R["x0"], R["h"], 0.04), ((R["x0"] + DOOR["x0"]) / 2, R["h"] / 2, R["z0"] + 0.02), M["wall"], bevel=0)
box("wall_front_r", (R["x1"] - DOOR["x1"], R["h"], 0.04), ((DOOR["x1"] + R["x1"]) / 2, R["h"] / 2, R["z0"] + 0.02), M["wall"], bevel=0)
box("wall_front_top", (DOOR["x1"] - DOOR["x0"], R["h"] - DOOR["h"], 0.04), (3.25, (R["h"] + DOOR["h"]) / 2, R["z0"] + 0.02), M["wall"], bevel=0)
box("door_reveal_l", (0.02, DOOR["h"], 0.08), (DOOR["x0"], DOOR["h"] / 2, -4.03), M["walnutDark"], bevel=0)
box("door_reveal_r", (0.02, DOOR["h"], 0.08), (DOOR["x1"], DOOR["h"] / 2, -4.03), M["walnutDark"], bevel=0)
# 左牆，窗戶挖空
wl = R["x0"] - 0.02
box("wall_left_a", (0.04, R["h"], R["z0"] - WIN["z0"]), (wl, R["h"] / 2, (R["z0"] + WIN["z0"]) / 2), M["wall"], bevel=0)
box("wall_left_b", (0.04, R["h"], WIN["z1"] - R["z1"]), (wl, R["h"] / 2, (WIN["z1"] + R["z1"]) / 2), M["wall"], bevel=0)
ww = WIN["z0"] - WIN["z1"]
wz = (WIN["z0"] + WIN["z1"]) / 2
box("wall_left_low", (0.04, WIN["y0"], ww), (wl, WIN["y0"] / 2, wz), M["wall"], bevel=0)
box("wall_left_high", (0.04, R["h"] - WIN["y1"], ww), (wl, (R["h"] + WIN["y1"]) / 2, wz), M["wall"], bevel=0)
SHELL_NAMES = {o.name for o in STATIC if o.name.startswith(("floor", "ceiling", "wall_", "pr_"))}

# 踢腳板
for name, size, at in [
    ("skirt_screen", (rw, 0.09, 0.02), (cx, 0.045, R["z1"] + 0.01)),
    ("skirt_right", (0.02, 0.09, rd), (R["x1"] - 0.01, 0.045, rz)),
    ("skirt_left", (0.02, 0.09, rd), (R["x0"] + 0.01, 0.045, rz)),
]:
    box(name, size, at, M["walnutDark"], bevel=0.002)

# 窗：黑色窗框、窗台、天鵝絨窗簾（拉上一半）
wy = (WIN["y0"] + WIN["y1"]) / 2
wh = WIN["y1"] - WIN["y0"]
for name, size, at in [
    ("win_top", (0.1, 0.05, ww + 0.06), (R["x0"] + 0.01, WIN["y1"], wz)),
    ("win_bottom", (0.18, 0.04, ww + 0.12), (R["x0"] + 0.05, WIN["y0"], wz)),
    ("win_a", (0.1, wh, 0.05), (R["x0"] + 0.01, wy, WIN["z0"])),
    ("win_b", (0.1, wh, 0.05), (R["x0"] + 0.01, wy, WIN["z1"])),
    ("win_mid", (0.06, wh, 0.03), (R["x0"] + 0.0, wy, wz)),
    ("win_cross", (0.06, 0.03, ww), (R["x0"] + 0.0, WIN["y0"] + wh * 0.62, wz)),
]:
    box(name, size, at, M["frameDark"], bevel=0.003)
cyl("curtain_rod", 0.012, ww + 1.1, (R["x0"] + 0.12, 2.6, wz), M["metalDark"], axis="z")


def curtain(name, z_start, width, folds=7):
    """一片天鵝絨窗簾：沿 z 方向起伏的布"""
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=folds * 8, y_subdivisions=4, size=1)
    o = bpy.context.object
    o.name = name
    for v in o.data.vertices:
        u = v.co.x + 0.5          # 0..1 沿寬度
        t = v.co.y + 0.5          # 0..1 沿高度
        z = z_start - u * width
        x = R["x0"] + 0.12 + 0.045 * math.sin(u * folds * 2 * math.pi) * (0.6 + 0.4 * (1 - t))
        y = 0.02 + t * 2.56
        v.co = P(x, y, z)
    o.location = (0, 0, 0)
    sol = o.modifiers.new("thick", "SOLIDIFY")
    sol.thickness = 0.012
    bpy.ops.object.shade_smooth()
    o.data.materials.append(M["curtain"])
    STATIC.append(o)


curtain("curtain_a", WIN["z0"] + 0.5, 0.75)
curtain("curtain_b", WIN["z1"] + 0.25, 0.75)

# ---------------------------------------------------------------- 銀幕牆：矮櫃、捲簾布幕、植物
place("modern_wooden_cabinet", (cx, 0, R["z1"] + 0.27), yaw=0)
box("screen_case", (SCREEN["w"] + 0.24, 0.1, 0.11), (SCREEN["x"], SCREEN["y"] + SCREEN["h"] / 2 + 0.16, SCREEN["z"] - 0.01), M["metalDark"], bevel=0.01)
box("screen_cloth", (SCREEN["w"] + 0.1, SCREEN["h"] + 0.22, 0.004), (SCREEN["x"], SCREEN["y"] + 0.06, SCREEN["z"]), M["screenBorder"], bevel=0)
box("screen_bar", (SCREEN["w"] + 0.14, 0.03, 0.02), (SCREEN["x"], SCREEN["y"] - SCREEN["h"] / 2 - 0.06, SCREEN["z"] + 0.004), M["metalDark"], bevel=0.003)
box("screen_white", (SCREEN["w"], SCREEN["h"], 0.002), (SCREEN["x"], SCREEN["y"], SCREEN["z"] + 0.003), M["screenCloth"], bevel=0)
place("potted_plant_04", (6.2, 0, -10.35), yaw=-30, scale=1.0)
# 矮櫃上：播放機（會動，在 build_props）旁邊一小疊 DVD 和遙控器
for i in range(5):
    box(f"cab_dvd_{i}", (0.19, 0.0145, 0.135), (4.35, CAB_TOP + 0.0073 + i * 0.0147, -10.5 + random.uniform(-0.006, 0.006)), M["plasticBlack"], bevel=0.0015)

# ---------------------------------------------------------------- 沙發區
place("sofa_03", (cx, 0, -7.45), yaw=180)
place("throw_pillows_01", (cx - 0.95, 0.42, -7.2), yaw=180, scale=0.72)
place("Ottoman_01" if os.path.isdir(os.path.join(MINE, "models", "Ottoman_01")) else "side_table_tall_01", (5.4, 0, -7.05), yaw=0)
cyl("mug", 0.042, 0.09, (5.4, 0.761 + 0.045, -7.0), M["mug"], verts=24)
box("rug", (3.4, 0.01, 2.5), (cx, 0.005, -8.25), M["rug"], bevel=0)
place("modern_coffee_table_01", (cx, 0, -8.8), yaw=90)
TABLE_TOP = 0.39
place("wooden_bowl_01", (cx - 0.28, TABLE_TOP, -8.75), yaw=0, scale=1.0)
for i in range(130):  # 爆米花
    a = random.uniform(0, 2 * math.pi)
    r = math.sqrt(random.random()) * 0.115
    y = TABLE_TOP + 0.07 + random.uniform(0, 0.035) - r * 0.18
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=random.uniform(0.01, 0.015), location=P(cx - 0.28 + math.cos(a) * r, y, -8.75 + math.sin(a) * r))
    o = bpy.context.object
    o.name = f"popcorn_{i}"
    o.scale = (1, random.uniform(0.8, 1.2), random.uniform(0.7, 1.1))
    o.data.materials.append(M["popcorn"])
    STATIC.append(o)
box("remote", (0.05, 0.022, 0.19), (cx + 0.25, TABLE_TOP + 0.011, -8.62), M["plasticBlack"], bevel=0.008, rot=(0, 0, math.radians(18)))
box("list_paper", (0.21, 0.002, 0.297), (cx + 0.12, TABLE_TOP + 0.001, -8.95), M["paper"], bevel=0, rot=(0, 0, math.radians(-8)))
for i in range(6):  # 手寫片單上的字（幾條墨線）
    box(f"list_line_{i}", (0.15 - (i % 3) * 0.03, 0.0005, 0.004), (cx + 0.11 - 0.012 * math.sin(math.radians(-8)) * i, TABLE_TOP + 0.0025, -8.86 - i * 0.032), M["ink"], bevel=0, rot=(0, 0, math.radians(-8)))
# 藤籃與毯子
place("wicker_basket_01", (5.55, 0, -8.35), yaw=12, scale=1.7)
for i in range(3):
    box(f"blanket_{i}", (0.5, 0.05, 0.36), (5.55, 0.13 + i * 0.05, -8.35), M["blanket"], bevel=0.02, rot=(0, 0, math.radians(12 + i * 4)))

# 立燈（燈罩會發光，在 build_props；這裡只有燈座和燈桿）
cyl("lamp_base", 0.15, 0.025, (LAMP[0], 0.0125, LAMP[2]), M["metalDark"], verts=40)
cyl("lamp_pole", 0.011, 1.5, (LAMP[0], 0.76, LAMP[2]), M["metal"], verts=16)

# 天花板吊的投影機
cyl("proj_rod", 0.014, R["h"] - LENS[1] - 0.06, (LENS[0], (R["h"] + LENS[1] + 0.06) / 2, LENS[2] + 0.14), M["metalDark"], verts=12)
box("proj_body", (0.32, 0.11, 0.27), (LENS[0], LENS[1], LENS[2] + 0.14), M["kraft"], bevel=0.02)
cyl("proj_lens", 0.034, 0.05, (LENS[0], LENS[1], LENS[2] + 0.005), M["metalDark"], axis="z", verts=32)

# 左牆的海報框（海報本身在 build_props，網頁換圖）
box("poster_frame", (0.03, POSTER["h"] + 0.06, POSTER["w"] + 0.06), (POSTER["x"] + 0.015, POSTER["y"], POSTER["z"]), M["frameDark"], bevel=0.004)

# ---------------------------------------------------------------- 片櫃（右牆，靠門口）：照 DVD 尺寸做
S = SHELF
sx = S["x_back"] - S["depth"] / 2
sz = (S["z0"] + S["z1"]) / 2
sw = S["z0"] - S["z1"]
box("shelf_back", (0.012, S["h"], sw), (S["x_back"] - 0.006, S["h"] / 2, sz), M["walnutDark"], bevel=0)
for name, z in (("shelf_side_a", S["z0"] - S["t"] / 2), ("shelf_side_b", S["z1"] + S["t"] / 2)):
    box(name, (S["depth"], S["h"], S["t"]), (sx, S["h"] / 2, z), M["walnut"], bevel=0.003)
for i, y in enumerate(S["y_boards"]):
    box(f"shelf_board_{i}", (S["depth"], S["t"], sw - 2 * S["t"]), (sx, y + S["t"] / 2, sz), M["walnut"], bevel=0.003)
box("shelf_plinth", (S["depth"] - 0.03, 0.08, sw - 2 * S["t"]), (sx + 0.015, 0.04, sz), M["walnutDark"], bevel=0)
# 每層下緣一條燈條的燈罩（光在 lamp 那層）
for i, y in enumerate(S["y_boards"][1:], start=1):
    box(f"led_strip_{i}", (0.015, 0.006, sw - 2 * S["t"] - 0.04), (S["x_back"] - S["depth"] + 0.03, y - 0.003, sz), M["metal"], bevel=0)

# 片櫃每一層可以放 DVD 的範圍，給網頁排
rows = []
for i in range(4):
    y = S["y_boards"][i] + S["t"]
    rows.append({"y": round(y, 4), "z_start": round(S["z0"] - S["t"] - 0.004, 4), "z_end": round(S["z1"] + S["t"] + 0.004, 4), "x_front": round(S["x_back"] - S["depth"] + 0.012, 4), "x_back": round(S["x_back"] - 0.014, 4)})
top_row = {"y": round(S["y_boards"][4] + S["t"], 4), "z_start": rows[0]["z_start"], "z_end": rows[0]["z_end"], "x_front": rows[0]["x_front"], "x_back": rows[0]["x_back"]}

# ---------------------------------------------------------------- 燈光
LIGHTS = {}


def area(name, at, aim, size, size_y=None, pass_name="night"):
    bpy.ops.object.light_add(type="AREA", location=P(*at))
    L = bpy.context.object
    L.name = name
    L.data.size = size
    if size_y:
        L.data.shape = "RECTANGLE"
        L.data.size_y = size_y
    L.rotation_euler = (P(*aim) - P(*at)).to_track_quat("-Z", "Y").to_euler()
    L.visible_camera = False
    L.visible_glossy = False
    LIGHTS[name] = (L, pass_name)
    return L


def point(name, at, radius=0.08, pass_name="night"):
    bpy.ops.object.light_add(type="POINT", location=P(*at))
    L = bpy.context.object
    L.name = name
    L.data.shadow_soft_size = radius
    L.visible_camera = False
    LIGHTS[name] = (L, pass_name)
    return L


ENERGY = {
    # night：播放室那頭的燈、跑馬燈、窗外月光
    "pr_warm": (110, (1.0, 0.66, 0.38)), "pr_marquee": (14, (1.0, 0.72, 0.42)), "moon": (55, (0.5, 0.62, 1.0)),
    # lamp：立燈、片櫃燈條
    "lamp_bulb": (140, (1.0, 0.72, 0.45)), "led_1": (6, (1.0, 0.78, 0.55)), "led_2": (6, (1.0, 0.78, 0.55)), "led_3": (6, (1.0, 0.78, 0.55)), "led_4": (6, (1.0, 0.78, 0.55)), "led_5": (6, (1.0, 0.78, 0.55)),
    # screen：銀幕（白）
    "screen_glow": (90, (1.0, 1.0, 1.0)),
}
point("pr_warm", (2.3, 2.6, -2.0), 0.4, "night")
point("pr_marquee", (3.25, 2.42, -3.75), 0.15, "night")
area("moon", (R["x0"] - 0.8, 2.6, wz), (R["x0"] + 1.5, 0.4, wz - 0.2), ww, wh, "night")
point("lamp_bulb", LAMP, 0.09, "lamp")
for i, y in enumerate(S["y_boards"][1:], start=1):
    area(f"led_{i}", (S["x_back"] - S["depth"] + 0.03, y - 0.012, sz), (S["x_back"] - S["depth"] + 0.06, y - 0.4, sz), 0.02, sw - 0.1, "lamp")
area("screen_glow", (SCREEN["x"], SCREEN["y"], SCREEN["z"] + 0.02), (SCREEN["x"], SCREEN["y"], 0), SCREEN["w"], SCREEN["h"], "screen")

world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.0, 0.0, 0.0, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0


def apply_pass(name):
    for key, (L, p) in LIGHTS.items():
        energy, color = ENERGY[key]
        L.data.energy = energy if p == name else 0.0
        L.data.color = color
    # 底層加一點點天光，最暗的角落才不會死黑
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.38, 0.5, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.02 if name == "night" else 0.0


# ---------------------------------------------------------------- 預覽：直接用燈光算一張圖（不烘焙），用來檢查構圖
os.makedirs(OUT, exist_ok=True)
layout = {
    "room": R, "door": DOOR, "screen": SCREEN, "window": WIN, "lamp": LAMP, "lens": LENS, "poster": POSTER,
    "player": PLAYER, "shelf": {"rows": rows, "top": top_row, "z0": S["z0"], "z1": S["z1"], "x_back": S["x_back"], "depth": S["depth"]},
    "passes": PASSES,
}
# 合併寫入：build_props.py 補的欄位（dvd、bulbs…）不要被洗掉
lp = os.path.join(OUT, "layout.json")
if os.path.exists(lp):
    old = json.load(open(lp))
    old.update(layout)
    layout = old
with open(lp, "w") as f:
    json.dump(layout, f, indent=1)

scene.render.engine = "CYCLES"
cy = scene.cycles
cy.samples = SAMPLES
cy.sample_clamp_direct = 8.0
cy.sample_clamp_indirect = 3.0
cy.max_bounces = 6
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "METAL"
    prefs.refresh_devices()
    for dev in prefs.devices:
        dev.use = True
    cy.device = "GPU"
except Exception as e:
    print("GPU 不可用，改用 CPU：", e)
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

PREVIEW_CAMS = {
    "door": ((1.55, 1.62, -1.1), (3.25, 1.5, -4), 50),
    "hall": ((3.2, 1.62, -4.55), (4.4, 1.0, -10.5), 58),
    "shelf": ((5.15, 1.32, -5.35), (6.7, 1.0, -5.35), 52),
    "sofa": ((3.05, 1.12, -7.6), (3.6, 1.45, -11), 50),
    "player": ((3.55, 1.18, -9.75), (3.3, 0.72, -10.45), 44),
}


def preview(pdir, mix):
    os.makedirs(pdir, exist_ok=True)
    for key, (L, p) in LIGHTS.items():
        energy, color = ENERGY[key]
        L.data.energy = energy * mix.get(p, 0)
        L.data.color = color
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.38, 0.5, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.02
    scene.render.resolution_x, scene.render.resolution_y = 800, 450
    cy.samples = 48
    cy.use_denoising = True
    for name, (pos, look, fov) in PREVIEW_CAMS.items():
        cd = bpy.data.cameras.new(name)
        cd.sensor_fit = "VERTICAL"
        cd.angle = math.radians(fov * 450 / 450)
        cam = bpy.data.objects.new(name, cd)
        scene.collection.objects.link(cam)
        cam.location = P(*pos)
        cam.rotation_euler = (P(*look) - P(*pos)).to_track_quat("-Z", "Y").to_euler()
        scene.camera = cam
        scene.render.filepath = os.path.join(pdir, f"{name}.jpg")
        scene.render.image_settings.file_format = "JPEG"
        bpy.ops.render.render(write_still=True)
        print("預覽", name, flush=True)
    cy.samples = SAMPLES


if OPT["--preview"]:
    preview(os.path.abspath(OPT["--preview"]), {"night": 1.0, "lamp": 1.0, "screen": 0.6})


def doorway(path):
    """播放室門洞要貼的圖：從播放室換頁前最後一格的位置，垂直正對門洞拍，用鏡頭偏移框住門洞長方形。
    這樣貼在門洞平面上，從那個位置看過去透視完全正確。近裁切面就是門洞平面，門框與播放室那側都不會入鏡。"""
    cam_pos = (2.60, 1.55, -2.03)
    plane_z = -3.92
    rx0, rx1, ry0, ry1 = DOOR["x0"], DOOR["x1"], 0.0, DOOR["h"]
    dist = cam_pos[2] - plane_z
    w, h = rx1 - rx0, ry1 - ry0
    # 燈光照網頁開場：night × 1.5、lamp × 1.9、銀幕關著（同 index.html 的 kN／kL）
    mix = {"night": 1.5, "lamp": 1.9, "screen": 0.0}
    for key, (L, p) in LIGHTS.items():
        energy, color = ENERGY[key]
        L.data.energy = energy * mix.get(p, 0)
        L.data.color = color
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.35, 0.38, 0.5, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.02 * 1.5
    # 燈罩在網頁上是會發光的物件，這裡補一個
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.2, depth=0.3, end_fill_type="NOTHING", location=P(LAMP[0], LAMP[1] + 0.05, LAMP[2]))
    shade = bpy.context.object
    em = bpy.data.materials.new("shade_emit")
    em.use_nodes = True
    bb = em.node_tree.nodes["Principled BSDF"]
    bb.inputs["Base Color"].default_value = lin("#e6d7ba")
    bb.inputs["Emission Color"].default_value = lin("#ffc98a")
    bb.inputs["Emission Strength"].default_value = 1.2
    shade.data.materials.append(em)
    cd = bpy.data.cameras.new("doorway")
    cd.sensor_fit = "VERTICAL"
    cd.angle = 2 * math.atan((h / 2) / dist)
    big = max(w, h)
    cd.shift_x = ((rx0 + rx1) / 2 - cam_pos[0]) / big
    cd.shift_y = ((ry0 + ry1) / 2 - cam_pos[1]) / big
    cd.clip_start = dist - 0.005
    cd.clip_end = 60
    cam = bpy.data.objects.new("doorway", cd)
    scene.collection.objects.link(cam)
    cam.location = P(*cam_pos)
    cam.rotation_euler = (P(cam_pos[0], cam_pos[1], cam_pos[2] - 1) - P(*cam_pos)).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.resolution_x = 512
    scene.render.resolution_y = round(512 * h / w)
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 88
    cy.samples = 256
    cy.use_denoising = True
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("門洞圖：", path, scene.render.resolution_x, "x", scene.render.resolution_y, f"shift=({cd.shift_x:.4f},{cd.shift_y:.4f})", flush=True)


if OPT["--doorway"]:
    doorway(os.path.abspath(OPT["--doorway"]))
    sys.exit(0)

if OPT["--skip-bake"] == "1":
    print("略過烘焙", flush=True)
    sys.exit(0)

# ---------------------------------------------------------------- 合併、展 UV
bpy.ops.object.select_all(action="DESELECT")
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
bpy.ops.object.convert(target="MESH")
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
for o in [o for o in bpy.data.objects if o.type == "EMPTY"]:
    bpy.data.objects.remove(o)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    j = bpy.context.object
    j.name = name
    return j


meshes = [o for o in bpy.data.objects if o.type == "MESH"]
shell = join([o for o in meshes if o.name in SHELL_NAMES], "room_shell")
props = join([o for o in bpy.data.objects if o.type == "MESH" and o is not shell], "room_props")
for obj, margin in ((shell, 0.004), (props, 0.002)):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    keep = obj.data.uv_layers.active_index
    uv = obj.data.uv_layers.new(name="bake")
    obj.data.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    for i, layer in enumerate(obj.data.uv_layers):
        layer.active_render = layer.name != "bake" and i == keep

# ---------------------------------------------------------------- 烘焙
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
scene.render.bake.use_pass_color = True
scene.render.bake.margin = 8
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 86
EXPOSURE = {"night": 0.0, "lamp": 0.0, "screen": 0.0}


def bake(obj, size, name):
    img = bpy.data.images.new(name, size, size, alpha=False)
    for mat in obj.data.materials:
        if mat and mat.node_tree:
            node = mat.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            mat.node_tree.nodes.active = node
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.uv_layers.active = obj.data.uv_layers["bake"]
    print(f"烘焙 {name}（{size}px，{SAMPLES} samples）…", flush=True)
    bpy.ops.object.bake(type="DIFFUSE")
    img.save_render(os.path.join(OUT, f"{name}.jpg"))
    return img


baked = {}
for p in PASSES:
    apply_pass(p)
    scene.view_settings.exposure = EXPOSURE[p]
    baked[p] = {"room_shell": bake(shell, SIZE // 2, f"{p}_shell"), "room_props": bake(props, SIZE, f"{p}_props")}

# ---------------------------------------------------------------- 匯出：只留烘焙 UV，材質換成佔位（網頁依燈光層載入 JPG 自己相加）
placeholder = bpy.data.images.new("placeholder", 4, 4)
for obj in (shell, props):
    mat = bpy.data.materials.new(f"{obj.name}_baked")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = placeholder
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "bake"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for layer in [l for l in obj.data.uv_layers if l.name != "bake"]:
        obj.data.uv_layers.remove(layer)
for o in [o for o in bpy.data.objects if o.type in ("LIGHT", "CAMERA")]:
    bpy.data.objects.remove(o)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "screening.glb"), export_format="GLB", export_image_format="JPEG",
    export_apply=True, export_lights=False, export_cameras=False,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
)
print("完成：", OUT, flush=True)

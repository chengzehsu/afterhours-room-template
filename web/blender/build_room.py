"""播放室 v2：Poly Haven（CC0）模型與材質、三種場景烘焙、匯出 glb。

執行（Blender 要在沙盒排除清單裡，指令必須以 Blender 執行檔開頭）：
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P web/blender/build_room.py -- \
      --out web/public/room --samples 512 --size 4096 [--moods afternoon,tipsy,night] [--preview <dir>]

素材先用 fetch_assets.py 下載到 web/blender/assets/。
座標：數字一律寫 Three.js 的 (x, y, z)，P() 轉成 Blender（Z 朝上）。
只烘焙不會動的東西；CD、唱片、唱臂、相框照片、跑馬燈、咖啡機留給 Three.js。
"""
import json
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "assets")
argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OPT = {"--out": "web/public/room", "--samples": "256", "--size": "4096", "--preview": "", "--moods": "afternoon,tipsy,night", "--measure": ""}
for i in range(0, len(argv) - 1, 2):
    OPT[argv[i]] = argv[i + 1]
OUT = os.path.abspath(OPT["--out"])
SAMPLES = int(OPT["--samples"])
SIZE = int(OPT["--size"])
ONLY = [m for m in OPT["--moods"].split(",") if m]


def P(x, y, z):
    return Vector((x, -z, y))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------------------------------------------------------------- 材質
def lin(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c] + [1.0]


def textured(name, tex, scale=1.0, rough_mul=1.0, tint=None, nor=0.6):
    """Poly Haven 材質：用物件座標做盒狀投影，scale 是貼圖每張代表幾公尺"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    N, L = m.node_tree.nodes, m.node_tree.links
    bsdf = N["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = 0.0
    tc = N.new("ShaderNodeTexCoord")
    mp = N.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1 / scale, 1 / scale, 1 / scale)
    L.new(tc.outputs["Object"], mp.inputs["Vector"])

    def img(kind, non_color):
        path = os.path.join(ASSETS, "textures", tex, f"{kind}.jpg")
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
    if r:
        mul = N.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = rough_mul
        L.new(r.outputs["Color"], mul.inputs[0])
        L.new(mul.outputs["Value"], bsdf.inputs["Roughness"])
    n = img("nor", True)
    if n:
        nm = N.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nor
        L.new(n.outputs["Color"], nm.inputs["Color"])
        L.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def flat(name, color, rough=0.6, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    if emit:
        b.inputs["Emission Color"].default_value = lin(emit)
        b.inputs["Emission Strength"].default_value = strength
    return m


M = {
    "floor": textured("floor", "wood_floor_worn", scale=2.0, tint="#d9c2a8"),
    "wall": textured("wall", "painted_plaster_wall", scale=4.0, tint="#d8c4a8", nor=0.15),
    "ceiling": textured("ceiling", "brown_planks_05", scale=2.0, tint="#c9a07a"),
    "walnut": textured("walnut", "walnut_veneer", scale=1.0),
    "walnutDark": textured("walnutDark", "walnut_veneer", scale=1.0, tint="#6b4a33"),
    "rug": textured("rug", "fabric_pattern_07", scale=1.2, tint="#8a6f55"),
    "grill": flat("grill", "#2a2118", 0.95),
    "cone": flat("cone", "#1b140d", 0.8),
    "brass": flat("brass", "#a8854f", 0.3),
    "oxblood": flat("oxblood", "#5e2219", 0.5),
    "bone": flat("bone", "#e4e2da", 0.8),
    "tan": flat("tan", "#a88c72", 0.75),
    "frameDark": flat("frameDark", "#141210", 0.45),
    "brick": textured("brick", "brick_wall_02", scale=1.6, nor=0.8),
    "fairy": flat("fairy", "#fff1d6", 0.4, emit="#ffc77a", strength=0.0),
    "wire": flat("wire", "#14110e", 0.6),
    "candle": flat("candle", "#efe6d2", 0.7),
    "flame": flat("flame", "#ffcf8a", 0.5, emit="#ffb25c", strength=0.0),
}

STATIC = []


def box(name, size, at, mat, bevel=0.006):
    sx, sy, sz = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=P(*at))
    o = bpy.context.object
    o.name = name
    o.scale = (sx, sz, sy)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 3
        b.limit_method = "ANGLE"
    o.data.materials.append(mat)
    STATIC.append(o)
    return o


def cyl(name, r, h, at, mat, verts=48, facing_z=False):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=P(*at))
    o = bpy.context.object
    o.name = name
    if facing_z:
        o.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    STATIC.append(o)
    return o


def place(model, at, yaw=0.0, scale=1.0):
    """匯入 Poly Haven 模型。yaw 是繞垂直軸轉幾度（0 = 模型正面朝 Three 的 +z，也就是朝門口）"""
    folder = os.path.join(ASSETS, "models", model)
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
    root.scale = (scale, scale, scale)
    bpy.context.view_layer.update()
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        for m in o.data.materials:
            if not (m and m.node_tree):
                continue
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    # 烘焙只算漫射：金屬一律當非金屬，顏色才不會變黑
                    for link in list(n.inputs["Metallic"].links):
                        m.node_tree.links.remove(link)
                    n.inputs["Metallic"].default_value = 0.0
    STATIC.extend(meshes)
    return meshes


# ---------------------------------------------------------------- 房間外殼
# L 型轉角落地窗：後牆一段（WIN）轉過左後角，延到左牆後段（WINL）。兩段共用高度與橫條位置，轉角一根角柱
WIN = {"x0": -4.0, "x1": -1.7, "y0": 0.12, "y1": 3.05}  # 後牆左邊的鋼構落地窗
WINL = {"z0": -4.0, "z1": -2.3}  # 左牆後段的窗（z 範圍；高度同 WIN）
box("floor", (8, 0.04, 8), (0, -0.02, 0), M["floor"], bevel=0)
box("ceiling", (8, 0.04, 8), (0, 3.22, 0), M["ceiling"], bevel=0)
box("wall_right", (0.04, 3.2, 8), (4.02, 1.6, 0), M["wall"], bevel=0)
box("wall_front", (8, 3.2, 0.04), (0, 1.6, 4.02), M["wall"], bevel=0)
# 後牆：窗在最左端到角落，所以只剩窗右邊的主牆，加窗下、窗上兩塊
box("wall_back_main", (8 - (WIN["x1"] + 4), 3.2, 0.04), ((WIN["x1"] + 4) / 2, 1.6, -4.02), M["brick"], bevel=0)
w = WIN["x1"] - WIN["x0"]
cx = (WIN["x0"] + WIN["x1"]) / 2
box("wall_back_low", (w, WIN["y0"], 0.04), (cx, WIN["y0"] / 2, -4.02), M["brick"], bevel=0)
box("wall_back_high", (w, 3.2 - WIN["y1"], 0.04), (cx, (3.2 + WIN["y1"]) / 2, -4.02), M["brick"], bevel=0)
# 左牆：窗段以外的主牆，加窗下、窗上兩塊（CD 牆背板在 z -1.95~1.95，在主牆那一段）
wl = WINL["z1"] - WINL["z0"]
czl = (WINL["z0"] + WINL["z1"]) / 2
box("wall_left_main", (0.04, 3.2, 4 - WINL["z1"]), (-4.02, 1.6, (WINL["z1"] + 4) / 2), M["wall"], bevel=0)
box("wall_left_low", (0.04, WIN["y0"], wl), (-4.02, WIN["y0"] / 2, czl), M["wall"], bevel=0)
box("wall_left_high", (0.04, 3.2 - WIN["y1"], wl), (-4.02, (3.2 + WIN["y1"]) / 2, czl), M["wall"], bevel=0)
SHELL = {"floor", "ceiling", "wall_right", "wall_front", "wall_back_main", "wall_back_low", "wall_back_high",
         "wall_left_main", "wall_left_low", "wall_left_high"}

# 窗框：黑色鋼構細格子（後牆 5 格、左牆 4 格，橫條等高所以繞角連續）
wh = WIN["y1"] - WIN["y0"]
wy = (WIN["y0"] + WIN["y1"]) / 2
for name, size, at in [
    ("win_top", (w, 0.06, 0.1), (cx, WIN["y1"], -3.98)),
    ("win_sill", (w, 0.06, 0.16), (cx, WIN["y0"], -3.95)),
    ("win_r", (0.06, wh, 0.1), (WIN["x1"], wy, -3.98)),
    ("winl_top", (0.1, 0.06, wl), (-3.98, WIN["y1"], czl)),
    ("winl_sill", (0.16, 0.06, wl), (-3.95, WIN["y0"], czl)),
    ("winl_end", (0.1, wh, 0.06), (-3.98, wy, WINL["z1"])),
    ("win_corner", (0.1, wh + 0.06, 0.1), (-3.97, wy, -3.97)),  # 轉角角柱
]:
    box(name, size, at, M["frameDark"], bevel=0.003)
for i in range(1, 5):
    box(f"win_v{i}", (0.022, wh, 0.05), (WIN["x0"] + w * i / 5, wy, -3.99), M["frameDark"], bevel=0.002)
for i in range(1, 4):
    box(f"winl_v{i}", (0.05, wh, 0.022), (-3.99, wy, WINL["z0"] + wl * i / 4), M["frameDark"], bevel=0.002)
for i in range(1, 5):
    box(f"win_h{i}", (w, 0.022, 0.05), (cx, WIN["y0"] + wh * i / 5, -3.99), M["frameDark"], bevel=0.002)
    box(f"winl_h{i}", (0.05, 0.022, wl), (-3.99, WIN["y0"] + wh * i / 5, czl), M["frameDark"], bevel=0.002)
for name, size, at in [
    ("skirt_left", (0.02, 0.1, 8), (-3.99, 0.05, 0)),
    ("skirt_right", (0.02, 0.1, 8), (3.99, 0.05, 0)),
    ("skirt_back", (8 - (WIN["x1"] + 4), 0.1, 0.02), ((WIN["x1"] + 4) / 2, 0.05, -3.99)),
]:
    box(name, size, at, M["walnutDark"], bevel=0.002)

# ---------------------------------------------------------------- CD 牆（左牆，和 props.ts 的 SHELF 對齊）
box("shelf_board", (0.04, 2.25, 3.9), (-3.97, 1.42, 0), M["walnut"], bevel=0.01)
for r in range(5):
    box(f"ledge_{r}", (0.09, 0.025, 3.8), (-3.91, 2.27 - r * 0.42 - 0.15, 0), M["walnutDark"], bevel=0.004)

# ---------------------------------------------------------------- 唱盤架、格柵牆、喇叭（後牆中間）
# 唱盤 plinth／platter 的位置與高度不能動（props.ts deck()、鏡頭、放唱片動畫都依賴）。
# 底下不再是矮櫃，而是霧黑兩層細架：上層台面（x -0.74~0.28，不對稱）托住 plinth、左邊的管機與 VU 表（stage.ts，
# 原位不動，邊緣各留 1.5~3 cm）；下層板（頂 y 0.33）靠著一塊矮擋板斜靠 5 張素色封套的黑膠。細柱在後面偏右
box("stand_foot", (0.9, 0.02, 0.30), (-0.31, 0.01, -3.72), M["frameDark"], bevel=0.004)
box("stand_post", (0.05, 0.655, 0.05), (0, 0.3475, -3.80), M["frameDark"], bevel=0.003)
box("stand_shelf", (0.76, 0.03, 0.32), (-0.34, 0.315, -3.66), M["frameDark"], bevel=0.004)
box("stand_backstop", (0.60, 0.20, 0.012), (-0.40, 0.43, -3.80), M["frameDark"], bevel=0.002)
box("stand_top", (1.02, 0.025, 0.45), (-0.23, 0.6875, -3.665), M["frameDark"], bevel=0.004)
# 斜靠的黑膠封套：後仰 18°，靠在擋板上緣；順著法線錯開 1.2 cm
_TH = math.radians(18)
_s = (0.2 + 0.0025 * math.sin(_TH)) / math.cos(_TH)
_zb = -3.794 + _s * math.sin(_TH) + 0.0025 * math.cos(_TH)
for _i, (_x, _mat) in enumerate(zip([-0.48, -0.44, -0.4, -0.36, -0.32], ("tan", "oxblood", "bone", "tan", "oxblood"))):
    _by = 0.332 + _i * 0.012 * math.sin(_TH)
    _bz = _zb + _i * 0.012 * math.cos(_TH)
    _o = box(f"record_{_i}", (0.31, 0.31, 0.005), (_x, _by + 0.155 * math.cos(_TH), _bz - 0.155 * math.sin(_TH)), M[_mat], bevel=0)
    _o.rotation_euler = (-_TH, 0, 0)  # Blender 繞 x 負向 = 頂端往牆（Three 的 -z）倒
box("plinth", (0.5, 0.09, 0.38), (0, 0.745, -3.66), M["walnutDark"], bevel=0.012)
cyl("platter", 0.155, 0.018, (-0.05, 0.8, -3.66), M["bone"], verts=96)
# 格柵牆：中間 x ±1.25、y 0.35~2.25 讓給即時燈箱（矩形寫進 lights.json 的 lightbox，前端讀同一份）。
# 燈箱區改成略凹的近黑啞光牆面（一路到地板，唱盤架後面也是深色），四周留一圈格柵當外框：左右各 3 根＋上緣橫條
OCCLUDERS = [{"name": "stand_foot", "x0": -0.76, "x1": 0.14, "y0": 0.0, "y1": 0.02, "z0": -3.87, "z1": -3.57}, {"name": "stand_post", "x0": -0.025, "x1": 0.025, "y0": 0.02, "y1": 0.675, "z0": -3.825, "z1": -3.775}, {"name": "stand_shelf", "x0": -0.72, "x1": 0.04, "y0": 0.3, "y1": 0.33, "z0": -3.82, "z1": -3.5}, {"name": "stand_backstop", "x0": -0.7, "x1": -0.1, "y0": 0.33, "y1": 0.53, "z0": -3.806, "z1": -3.794}, {"name": "records", "x0": -0.635, "x1": -0.165, "y0": 0.3312, "y1": 0.6424, "z0": -3.8246, "z1": -3.6784}, {"name": "stand_top", "x0": -0.74, "x1": 0.28, "y0": 0.675, "y1": 0.7, "z0": -3.89, "z1": -3.44}, {"name": "plinth", "x0": -0.25, "x1": 0.25, "y0": 0.7, "y1": 0.79, "z0": -3.85, "z1": -3.47}, {"name": "tube_amp", "x0": -0.64, "x1": -0.28, "y0": 0.7, "y1": 0.875, "z0": -3.865, "z1": -3.735}, {"name": "vu_left", "x0": -0.71, "x1": -0.53, "y0": 0.72, "y1": 0.84, "z0": -3.53, "z1": -3.47}, {"name": "vu_right", "x0": -0.51, "x1": -0.33, "y0": 0.72, "y1": 0.84, "z0": -3.53, "z1": -3.47}, {"name": "speaker_left", "x0": -1.74, "x1": -1.36, "y0": 0.0, "y1": 1.05, "z0": -3.79, "z1": -3.45}, {"name": "speaker_right", "x0": 1.36, "x1": 1.74, "y0": 0.0, "y1": 1.05, "z0": -3.79, "z1": -3.45}]  # 前端做燈箱遮擋測試用的包圍盒（公尺，Three 座標）；管機與 VU 是 stage.ts 的即時物件，位置要和它一致
LIGHTBOX = {"x0": -1.25, "x1": 1.25, "y0": 0.35, "y1": 2.25, "z": -3.93}
PANEL_HALF, PANEL_TOP = 1.55, 2.30  # 外框含格柵的半寬與頂
# 燈箱底牆：深墨藍灰泥（現代英式的墨藍漆牆，類似 Hague Blue），跟房間同一種灰泥質地，四周格柵當框
M["recess"] = textured("recess", "painted_plaster_wall", scale=3.0, tint="#33465c", nor=0.12)
box("lightbox_recess", (2 * 1.25, LIGHTBOX["y1"], 0.012), (0, LIGHTBOX["y1"] / 2, -3.996), M["recess"], bevel=0)
for sx in (-1, 1):
    for k in range(3):
        box(f"slat_{sx}_{k}", (0.06, PANEL_TOP - 0.02, 0.04), (sx * (1.30 + 0.11 * k), (PANEL_TOP + 0.02) / 2, -3.955), M["walnut"], bevel=0.004)
    box(f"slat_back_{sx}", (PANEL_HALF - 1.25, PANEL_TOP, 0.012), (sx * (1.25 + PANEL_HALF) / 2, PANEL_TOP / 2, -3.985), M["walnutDark"], bevel=0)
box("slat_back_top", (2 * 1.25, PANEL_TOP - LIGHTBOX["y1"], 0.012), (0, (PANEL_TOP + LIGHTBOX["y1"]) / 2, -3.985), M["walnutDark"], bevel=0)
box("slat_rail_top", (2 * PANEL_HALF, PANEL_TOP - LIGHTBOX["y1"], 0.05), (0, (PANEL_TOP + LIGHTBOX["y1"]) / 2, -3.95), M["walnutDark"], bevel=0.004)
for x in (-1.55, 1.55):
    box(f"speaker_{x}", (0.38, 1.05, 0.34), (x, 0.525, -3.62), M["walnut"], bevel=0.012)
    box(f"grill_{x}", (0.32, 0.98, 0.012), (x, 0.53, -3.446), M["grill"], bevel=0.003)
    for y, r in ((0.33, 0.12), (0.72, 0.06)):
        cyl(f"cone_{x}_{y}", r, 0.01, (x, y, -3.438), M["cone"], facing_z=True)
# ---------------------------------------------------------------- 聽音樂的角落：地毯、躺椅、邊几、桌燈、圓几
box("rug", (3.4, 0.012, 2.6), (0, 0.006, -1.7), M["rug"], bevel=0.004)
place("mid_century_lounge_chair", (-1.05, 0, -1.3), yaw=125)
place("side_table_01", (-1.85, 0, -1.0), yaw=20)
place("desk_lamp_arm_01", (-1.85, 0.55, -1.05), yaw=150)
place("coffee_table_round_01", (0.35, 0, -1.75), scale=0.75)
place("potted_plant_04", (0.45, 0.37, -1.7))

# ---------------------------------------------------------------- 窗邊的植物與書架
place("potted_plant_01", (-3.3, 0, -3.45), yaw=30)
place("potted_plant_02", (-2.2, 0, -3.55), yaw=-20)
place("wooden_bookshelf_worn", (-3.7, 0, 2.9), yaw=90)

# ---------------------------------------------------------------- 咖啡角（右牆中段）
box("counter", (0.62, 0.9, 1.6), (3.68, 0.45, -1.1), M["walnut"], bevel=0.012)
box("counter_top", (0.66, 0.04, 1.64), (3.67, 0.92, -1.1), M["bone"], bevel=0.006)
place("worn_metal_rack", (3.68, 0, 0.35), yaw=-90)
place("vintage_electric_kettle", (3.62, 0.94, -0.5), yaw=-120)
place("brass_vase_02", (3.7, 0.94, -1.75), scale=0.7)
place("ceramic_vase_03", (3.72, 0.94, -1.55))
place("potted_plant_02", (3.45, 0, -2.25), yaw=60, scale=0.8)

# ---------------------------------------------------------------- 唱片箱、放映室的門（後牆右邊）
box("crate", (0.72, 0.36, 0.42), (2.45, 0.18, -3.55), M["walnut"], bevel=0.01)
box("door_frame", (1.15, 2.2, 0.06), (3.25, 1.1, -3.97), M["walnutDark"], bevel=0.01)
box("door", (0.98, 2.08, 0.04), (3.25, 1.04, -3.94), M["oxblood"], bevel=0.008)
for y in (0.55, 1.5):
    box(f"door_panel_{y}", (0.78, 0.7, 0.012), (3.25, y, -3.915), M["oxblood"], bevel=0.01)
box("sign_back", (1.12, 0.42, 0.03), (3.25, 2.42, -3.975), M["walnutDark"], bevel=0.008)


# ---------------------------------------------------------------- 串燈（天花板三串，自然下垂）與蠟燭
FAIRY = []   # 燈泡位置（Three 座標），輸出給網頁做閃爍
CANDLES = []  # 火焰位置


def strand(a, b, sag, step=0.18):
    a, b = Vector(a), Vector(b)
    n = max(2, int((b - a).length / step))
    pts = []
    for i in range(n + 1):
        t = i / n
        p = a.lerp(b, t)
        p.y -= sag * 4 * t * (1 - t)
        pts.append(p)
    # 電線：用一條有粗細的曲線
    curve = bpy.data.curves.new("wire", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.0025
    spl = curve.splines.new("POLY")
    spl.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        spl.points[i].co = (*P(p.x, p.y, p.z), 1)
    wire = bpy.data.objects.new("wire", curve)
    scene.collection.objects.link(wire)
    wire.data.materials.append(M["wire"])
    STATIC.append(wire)
    for p in pts[1:-1]:
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012, segments=10, ring_count=6, location=P(p.x, p.y - 0.02, p.z))
        bulb = bpy.context.object
        bulb.data.materials.append(M["fairy"])
        STATIC.append(bulb)
        FAIRY.append([round(p.x, 3), round(p.y - 0.02, 3), round(p.z, 3)])


strand((-3.95, 3.12, -3.0), (3.95, 3.12, -3.0), 0.4)
strand((-3.95, 3.12, -1.5), (3.95, 3.12, -1.5), 0.35)
strand((-3.95, 3.12, 0.0), (3.95, 3.12, 0.0), 0.3)
strand((WIN["x0"] + 0.05, WIN["y1"] + 0.06, -3.9), (WIN["x1"] - 0.05, WIN["y1"] + 0.06, -3.9), 0.18, step=0.14)


def candle(at, h):
    cyl("candle", 0.028, h, (at[0], at[1] + h / 2, at[2]), M["candle"], verts=20)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.012, segments=10, ring_count=8, location=P(at[0], at[1] + h + 0.018, at[2]))
    f = bpy.context.object
    f.scale = (1, 1, 1.8)
    f.data.materials.append(M["flame"])
    STATIC.append(f)
    CANDLES.append([at[0], round(at[1] + h + 0.02, 3), at[2]])


candle((0.5, 0.37, -1.62), 0.12)
candle((0.58, 0.37, -1.7), 0.08)
# 原本立在音響櫃上的兩根蠟燭，櫃子拿掉後改放唱片箱（頂面 y 0.36）
candle((2.3, 0.36, -3.5), 0.14)
candle((2.4, 0.36, -3.58), 0.09)

# ---------------------------------------------------------------- 吊燈（燈罩發光的強度依場景調）
lamp_meshes = []
lamp_meshes += place("modern_ceiling_lamp_01", (0.35, 3.2 - 1.17, -1.75))
lamp_meshes += place("lantern_chandelier_01", (-1.05, 3.2, -1.1))
lamp_meshes += place("hanging_industrial_lamp", (3.5, 3.2, -1.1))
GLOW = []  # 燈罩內側的發光材質
for o in lamp_meshes:
    for m in o.data.materials:
        if m and m not in GLOW and any(k in m.name.lower() for k in ("glass", "shade", "bulb", "light", "paper", "emiss")):
            GLOW.append(m)
print("發光材質：", [m.name for m in GLOW])

# ---------------------------------------------------------------- 燈光
LIGHTS = {}


def area(name, at, aim, size, size_y=None):
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
    LIGHTS[name] = L


def point(name, at, radius=0.08):
    bpy.ops.object.light_add(type="POINT", location=P(*at))
    L = bpy.context.object
    L.name = name
    L.data.shadow_soft_size = radius
    L.visible_camera = False
    LIGHTS[name] = L


area("spot_wall", (-1.6, 3.1, 0), (-4, 1.45, 0), 0.6)
area("spot_deck", (0.2, 3.1, -2.4), (0, 0.75, -3.66), 0.4)
area("spot_frames", (1.8, 3.1, 1.8), (4, 1.55, 2.3), 0.6)
area("window_fill", (cx, 1.65, -3.9), (cx, 1.0, 0), w, WIN["y1"] - WIN["y0"])
# 左牆那段窗另有一盞面光朝 +x；兩盞每平方公尺的亮度與原本一片窗相同（原窗 2.15 x 2.93）
area("window_fill_l", (-3.9, 1.65, czl), (0, 1.0, czl), wl, WIN["y1"] - WIN["y0"])
WF_ORIG = 2.15 * 2.93
WF_SCALE = {"window_fill": w * wh / WF_ORIG, "window_fill_l": wl * wh / WF_ORIG * 0.85}
# 燈箱對地板與唱盤架的反光：弱的暖白面光，位置在凹牆前緣，朝房間內側偏下。即時燈箱放歌時會變暗，所以只給保守的底
area("lightbox_glow", (0, (LIGHTBOX["y0"] + LIGHTBOX["y1"]) / 2, -3.9), (0, 0.5, -1.2), LIGHTBOX["x1"] - LIGHTBOX["x0"], LIGHTBOX["y1"] - LIGHTBOX["y0"])
point("pendant", (0.35, 2.35, -1.75), 0.1)
point("lantern", (-1.05, 2.6, -1.1), 0.12)
point("counter_lamp", (3.5, 1.95, -1.1), 0.08)
point("desk_lamp", (-1.95, 1.2, -1.2), 0.04)
point("marquee", (3.25, 2.4, -3.6), 0.2)
for i, z in enumerate((-3.0, -1.5, 0.0)):
    for j, x in enumerate((-2.6, 0.0, 2.6)):
        point(f"fairy_{i}_{j}", (x, 2.85, z), 0.6)
for i, c in enumerate(CANDLES):
    point(f"candle_{i}", (c[0], c[1] + 0.03, c[2]), 0.02)
bpy.ops.object.light_add(type="SUN", location=P(0, 6, -8))
LIGHTS["sun"] = bpy.context.object
LIGHTS["sun"].data.angle = math.radians(1.2)

# 環境光（窗外）
world = bpy.data.worlds.new("world")
scene.world = world
world.use_nodes = True
WN, WL = world.node_tree.nodes, world.node_tree.links
env = WN.new("ShaderNodeTexEnvironment")
wmap = WN.new("ShaderNodeMapping")
wco = WN.new("ShaderNodeTexCoord")
WL.new(wco.outputs["Generated"], wmap.inputs["Vector"])
WL.new(wmap.outputs["Vector"], env.inputs["Vector"])
WL.new(env.outputs["Color"], WN["Background"].inputs["Color"])

# 三個場景。sun_dir 是光前進的方向（Three 座標）；從後窗往門口斜照
MOODS = {
    "afternoon": {
        "hdri": "autumn_forest_01", "hdri_strength": 1.6, "hdri_u": None,
        "sun": (6.5, (1.0, 0.82, 0.58), (0.35, -0.42, 1.0)),
        "window_fill": (220, (0.95, 0.97, 1.0)), "lightbox_glow": (5, (1.0, 0.93, 0.82)),
        "spot_wall": (70, (1.0, 0.9, 0.78)), "spot_deck": (20, (1.0, 0.9, 0.78)), "spot_frames": (0, None),
        "pendant": (0, None), "lantern": (0, None), "counter_lamp": (0, None), "desk_lamp": (0, None), "marquee": (3, (1.0, 0.76, 0.45)),
        "glow": 0.0, "exposure": 0.4,
        "fairy": (0, None), "candle": (0, None), "fairy_glow": 0.0, "flame_glow": 0.0,
    },
    "tipsy": {
        "hdri": "grasslands_sunset", "hdri_strength": 0.35, "hdri_u": "sun",
        "sun": (2.2, (1.0, 0.45, 0.25), (0.25, -0.12, 1.0)),
        "window_fill": (40, (0.9, 0.55, 0.6)), "lightbox_glow": (12, (1.0, 0.86, 0.66)),
        "spot_wall": (130, (1.0, 0.66, 0.4)), "spot_deck": (110, (1.0, 0.64, 0.38)), "spot_frames": (30, (1.0, 0.6, 0.4)),
        "pendant": (32, (1.0, 0.62, 0.34)), "lantern": (30, (1.0, 0.58, 0.3)), "counter_lamp": (20, (1.0, 0.65, 0.38)), "desk_lamp": (10, (1.0, 0.7, 0.45)), "marquee": (18, (1.0, 0.7, 0.4)),
        "glow": 4.0, "exposure": -0.45,
        "fairy": (6, (1.0, 0.72, 0.4)), "candle": (3.5, (1.0, 0.55, 0.25)), "fairy_glow": 9.0, "flame_glow": 14.0,
    },
    "night": {
        "hdri": "dikhololo_night", "hdri_strength": 0.45, "hdri_u": None,
        "sun": (3.0, (0.42, 0.56, 1.0), (0.3, -0.35, 1.0)),
        "window_fill": (35, (0.45, 0.58, 1.0)), "lightbox_glow": (16, (1.0, 0.9, 0.76)),
        "spot_wall": (90, (1.0, 0.72, 0.48)), "spot_deck": (60, (1.0, 0.76, 0.52)), "spot_frames": (0, None),
        "pendant": (0, None), "lantern": (16, (1.0, 0.6, 0.3)), "counter_lamp": (0, None), "desk_lamp": (8, (1.0, 0.68, 0.42)), "marquee": (10, (1.0, 0.7, 0.4)),
        "glow": 2.5, "exposure": -0.3,
        "fairy": (4, (1.0, 0.7, 0.38)), "candle": (3.0, (1.0, 0.52, 0.22)), "fairy_glow": 7.0, "flame_glow": 12.0,
    },
}
HDRI_SUN_U = {"autumn_forest_01": 0.296, "grasslands_sunset": 0.599, "dikhololo_night": 0.341}


def u_of(d):
    return (math.atan2(d.y, -d.x) / (2 * math.pi) + 0.5) % 1.0


def rotate_world_to_window(hdri):
    """把環境光貼圖轉到「太陽（或最亮處）剛好在窗外」：窗外方向是 Three 的 -z = Blender 的 +y"""
    target = HDRI_SUN_U[hdri]
    out = Vector((0.0, 1.0, 0.25)).normalized()
    best = min(range(360), key=lambda deg: abs(((u_of(Euler((0, 0, math.radians(deg))).to_matrix() @ out) - target + 0.5) % 1.0) - 0.5))
    wmap.inputs["Rotation"].default_value = (0, 0, math.radians(best))


def apply_mood(name):
    mood = MOODS[name]
    env.image = bpy.data.images.load(os.path.join(ASSETS, "hdri", mood["hdri"] + ".hdr"), check_existing=True)
    rotate_world_to_window(mood["hdri"])
    WN["Background"].inputs["Strength"].default_value = mood["hdri_strength"]
    for key, L in LIGHTS.items():
        if key == "sun":
            energy, color, d = mood["sun"]
            L.data.energy = energy
            L.data.color = color
            L.rotation_euler = Vector((d[0], -d[2], d[1])).to_track_quat("-Z", "Y").to_euler()
            continue
        if key.startswith("fairy_"):
            energy, color = mood["fairy"]
        elif key.startswith("candle_"):
            energy, color = mood["candle"]
        elif key == "window_fill_l":
            energy, color = mood["window_fill"]
        else:
            energy, color = mood[key]
        energy *= WF_SCALE.get(key, 1.0)
        L.data.energy = energy
        if color:
            L.data.color = color
    for m in GLOW:
        b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b:
            b.inputs["Emission Color"].default_value = (1.0, 0.72, 0.42, 1)
            b.inputs["Emission Strength"].default_value = mood["glow"]
    M["fairy"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = mood["fairy_glow"]
    M["flame"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = mood["flame_glow"]
    scene.view_settings.exposure = mood["exposure"]


# ---------------------------------------------------------------- 合併、展 UV
bpy.ops.object.select_all(action="DESELECT")
for o in STATIC:
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
bpy.ops.object.convert(target="MESH")
for o in [o for o in bpy.data.objects if o.type == "CURVE"]:
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    # 解除父子關係並保留位置，才能合併
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
bpy.ops.object.select_all(action="DESELECT")
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


shell = join([o for o in bpy.data.objects if o.type == "MESH" and o.name in SHELL], "room_shell")
props = join([o for o in bpy.data.objects if o.type == "MESH" and o is not shell], "room_props")
for obj, margin in ((shell, 0.004), (props, 0.002)):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    keep_render = obj.data.uv_layers.active_index
    uv = obj.data.uv_layers.new(name="bake")
    obj.data.uv_layers.active = uv
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    # 原本的材質貼圖仍用原來的 UV
    for i, layer in enumerate(obj.data.uv_layers):
        layer.active_render = layer.name != "bake" and i == keep_render

if OPT["--measure"]:
    exec(open(os.path.join(HERE, "measure_cd.py"), encoding="utf8").read())
    print("CD牆亮度：", json.dumps(measure_cd_wall(props, os.path.abspath(OPT["--measure"]), ONLY), ensure_ascii=False), flush=True)
    sys.exit(0)

# ---------------------------------------------------------------- 烘焙
scene.render.engine = "CYCLES"
cy = scene.cycles
cy.samples = SAMPLES
cy.use_denoising = True
cy.sample_clamp_direct = 6.0
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
scene.render.bake.use_pass_direct = True
scene.render.bake.use_pass_indirect = True
scene.render.bake.use_pass_color = True
scene.render.bake.margin = 8
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 84
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass
os.makedirs(OUT, exist_ok=True)


def bake(obj, size, name):
    img = bpy.data.images.new(name, size, size, alpha=False)
    for mat in obj.data.materials:
        if not (mat and mat.node_tree):
            continue
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


# 窗外的景：每個場景各算一張。L 型轉角窗外是兩片相接的背景牆（後方 z=-9、左方 x=-9，在 (-9,-9) 相接），
# 兩片從同一個眼睛位置 EYE 各用透視相機直拍（含 shift 補偏心），所以貼回去看是連續的。
# 兩張並排存成一張 jpg：左半是後方、右半是左方；window_view 網格的 UV 各取一半
EYE = (-2.4, 1.6, -1.0)
VIEW = {"far": 9.0, "w": 9.0, "h": 6.0, "x_far": (-9.0, 0.0), "z_far": (-9.0, 0.0), "res": (1200, 800)}


def render_view(name):
    for o in (shell, props):
        o.hide_render = True
    vw, vh = VIEW["res"]
    scene.render.resolution_x, scene.render.resolution_y = vw, vh
    scene.cycles.samples = 16
    eye = P(*EYE)
    # (名稱, 朝向（Three）, 到牆距離, 牆中心偏離眼睛多少)
    shots = [
        ("back", (0, 0, -1), VIEW["far"] + EYE[2], (sum(VIEW["x_far"]) / 2 - EYE[0])),
        ("left", (-1, 0, 0), VIEW["far"] + EYE[0], -(sum(VIEW["z_far"]) / 2 - EYE[2])),
    ]
    files = []
    for tag, d, dist, off in shots:
        cam_data = bpy.data.cameras.new("view_cam")
        cam = bpy.data.objects.new("view_cam", cam_data)
        scene.collection.objects.link(cam)
        cam.location = eye
        cam.rotation_euler = (P(*d) - P(0, 0, 0)).to_track_quat("-Z", "Y").to_euler()
        cam_data.sensor_fit = "HORIZONTAL"
        cam_data.angle = 2 * math.atan((VIEW["w"] / 2) / dist)
        cam_data.shift_x = off / VIEW["w"]
        scene.camera = cam
        path = os.path.join(OUT, f"_{name}_{tag}.png")
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        files.append(path)
        bpy.data.objects.remove(cam)
    scene.render.image_settings.file_format = "JPEG"
    # 並排合成（用 PNG 的 8 bit 值，不再經過色彩管理）
    import numpy as np

    imgs = []
    for f in files:
        im = bpy.data.images.load(f, check_existing=False)
        im.colorspace_settings.name = "Non-Color"
        a = np.empty(vw * vh * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        imgs.append(a.reshape(vh, vw, 4))
    both = np.concatenate(imgs, axis=1)
    out = bpy.data.images.new(f"{name}_view", vw * 2, vh, alpha=False, float_buffer=False)
    out.colorspace_settings.name = "Non-Color"
    out.pixels.foreach_set(both.reshape(-1))
    out.filepath_raw = os.path.join(OUT, f"{name}_view.jpg")
    out.file_format = "JPEG"
    out.save(quality=84)
    for f in files:
        os.remove(f)
    scene.cycles.samples = SAMPLES
    for o in (shell, props):
        o.hide_render = False


baked = {}
for mood in ONLY:
    apply_mood(mood)
    baked[mood] = {"room_shell": bake(shell, SIZE, f"{mood}_shell"), "room_props": bake(props, SIZE, f"{mood}_props")}
    render_view(mood)

# ---------------------------------------------------------------- 匯出：烘焙材質＋佔位貼圖（網頁依場景載入 JPG）
placeholder = bpy.data.images.new("placeholder", 4, 4)
tex_nodes = {}
for obj in (shell, props):
    mat = bpy.data.materials.new(f"{obj.name}_baked")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = baked[ONLY[0]][obj.name]
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "bake"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for layer in [l for l in obj.data.uv_layers if l.name != "bake"]:
        obj.data.uv_layers.remove(layer)
    tex_nodes[obj.name] = tex

# 窗外的 L 型背景牆（單一網格兩個四邊形，法線朝房間）。UV 左半 = 後方（u 0~0.5），右半 = 左方（u 0.5~1）
import bmesh

YLO, YHI = EYE[1] - VIEW["h"] / 2, EYE[1] + VIEW["h"] / 2
(bx0, bx1), (lz0, lz1) = VIEW["x_far"], VIEW["z_far"]
FAR = -VIEW["far"]
quad_back = [(bx0, YLO, FAR), (bx1, YLO, FAR), (bx1, YHI, FAR), (bx0, YHI, FAR)]
# 左方牆看出去 右 = Three 的 -z，所以 u 從 z=lz1（近，u 0.5）走到 z=lz0（遠，u 1）
quad_left = [(FAR, YLO, lz1), (FAR, YLO, lz0), (FAR, YHI, lz0), (FAR, YHI, lz1)]
vm = bpy.data.meshes.new("window_view")
view = bpy.data.objects.new("window_view", vm)
scene.collection.objects.link(view)
bm = bmesh.new()
uvs = []
for quad, u0 in ((quad_back, 0.0), (quad_left, 0.5)):
    vs = [bm.verts.new(P(*q)) for q in quad]
    bm.faces.new(vs)
    uvs += [(u0, 0), (u0 + 0.5, 0), (u0 + 0.5, 1), (u0, 1)]
uvl = bm.loops.layers.uv.new("UVMap")
for f, i in zip(bm.faces, (0, 4)):
    for lp, uv in zip(f.loops, uvs[i : i + 4]):
        lp[uvl].uv = uv
bm.to_mesh(vm)
bm.free()
vmat = bpy.data.materials.new("window_view")
vmat.use_nodes = True
vn = vmat.node_tree.nodes
for n in list(vn):
    vn.remove(n)
vo = vn.new("ShaderNodeOutputMaterial")
ve = vn.new("ShaderNodeEmission")
vt = vn.new("ShaderNodeTexImage")
vt.image = placeholder
vmat.node_tree.links.new(vt.outputs["Color"], ve.inputs["Color"])
vmat.node_tree.links.new(ve.outputs["Emission"], vo.inputs["Surface"])
view.data.materials.append(vmat)

for o in [o for o in bpy.data.objects if o.type in ("LIGHT", "CAMERA")]:
    bpy.data.objects.remove(o)
for tex in tex_nodes.values():
    tex.image = placeholder
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, "room.glb"),
    export_format="GLB",
    export_image_format="JPEG",
    export_apply=True,
    export_lights=False,
    export_cameras=False,
)
with open(os.path.join(OUT, "lights.json"), "w") as f:
    # lightbox：即時燈箱的矩形（公尺，Three 座標，z 是前緣）。前端讀這一份，不要另外寫數字
    json.dump({"fairy": FAIRY, "candles": CANDLES, "lightbox": LIGHTBOX, "occluders": OCCLUDERS}, f)
print("完成：", os.path.join(OUT, "room.glb"), f"串燈 {len(FAIRY)} 顆、蠟燭 {len(CANDLES)} 根", flush=True)

# ---------------------------------------------------------------- 預覽（跟網頁看到的一樣：直接顯示貼圖）
if OPT["--preview"]:
    pdir = os.path.abspath(OPT["--preview"])
    os.makedirs(pdir, exist_ok=True)
    scene.render.resolution_x, scene.render.resolution_y = 960, 540
    scene.cycles.samples = 4
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.world = None
    CAMS = {"door": ((0.5, 1.62, 3.6), (-0.5, 1.2, -3.6), 54), "deck0": ((0, 1.75, -1.85), (0, 0.8, -3.65), 46), "window": ((-0.2, 1.55, -0.6), (-2.7, 1.5, -3.1), 50), "coffee": ((0.5, 1.5, 1.2), (3.8, 1.1, -1.0), 55)}
    cams = {}
    for name, (pos, look, fov) in CAMS.items():
        cd = bpy.data.cameras.new(name)
        cd.sensor_fit = "VERTICAL"
        cd.angle = math.radians(fov)
        c = bpy.data.objects.new(name, cd)
        scene.collection.objects.link(c)
        c.location = P(*pos)
        c.rotation_euler = (P(*look) - P(*pos)).to_track_quat("-Z", "Y").to_euler()
        cams[name] = c
    for mood in ONLY:
        for oname, tex in tex_nodes.items():
            tex.image = baked[mood][oname]
        vt.image = bpy.data.images.load(os.path.join(OUT, f"{mood}_view.jpg"), check_existing=True)
        for name, c in cams.items():
            scene.camera = c
            scene.render.filepath = os.path.join(pdir, f"{mood}-{name}.jpg")
            bpy.ops.render.render(write_still=True)
    print("預覽：", pdir)

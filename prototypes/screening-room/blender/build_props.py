"""放映室會動的東西：門、DVD 盒（可開蓋）、光碟、播放機（托盤會進出）、銀幕畫面、燈罩、窗、海報、投影機鏡頭、跑馬燈招牌。
匯出 props.glb：材質用 PBR，網頁換貼圖、做動畫。位置與 build_screening.py 的 layout.json 一致。

執行：/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P <本檔> -- --out <資料夾>
DVD 盒的座標（Three）：書背在 x=0，往 +x 是寬 W；y 往上是高 H；z=0 是背面、z=D 是正面（蓋子）。
封面是一張展開圖：u 0–0.4725 背面、0.4725–0.5275 書背、0.5275–1 正面（跟真的 DVD 封面紙一樣）。
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath("prototypes/screening-room/home/room")
layout = json.load(open(os.path.join(OUT, "layout.json")))


def P(x, y, z):
    return Vector((x, -z, y))


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)]
    return [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c] + [1.0]


def mat(name, color, rough=0.5, metal=0.0, emit=None, strength=0.0, clearcoat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = lin(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if clearcoat:
        b.inputs["Coat Weight"].default_value = clearcoat
    if emit:
        b.inputs["Emission Color"].default_value = lin(emit)
        b.inputs["Emission Strength"].default_value = strength
    return m


M = {
    "door": mat("door", "#5e2219", 0.5), "brass": mat("brass", "#a8854f", 0.3, 0.9),
    "case_plastic": mat("case_plastic", "#141313", 0.32), "cover": mat("cover", "#d8d2c6", 0.35, clearcoat=1.0),
    "disc_label": mat("disc_label", "#e9e4da", 0.4), "disc_data": mat("disc_data", "#c9ccd2", 0.12, 1.0),
    "player_body": mat("player_body", "#1c1b1a", 0.38, 0.6), "player_front": mat("player_front", "#0b0b0b", 0.18),
    "player_display": mat("player_display", "#0b0b0b", 0.3, emit="#7cf2c2", strength=0.0), "player_tray": mat("player_tray", "#121212", 0.4),
    "screen": mat("screen", "#000000", 1.0, emit="#ffffff", strength=0.0), "shade": mat("shade", "#e6d7ba", 0.95, emit="#ffc98a", strength=1.0),
    "night": mat("night", "#0c1520", 1.0, emit="#1b2c40", strength=1.0), "poster": mat("poster", "#777777", 0.6),
    "lens": mat("lens", "#000000", 0.1, emit="#fff1dc", strength=0.0), "sign": mat("sign", "#2a1c13", 0.8, emit="#f3c47f", strength=0.4),
}


def mesh_obj(name, quads, material, origin=(0, 0, 0), parent=None, smooth=False):
    """quads：[(四個 Three 座標點, 四個 uv)]；物件原點放在 origin（Three 座標）"""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("uv")
    o = P(*origin)
    for pts, uvs in quads:
        vs = [bm.verts.new(P(*p) - o) for p in pts]
        f = bm.faces.new(vs)
        for loop, t in zip(f.loops, uvs):
            loop[uv].uv = t
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    me.materials.append(material)
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    place_world(ob, o, parent)
    return ob


def cuboid(x0, x1, y0, y1, z0, z1):
    """六面盒的四邊形（uv 用 0/1，只給純色材質用）"""
    c = lambda x, y, z: (x, y, z)
    F = [
        [c(x0, y0, z1), c(x1, y0, z1), c(x1, y1, z1), c(x0, y1, z1)],  # +z
        [c(x1, y0, z0), c(x0, y0, z0), c(x0, y1, z0), c(x1, y1, z0)],  # -z
        [c(x1, y0, z1), c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, z1)],  # +x
        [c(x0, y0, z0), c(x0, y0, z1), c(x0, y1, z1), c(x0, y1, z0)],  # -x
        [c(x0, y1, z1), c(x1, y1, z1), c(x1, y1, z0), c(x0, y1, z0)],  # +y
        [c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, z1), c(x0, y0, z1)],  # -y
    ]
    U = [(0, 0), (1, 0), (1, 1), (0, 1)]
    return [(f, U) for f in F]


def join_quads(*boxes):
    out = []
    for b in boxes:
        out += b
    return out


def place_world(ob, world_pos, parent=None):
    """先掛父物件、更新場景，再設世界座標。直接改 .parent 會把 location 當成相對位置，位置會加兩次。"""
    if parent:
        ob.parent = parent
    bpy.context.view_layer.update()
    ob.matrix_world = Matrix.Translation(world_pos)
    bpy.context.view_layer.update()


def empty(name, at=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    place_world(e, P(*at), parent)
    return e


def ring(name, r_out, r_in, z0, z1, center, material_top, material_bottom, seg=72, origin=None):
    """光碟：有洞的薄圓片。上面那面的 uv 是平面投影（給標籤圖），下面是資料面"""
    cxp, cyp = center[0], center[1]
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("uv")
    o = P(*(origin or (cxp, cyp, z0)))
    def V(x, y, z):
        return bm.verts.new(P(x, y, z) - o)
    top_o, top_i, bot_o, bot_i = [], [], [], []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ca, sa = math.cos(a), math.sin(a)
        top_o.append(V(cxp + r_out * ca, cyp + r_out * sa, z1))
        top_i.append(V(cxp + r_in * ca, cyp + r_in * sa, z1))
        bot_o.append(V(cxp + r_out * ca, cyp + r_out * sa, z0))
        bot_i.append(V(cxp + r_in * ca, cyp + r_in * sa, z0))
    me.materials.append(material_top)
    me.materials.append(material_bottom)
    for i in range(seg):
        j = (i + 1) % seg
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * j / seg
        def tuv(r, a):
            return (0.5 + 0.5 * (r / r_out) * math.cos(a), 0.5 + 0.5 * (r / r_out) * math.sin(a))
        f = bm.faces.new([top_i[i], top_o[i], top_o[j], top_i[j]])
        for loop, t in zip(f.loops, [tuv(r_in, a0), tuv(r_out, a0), tuv(r_out, a1), tuv(r_in, a1)]):
            loop[uv].uv = t
        f.material_index = 0
        for verts in ([bot_i[j], bot_o[j], bot_o[i], bot_i[i]], [top_o[i], bot_o[i], bot_o[j], top_o[j]], [bot_i[i], top_i[i], top_i[j], bot_i[j]]):
            f2 = bm.faces.new(verts)
            f2.material_index = 1
            f2.smooth = True
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.location = o
    return ob


# ---------------------------------------------------------------- 門（原點在門軸）
D = layout["door"]
hinge = (D["x0"] + 0.005, 0, -3.96)
door = empty("door_hinge", hinge)
leaf = join_quads(
    cuboid(D["x0"] + 0.005, D["x1"] - 0.005, 0.0, D["h"] - 0.01, -3.98, -3.94),
    cuboid(D["x0"] + 0.1, D["x1"] - 0.1, 0.22, 0.92, -3.94, -3.928),
    cuboid(D["x0"] + 0.1, D["x1"] - 0.1, 1.12, 1.88, -3.94, -3.928),
)
mesh_obj("door_leaf", leaf, M["door"], origin=hinge, parent=door)
mesh_obj("door_knob", join_quads(cuboid(D["x1"] - 0.12, D["x1"] - 0.08, 0.98, 1.02, -3.93, -3.9), cuboid(D["x1"] - 0.12, D["x1"] - 0.08, 0.98, 1.02, -4.02, -3.99)), M["brass"], origin=hinge, parent=door)

# ---------------------------------------------------------------- DVD 盒
W, H, DP = 0.135, 0.19, 0.0145
T = 0.0015
dvd = empty("dvd")
tray = empty("dvd_tray", (0, 0, 0), dvd)
mesh_obj("dvd_tray_body", join_quads(
    cuboid(0.0018, W, 0, H, 0, T),                    # 背板
    cuboid(0, 0.0018, 0, H, 0, DP),                   # 書背
    cuboid(0.0018, W, 0, T, T, DP - T),               # 下緣
    cuboid(0.0018, W, H - T, H, T, DP - T),           # 上緣
    cuboid(W - T, W, T, H - T, T, DP - T),            # 開口側
), M["case_plastic"], parent=tray)
hub_x = 0.0018 + (W - 0.0018) / 2
hub = bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.0075, depth=0.004, location=P(hub_x, H / 2, T + 0.002))
hub = bpy.context.object
hub.name = "dvd_hub"
hub.rotation_euler = (math.pi / 2, 0, 0)
hub.data.materials.append(M["case_plastic"])
place_world(hub, P(hub_x, H / 2, T + 0.002), tray)
hub.rotation_euler = (math.pi / 2, 0, 0)
# 封面：背面與書背（跟著盒身）
U_SP0, U_SP1 = 0.4725, 0.5275
e = 0.0004
mesh_obj("cover_back", [([(W, 0, -e), (0, 0, -e), (0, H, -e), (W, H, -e)], [(0, 0), (U_SP0, 0), (U_SP0, 1), (0, 1)])], M["cover"], parent=tray)
mesh_obj("cover_spine", [([(-e, 0, 0), (-e, 0, DP), (-e, H, DP), (-e, H, 0)], [(U_SP0, 0), (U_SP1, 0), (U_SP1, 1), (U_SP0, 1)])], M["cover"], parent=tray)
# 蓋子：原點在書背與正面交界（開蓋時繞 y 軸轉）
lid = empty("dvd_lid", (0, 0, DP), dvd)
mesh_obj("dvd_lid_body", cuboid(0.0018, W, 0, H, DP - T, DP), M["case_plastic"], origin=(0, 0, DP), parent=lid)
mesh_obj("cover_front", [([(0.0018, 0, DP + e), (W, 0, DP + e), (W, H, DP + e), (0.0018, H, DP + e)], [(U_SP1, 0), (1, 0), (1, 1), (U_SP1, 1)])], M["cover"], origin=(0, 0, DP), parent=lid)
# 光碟（原點在圓心）
disc = ring("dvd_disc", 0.06, 0.0075, T + 0.0012, T + 0.0024, (hub_x, H / 2), M["disc_label"], M["disc_data"], origin=(hub_x, H / 2, T + 0.0018))
place_world(disc, P(hub_x, H / 2, T + 0.0018), dvd)

# ---------------------------------------------------------------- 播放機（矮櫃上）
PL = layout["player"]
px, py, pz = PL["x"], PL["y"], PL["z"]
pw, ph, pd = PL["w"], PL["h"], PL["d"]
front = pz + pd / 2
player = empty("player", (px, py, pz))
mesh_obj("player_body", join_quads(
    cuboid(px - pw / 2, px + pw / 2, py + 0.006, py + ph, pz - pd / 2, front - 0.004),
    cuboid(px - pw / 2 + 0.02, px - pw / 2 + 0.05, py, py + 0.006, pz - pd / 2 + 0.02, pz - pd / 2 + 0.05),
    cuboid(px + pw / 2 - 0.05, px + pw / 2 - 0.02, py, py + 0.006, pz - pd / 2 + 0.02, pz - pd / 2 + 0.05),
    cuboid(px - pw / 2 + 0.02, px - pw / 2 + 0.05, py, py + 0.006, front - 0.05, front - 0.02),
    cuboid(px + pw / 2 - 0.05, px + pw / 2 - 0.02, py, py + 0.006, front - 0.05, front - 0.02),
), M["player_body"], origin=(px, py, pz), parent=player)
mesh_obj("player_face", join_quads(
    cuboid(px - pw / 2, px + pw / 2, py + 0.006, py + 0.02, front - 0.004, front),
    cuboid(px - pw / 2, px + pw / 2, py + 0.036, py + ph, front - 0.004, front),
    cuboid(px - pw / 2, px - 0.15, py + 0.02, py + 0.036, front - 0.004, front),
    cuboid(px + 0.15, px + pw / 2, py + 0.02, py + 0.036, front - 0.004, front),
), M["player_front"], origin=(px, py, pz), parent=player)
for i, bx in enumerate((px - 0.19, px + 0.165, px + 0.18, px + 0.195)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.004 if i else 0.007, depth=0.004, location=P(bx, py + 0.042, front + 0.001))
    b = bpy.context.object
    b.name = f"player_btn_{i}"
    b.rotation_euler = (math.pi / 2, 0, 0)
    b.data.materials.append(M["brass"] if i == 0 else M["player_body"])
    rot = b.rotation_euler.copy()
    place_world(b, P(bx, py + 0.042, front + 0.001), player)
    b.rotation_euler = rot
mesh_obj("player_display", [([(px + 0.03, py + 0.04, front + 0.0006), (px + 0.14, py + 0.04, front + 0.0006), (px + 0.14, py + 0.056, front + 0.0006), (px + 0.03, py + 0.056, front + 0.0006)], [(0, 0), (1, 0), (1, 1), (0, 1)])], M["player_display"], origin=(px, py, pz), parent=player)
# 托盤：關著時藏在機身裡，打開往 +z 滑出 0.24
tray_y = py + 0.028
tray_z = pz + 0.01
ptray = empty("player_tray", (px, tray_y, tray_z), player)
mesh_obj("player_tray_body", join_quads(
    cuboid(px - 0.148, px + 0.148, tray_y - 0.006, tray_y + 0.002, tray_z - 0.13, tray_z + 0.13),
    cuboid(px - 0.148, px + 0.148, tray_y - 0.008, tray_y + 0.006, tray_z + 0.126, tray_z + 0.134),
), M["player_tray"], origin=(px, tray_y, tray_z), parent=ptray)
ring("player_tray_well", 0.061, 0.0, tray_y + 0.0021, tray_y + 0.0022, (px, tray_z), M["player_front"], M["player_front"], seg=48, origin=(px, tray_y, tray_z)).parent = ptray
# ring() 的 center 是 (x, y)，這裡要的是水平面上的圓：直接用平面圓片
bpy.data.objects.remove(bpy.data.objects["player_tray_well"])
bpy.ops.mesh.primitive_circle_add(vertices=48, radius=0.061, fill_type="NGON", location=P(px, tray_y + 0.0022, tray_z))
well = bpy.context.object
well.name = "player_tray_well"
well.data.materials.append(M["player_front"])
place_world(well, P(px, tray_y + 0.0022, tray_z), ptray)

# ---------------------------------------------------------------- 銀幕畫面、燈罩、窗、海報、鏡頭、招牌
S = layout["screen"]
sz = S["z"] + 0.0045
mesh_obj("screen_surface", [([(S["x"] - S["w"] / 2, S["y"] - S["h"] / 2, sz), (S["x"] + S["w"] / 2, S["y"] - S["h"] / 2, sz), (S["x"] + S["w"] / 2, S["y"] + S["h"] / 2, sz), (S["x"] - S["w"] / 2, S["y"] + S["h"] / 2, sz)], [(0, 0), (1, 0), (1, 1), (0, 1)])], M["screen"], origin=(S["x"], S["y"], sz))
L = layout["lamp"]
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.2, depth=0.3, end_fill_type="NOTHING", location=P(L[0], L[1] + 0.05, L[2]))
sh = bpy.context.object
sh.name = "lamp_shade"
bpy.ops.object.shade_smooth()
sh.data.materials.append(M["shade"])
sol = sh.modifiers.new("t", "SOLIDIFY")
sol.thickness = 0.004
R = layout["room"]
Wn = layout["window"]
gx = R["x0"] - 0.03
mesh_obj("window_glass", [([(gx, Wn["y0"], Wn["z0"]), (gx, Wn["y0"], Wn["z1"]), (gx, Wn["y1"], Wn["z1"]), (gx, Wn["y1"], Wn["z0"])], [(0, 0), (1, 0), (1, 1), (0, 1)])], M["night"], origin=(gx, (Wn["y0"] + Wn["y1"]) / 2, (Wn["z0"] + Wn["z1"]) / 2))
Po = layout["poster"]
pxp = Po["x"] + 0.032
mesh_obj("wall_poster", [([(pxp, Po["y"] - Po["h"] / 2, Po["z"] + Po["w"] / 2), (pxp, Po["y"] - Po["h"] / 2, Po["z"] - Po["w"] / 2), (pxp, Po["y"] + Po["h"] / 2, Po["z"] - Po["w"] / 2), (pxp, Po["y"] + Po["h"] / 2, Po["z"] + Po["w"] / 2)], [(0, 0), (1, 0), (1, 1), (0, 1)])], M["poster"], origin=(pxp, Po["y"], Po["z"]))
Ls = layout["lens"]
bpy.ops.mesh.primitive_circle_add(vertices=32, radius=0.028, fill_type="NGON", location=P(Ls[0], Ls[1], Ls[2] - 0.021))
lens = bpy.context.object
lens.name = "lens_glow"
lens.rotation_euler = (math.pi / 2, 0, 0)
lens.data.materials.append(M["lens"])
mesh_obj("marquee_sign", [([(2.75, 2.295, -3.968), (3.75, 2.295, -3.968), (3.75, 2.545, -3.968), (2.75, 2.545, -3.968)], [(0, 0), (1, 0), (1, 1), (0, 1)])], M["sign"], origin=(3.25, 2.42, -3.968))
bulbs = [[round(2.73 + (i / 13) * 1.04, 4), y, -3.955] for i in range(14) for y in (2.27, 2.57)]

bpy.context.view_layer.update()
for name in ("player_body", "player_tray_body", "player_tray_well", "dvd_disc", "dvd_lid_body", "door_leaf"):
    o = bpy.data.objects[name]
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    c = sum(pts, Vector()) / 8
    print(f"CHECK {name}: Three ({c.x:.3f}, {c.z:.3f}, {-c.y:.3f})", flush=True)
for o in bpy.data.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "props.glb"), export_format="GLB", export_apply=True, export_lights=False, export_cameras=False, use_selection=False)
layout["dvd"] = {"w": W, "h": H, "d": DP, "hub_x": hub_x, "u_spine": [U_SP0, U_SP1]}
layout["player_tray"] = {"open_dz": 0.24, "y": tray_y, "z": tray_z}
layout["bulbs"] = bulbs
layout["door_hinge"] = hinge
with open(os.path.join(OUT, "layout.json"), "w") as f:
    json.dump(layout, f, indent=1)
print("完成 props.glb", flush=True)

"""用烘焙好的光照圖，照網頁的算法（night×kN + lamp×kL）拍圖，跟網頁看到的一樣。
用法：Blender -b --factory-startup -P <本檔> -- <room 資料夾> <輸出.jpg> [doorway]
  不加 doorway：從放映室第一格的鏡頭拍（檢查亮度用）
  加 doorway：拍播放室門洞要貼的圖（垂直正對門洞、鏡頭偏移框住門洞、近裁切面在門洞平面）"""
import math, os, sys
import bpy
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1 :]
room, out = args[:2]
DOORWAY = len(args) > 2 and args[2] == "doorway"
KN, KL = 1.5, 1.9
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(room, "screening.glb"))
def P(x, y, z): return Vector((x, -z, y))
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    part = "shell" if o.name.startswith("room_shell") else "props"
    m = bpy.data.materials.new(o.name + "_web"); m.use_nodes = True
    nt = m.node_tree; [nt.nodes.remove(n) for n in list(nt.nodes)]
    outn = nt.nodes.new("ShaderNodeOutputMaterial"); em = nt.nodes.new("ShaderNodeEmission")
    add = nt.nodes.new("ShaderNodeMix"); add.data_type = "RGBA"; add.blend_type = "ADD"; add.inputs["Factor"].default_value = 1
    def tex(pass_, k):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(os.path.join(room, f"{pass_}_{part}.jpg"), check_existing=True)
        mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1
        mul.inputs["B"].default_value = (k, k, k, 1); nt.links.new(t.outputs["Color"], mul.inputs["A"]); return mul
    a, b = tex("night", KN), tex("lamp", KL)
    nt.links.new(a.outputs["Result"], add.inputs["A"]); nt.links.new(b.outputs["Result"], add.inputs["B"])
    nt.links.new(add.outputs["Result"], em.inputs["Color"]); nt.links.new(em.outputs["Emission"], outn.inputs["Surface"])
    o.data.materials.clear(); o.data.materials.append(m)
scene.render.engine = "CYCLES"; scene.cycles.samples = 4; scene.cycles.device = "CPU"
scene.view_settings.view_transform = "Standard"; scene.view_settings.look = "None"
scene.world = None
import json
L = json.load(open(os.path.join(room, "layout.json")))
def flat_emit(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; [nt.nodes.remove(n) for n in list(nt.nodes)]
    o_ = nt.nodes.new("ShaderNodeOutputMaterial"); e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*color, 1); e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs["Emission"], o_.inputs["Surface"]); return m
# 網頁上會動的東西：暗著的銀幕畫面（color 0.04）、發光的燈罩
S_ = L["screen"]
bpy.ops.mesh.primitive_plane_add(size=1, location=P(S_["x"], S_["y"], S_["z"] + 0.0045))
sc = bpy.context.object; sc.rotation_euler = (math.pi / 2, 0, 0); sc.scale = (S_["w"], S_["h"], 1)
sc.data.materials.append(flat_emit("screen_off", (0.0025, 0.0025, 0.0025), 1.0))
lx, ly, lz = L["lamp"]
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.2, depth=0.3, end_fill_type="NOTHING", location=P(lx, ly + 0.05, lz))
bpy.context.object.data.materials.append(flat_emit("shade_on", (0.7, 0.5, 0.27), 1.0))
pos = (2.60, 1.55, -2.03)
cd = bpy.data.cameras.new("c"); cd.sensor_fit = "VERTICAL"
cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam)
cam.location = P(*pos)
if DOORWAY:
    D = L["door"]; plane_z = -3.92
    dist = pos[2] - plane_z; w, h = D["x1"] - D["x0"], D["h"]
    cd.angle = 2 * math.atan((h / 2) / dist)
    cd.shift_x = ((D["x0"] + D["x1"]) / 2 - pos[0]) / max(w, h)
    cd.shift_y = (h / 2 - pos[1]) / max(w, h)
    cd.clip_start = dist - 0.005
    cam.rotation_euler = (P(pos[0], pos[1], pos[2] - 1) - P(*pos)).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = 512, round(512 * h / w)
    scene.render.image_settings.quality = 88
else:
    look, fov = (3.25, 1.3, -4.4), 43
    cd.angle = math.radians(fov)
    cam.rotation_euler = (P(*look) - P(*pos)).to_track_quat("-Z", "Y").to_euler()
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
scene.camera = cam
scene.render.image_settings.file_format = "JPEG"; scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("拍好：", out, flush=True)

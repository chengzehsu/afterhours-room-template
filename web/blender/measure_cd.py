"""量 CD 牆（左牆背板正面）在烘焙貼圖上的平均亮度，新舊烘焙用同一把尺比較。
由 build_room.py 以 exec 載入；舊版腳本也能載入（--measure <貼圖資料夾> 只展 UV、不烘焙）。
回傳每個時段的平均 sRGB 亮度（0~255，Rec.709 係數）。
"""
import os

import bpy
import numpy as np


def measure_cd_wall(props, folder, moods):
    me = props.data
    uvl = me.uv_layers["bake"].data
    mw = props.matrix_world
    faces = []
    for poly in me.polygons:
        c = mw @ poly.center
        n = poly.normal
        # Blender 座標：x 同 Three；高度是 z；Three 的 z = -y
        if n.x > 0.9 and -3.965 < c.x < -3.935 and abs(c.y) < 1.9 and 0.4 < c.z < 2.5:
            faces.append(poly)
    pts = []
    for poly in faces:
        loops = [uvl[i].uv.copy() for i in poly.loop_indices]
        for k in range(1, len(loops) - 1):
            a, b, c = loops[0], loops[k], loops[k + 1]
            for i in range(6):
                for j in range(6 - i):
                    u, v = (i + 0.5) / 6, (j + 0.5) / 6
                    pts.append(a + (b - a) * u + (c - a) * v)
    out = {"faces": len(faces), "samples": len(pts)}
    for mood in moods:
        path = os.path.join(folder, f"{mood}_props.jpg")
        img = bpy.data.images.load(path, check_existing=False)
        img.colorspace_settings.name = "Non-Color"
        w, h = img.size
        arr = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(arr)
        arr = arr.reshape(h, w, 4)
        lum = 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]
        xs = np.clip((np.array([p.x for p in pts]) * w).astype(int), 0, w - 1)
        ys = np.clip((np.array([p.y for p in pts]) * h).astype(int), 0, h - 1)
        out[mood] = round(float(lum[ys, xs].mean()) * 255, 2)
    return out

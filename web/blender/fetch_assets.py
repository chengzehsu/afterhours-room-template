"""從 Poly Haven（CC0）下載播放室用的模型、材質與環境光。已下載的會跳過。

用法：python3 web/blender/fetch_assets.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "assets"
API = "https://api.polyhaven.com/files/"
UA = {"User-Agent": "taste-room/0.1"}

MODELS = [
    "mid_century_lounge_chair", "potted_plant_01", "potted_plant_02", "potted_plant_04",
    "book_encyclopedia_set_01", "wooden_bookshelf_worn", "modern_ceiling_lamp_01", "hanging_industrial_lamp",
    "desk_lamp_arm_01", "coffee_table_round_01", "side_table_01", "portable_cassette_player",
    "worn_metal_rack", "vintage_electric_kettle", "ceramic_vase_01", "ceramic_vase_03", "brass_vase_02",
    "lantern_chandelier_01", "standing_picture_frame_01",
]
TEXTURES = ["wood_floor_worn", "walnut_veneer", "brown_planks_05", "painted_plaster_wall", "brown_leather", "fabric_pattern_07", "brick_wall_02"]
HDRIS = ["autumn_forest_01", "grasslands_sunset", "dikhololo_night"]
MODEL_RES, TEX_RES, HDRI_RES = "1k", "1k", "2k"


def get_json(url):
    out = subprocess.run(["curl", "-sSfL", "--retry", "4", "-A", UA["User-Agent"], url], check=True, capture_output=True)
    return json.loads(out.stdout)


def download(url, dest: Path):
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    # 用 curl：Python 在代理後面讀大檔會被截斷
    tmp = dest.with_suffix(dest.suffix + ".part")
    subprocess.run(["curl", "-sSfL", "--retry", "4", "--retry-all-errors", "-A", UA["User-Agent"], "-o", str(tmp), url], check=True)
    tmp.replace(dest)


def fetch_model(name):
    files = get_json(API + name)
    entry = files["gltf"][MODEL_RES]["gltf"]
    base = ROOT / "models" / name
    download(entry["url"], base / Path(entry["url"]).name)
    for rel, inc in entry.get("include", {}).items():
        download(inc["url"], base / rel)


def fetch_texture(name):
    files = get_json(API + name)
    # 有些布料沒有 Diffuse，顏色分成 col_1 / col_2 … 幾種配色，取第一種
    diff_key = "Diffuse" if "Diffuse" in files else next((k for k in sorted(files) if k.startswith("col_")), None)
    for kind, key in (("diff", diff_key), ("rough", "Rough"), ("nor", "nor_gl")):
        if key and key in files and TEX_RES in files[key]:
            url = files[key][TEX_RES]["jpg"]["url"]
            download(url, ROOT / "textures" / name / f"{kind}.jpg")


def fetch_hdri(name):
    files = get_json(API + name)
    url = files["hdri"][HDRI_RES]["hdr"]["url"]
    download(url, ROOT / "hdri" / f"{name}.hdr")


def main():
    failed = []
    for kind, names, fn in (("模型", MODELS, fetch_model), ("材質", TEXTURES, fetch_texture), ("環境光", HDRIS, fetch_hdri)):
        for n in names:
            try:
                fn(n)
                print(f"{kind} {n} OK", flush=True)
            except Exception as e:  # 單一素材失敗不影響其他
                failed.append(n)
                print(f"{kind} {n} 失敗：{e}", flush=True)
    print("失敗：", failed or "無")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

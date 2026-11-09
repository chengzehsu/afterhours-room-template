"""放映室（我家客廳）用的 Poly Haven（CC0）素材。播放室已有的素材直接讀 web/blender/assets，不重複下載。

用法：python3 prototypes/screening-room/blender/fetch_assets.py
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "assets"
API = "https://api.polyhaven.com/files/"
UA = "taste-room/0.1"
MODELS = ["sofa_03", "throw_pillows_01", "modern_coffee_table_01", "modern_wooden_cabinet", "side_table_tall_01", "wicker_basket_01", "wooden_bowl_01"]
TEXTURES = ["velour_velvet", "wool_boucle", "poly_wool_herringbone", "patterned_plaster_wall"]


def get_json(url):
    out = subprocess.run(["curl", "-sSfL", "--retry", "4", "-A", UA, url], check=True, capture_output=True)
    return json.loads(out.stdout)


def download(url, dest: Path):
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    subprocess.run(["curl", "-sSfL", "--retry", "4", "--retry-all-errors", "-A", UA, "-o", str(tmp), url], check=True)
    tmp.replace(dest)


def fetch_model(name):
    entry = get_json(API + name)["gltf"]["1k"]["gltf"]
    base = ROOT / "models" / name
    download(entry["url"], base / Path(entry["url"]).name)
    for rel, inc in entry.get("include", {}).items():
        download(inc["url"], base / rel)


def fetch_texture(name):
    files = get_json(API + name)
    diff_key = "Diffuse" if "Diffuse" in files else next((k for k in sorted(files) if k.startswith("col_")), None)
    for kind, key in (("diff", diff_key), ("rough", "Rough"), ("nor", "nor_gl")):
        if key and key in files and "1k" in files[key]:
            download(files[key]["1k"]["jpg"]["url"], ROOT / "textures" / name / f"{kind}.jpg")


failed = []
for kind, names, fn in (("模型", MODELS, fetch_model), ("材質", TEXTURES, fetch_texture)):
    for n in names:
        try:
            fn(n)
            print(f"{kind} {n} OK", flush=True)
        except Exception as e:
            failed.append(n)
            print(f"{kind} {n} 失敗：{e}", flush=True)
print("失敗：", failed or "無")
sys.exit(1 if failed else 0)

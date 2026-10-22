#!/usr/bin/env python3
"""Weapons and sights for Roblox: WaveSpeed (2D concept image) -> Meshy (3D model).

Two steps, so you can check the images before spending Meshy credits:
  images   WaveSpeed text-to-image -> models/<category>/<id>/concept.png
  models   Meshy image-to-3D (with texture) -> <id>.glb + preview.png + meta.json

Progress is stored in models/asset_state.json. Finished steps are never paid twice.

API keys come from environment variables (or a local .env file that is gitignored):
  WAVESPEED_API_KEY, MESHY_API_KEY

Examples:
  python3 tools/generate_assets.py --dry-run --test
  python3 tools/generate_assets.py images --test          # the 3 test assets, images only
  python3 tools/generate_assets.py models --test          # then the 3D models
  python3 tools/generate_assets.py images --only ar_vanguard --redo   # new image
  python3 tools/generate_assets.py all                    # everything, both steps

Settings (WaveSpeed model, Meshy mode, polycount) live in weapons/weapons.json under
"wavespeed" and "meshy".
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "weapons" / "weapons.json"
WAVESPEED_BASE = "https://api.wavespeed.ai/api/v3"
MESHY_BASE = "https://api.meshy.ai/openapi/v1/image-to-3d"
POLL_SECONDS = 8


# ---------- helpers ----------

def load_dotenv():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def http(method, url, key=None, body=None, retry_post=False):
    """JSON request. POSTs are not retried on server errors (could bill twice), only on 429."""
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(6):
        req = urllib.request.Request(url, data=data, method=method)
        if key:
            req.add_header("Authorization", f"Bearer {key}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:500]
            can_retry = e.code == 429 or (e.code >= 500 and (method == "GET" or retry_post))
            if can_retry and attempt < 5:
                wait = 2 ** (attempt + 1)
                print(f"    HTTP {e.code}, retry in {wait}s")
                time.sleep(wait)
                continue
            raise RuntimeError(f"HTTP {e.code} {method} {url}: {detail}") from None
        except urllib.error.URLError as e:
            if method == "GET" and attempt < 5:
                time.sleep(2 ** (attempt + 1))
                continue
            raise RuntimeError(f"Network error {method} {url}: {e.reason}") from None
    raise RuntimeError(f"Gave up: {method} {url}")


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=300) as resp, open(tmp, "wb") as f:
        while chunk := resp.read(1 << 16):
            f.write(chunk)
    tmp.replace(dest)


def unwrap(res):
    """WaveSpeed sometimes wraps the payload in {"code":..,"data":{..}}."""
    return res.get("data", res) if isinstance(res, dict) else res


# ---------- assets ----------

def all_assets(cfg):
    out = []
    for w in cfg["weapons"]:
        out.append({**w, "kind": "weapon"})
    for s in cfg["sights"]:
        out.append({**s, "kind": "sight", "category": "sight"})
    return out


def image_prompt(cfg, a):
    img = cfg["image"]
    if a["kind"] == "sight":
        return img["sight_template"].format(description=a["description"])
    return img["weapon_template"].format(description=a["description"], mount=img["mounts"][a.get("mount", "none")])


def asset_dir(out, a):
    return out / a["category"] / a["id"]


# ---------- WaveSpeed: images ----------

def ws_submit(cfg, a, key):
    ws = cfg["wavespeed"]
    body = {**ws.get("params", {}), "prompt": image_prompt(cfg, a)}
    res = unwrap(http("POST", f"{WAVESPEED_BASE}/{ws['model']}", key, body))
    return res["id"]


def ws_poll(task_id, key):
    res = unwrap(http("GET", f"{WAVESPEED_BASE}/predictions/{task_id}/result", key))
    return res.get("status"), res.get("outputs") or [], res.get("error")


# ---------- Meshy: 3D ----------

def meshy_body(cfg, a, image_ref):
    m = cfg["meshy"]
    body = {**m.get("params", {}), "image_url": image_ref}
    if m.get("use_polycount", True):
        body["target_polycount"] = a.get("polycount", m["default_polycount"])
    if m.get("texture_prompt") and body.get("should_texture", True):
        body["texture_prompt"] = m["texture_prompt"]
    return body


def image_ref_for(entry, folder):
    """Prefer the local file (as data URI); fall back to the WaveSpeed URL."""
    local = folder / "concept.png"
    if local.exists():
        return "data:image/png;base64," + base64.b64encode(local.read_bytes()).decode()
    return entry["image_url"]


def write_meta(cfg, a, folder, entry):
    meta = {k: a[k] for k in ("id", "name", "kind", "category") if k in a}
    for k in ("mount", "default_sight", "stats", "zoom", "ads_fov", "fits"):
        if k in a:
            meta[k] = a[k]
    if a["kind"] == "weapon":
        meta["target_length_studs"] = cfg["categories"][a["category"]]["length_studs"]
    else:
        meta["target_length_studs"] = a["length_studs"]
    meta["files"] = entry.get("files", [])
    meta["meshy_task_id"] = entry.get("model_id")
    (folder / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))


# ---------- state machine ----------

def advance(a, e, cfg, args, keys):
    """Move one asset one step. Returns True while something is still running."""
    folder = asset_dir(args.out, a)
    st = e["stage"]
    want_images = args.step in ("images", "all")
    want_models = args.step in ("models", "all")

    if st == "new" and want_images:
        e.update(stage="image_running", image_task=ws_submit(cfg, a, keys["ws"]))
        print(f"  {a['id']}: image started")
        return True

    if st == "image_running":
        status, outputs, err = ws_poll(e["image_task"], keys["ws"])
        if status in ("failed", "cancelled", "canceled", "timeout", "deleted"):
            e.update(stage="failed", error=f"image {status}: {err}")
            print(f"  {a['id']}: image {status} {err or ''}")
            return False
        if status != "completed" or not outputs:
            return True
        e.update(stage="image_done", image_url=outputs[0])
        try:
            download(outputs[0], folder / "concept.png")
            print(f"  {a['id']}: image saved -> {folder / 'concept.png'}")
        except Exception as ex:  # keep going, Meshy can still use the URL
            print(f"  {a['id']}: image ready, download failed ({ex}); Meshy will use the URL")
        return want_models

    if st == "image_done" and want_models:
        body = meshy_body(cfg, a, image_ref_for(e, folder))
        res = http("POST", MESHY_BASE, keys["meshy"], body)
        e.update(stage="model_running", model_id=res["result"])
        print(f"  {a['id']}: 3D model started")
        return True

    if st == "model_running":
        task = http("GET", f"{MESHY_BASE}/{e['model_id']}", keys["meshy"])
        status = task.get("status")
        if status in ("FAILED", "CANCELED", "EXPIRED"):
            msg = (task.get("task_error") or {}).get("message", "")
            e.update(stage="failed", error=f"model {status}: {msg}")
            print(f"  {a['id']}: model {status} {msg}")
            return False
        if status != "SUCCEEDED":
            print(f"  {a['id']}: 3D {task.get('progress', 0)}%")
            return True
        files = []
        for fmt in args.formats:
            url = (task.get("model_urls") or {}).get(fmt)
            if url:
                download(url, folder / f"{a['id']}.{fmt}")
                files.append(f"{a['id']}.{fmt}")
            else:
                print(f"  {a['id']}: Meshy returned no .{fmt}")
        if task.get("thumbnail_url"):
            download(task["thumbnail_url"], folder / "preview.png")
            files.append("preview.png")
        e.update(stage="done", files=files)
        write_meta(cfg, a, folder, e)
        print(f"  {a['id']}: done -> {', '.join(files)}")
        return False

    return False


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", nargs="?", default="images", choices=["images", "models", "all"],
                   help="images (default), models, or all")
    p.add_argument("--test", action="store_true", help="only the test batch from weapons.json")
    p.add_argument("--only", nargs="+", metavar="ID", help="only these ids")
    p.add_argument("--kind", choices=["weapon", "sight"], help="only weapons or only sights")
    p.add_argument("--redo", action="store_true", help="start the selected assets again from the image")
    p.add_argument("--redo-model", action="store_true", help="keep the image, make the 3D model again")
    p.add_argument("--parallel", type=int, default=3, help="jobs at the same time (default 3)")
    p.add_argument("--formats", nargs="+", default=["glb"], help="model formats: glb fbx obj usdz")
    p.add_argument("--out", type=Path, default=ROOT / "models")
    p.add_argument("--dry-run", action="store_true", help="show prompts and request bodies, no API calls")
    args = p.parse_args()

    cfg = json.loads(CONFIG.read_text())
    assets = all_assets(cfg)
    ids = {a["id"] for a in assets}
    pick = args.only or (cfg.get("test_batch") if args.test else None)
    if pick:
        unknown = set(pick) - ids
        if unknown:
            sys.exit(f"Unknown ids: {', '.join(sorted(unknown))}")
        assets = [a for a in assets if a["id"] in pick]
    if args.kind:
        assets = [a for a in assets if a["kind"] == args.kind]

    if args.dry_run:
        for a in assets:
            print(f"[{a['id']}] {a['name']} ({a['category']})")
            print(f"  image prompt: {image_prompt(cfg, a)}")
            body = meshy_body(cfg, a, "<concept image>")
            print(f"  meshy: {json.dumps(body, ensure_ascii=False)}\n")
        print(f"{len(assets)} assets. WaveSpeed model: {cfg['wavespeed']['model']}")
        return

    load_dotenv()
    keys = {"ws": os.environ.get("WAVESPEED_API_KEY"), "meshy": os.environ.get("MESHY_API_KEY")}
    if args.step in ("images", "all") and not keys["ws"]:
        sys.exit("WAVESPEED_API_KEY is not set.")
    if args.step in ("models", "all") and not keys["meshy"]:
        sys.exit("MESHY_API_KEY is not set.")

    state_path = args.out / "asset_state.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}

    def save():
        state_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
        tmp.replace(state_path)

    for a in assets:
        e = state.setdefault(a["id"], {"stage": "new"})
        if args.redo:
            state[a["id"]] = {"stage": "new"}
        elif args.redo_model and e.get("image_url"):
            state[a["id"]] = {"stage": "image_done", "image_url": e["image_url"]}
        elif e["stage"] == "failed":
            # retry from the last good point
            state[a["id"]] = {"stage": "image_done", "image_url": e["image_url"]} if e.get("image_url") else {"stage": "new"}
    save()

    def active(a):
        st = state[a["id"]]["stage"]
        if st in ("image_running", "model_running"):
            return True
        if st == "new":
            return args.step in ("images", "all")
        if st == "image_done":
            return args.step in ("models", "all")
        return False

    todo = [a for a in assets if active(a)]
    print(f"{len(todo)} of {len(assets)} assets have work for step '{args.step}'.")
    while todo:
        running = [a for a in todo if state[a["id"]]["stage"].endswith("_running")]
        idle = [a for a in todo if a not in running]
        for a in running + idle[: max(0, args.parallel - len(running))]:
            try:
                advance(a, state[a["id"]], cfg, args, keys)
            except Exception as ex:
                e = state[a["id"]]
                e.update(stage="failed", error=str(ex))
                print(f"  {a['id']}: ERROR {ex}")
            save()
        todo = [a for a in todo if active(a)]
        if todo:
            time.sleep(POLL_SECONDS)

    print()
    for a in assets:
        e = state[a["id"]]
        line = f"  {a['id']:<20} {e['stage']}"
        if e.get("error"):
            line += f"  ({e['error'][:200]})"
        print(line)


if __name__ == "__main__":
    main()

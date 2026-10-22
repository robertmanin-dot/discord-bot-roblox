#!/usr/bin/env python3
"""Generate the weapons in weapons/weapons.json with the Meshy text-to-3D API.

Each weapon goes through two Meshy steps:
  1. preview  -> untextured low poly mesh
  2. refine   -> same mesh with texture (skipped with --no-texture)
The finished model (.glb by default) and a preview image are saved to
models/<category>/<id>/.

Progress is stored in models/meshy_state.json, so the script can be stopped
and started again without paying twice for finished weapons.

Needs the MESHY_API_KEY environment variable. Uses only the standard library.

Examples:
  python3 tools/meshy_generate.py --dry-run              # show prompts, no API calls
  python3 tools/meshy_generate.py --only ar_vanguard     # test with one weapon
  python3 tools/meshy_generate.py --category smg
  python3 tools/meshy_generate.py                        # all 40 weapons
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "weapons" / "weapons.json"
API_BASE = os.environ.get("MESHY_API_BASE", "https://api.meshy.ai/openapi/v2/text-to-3d")
PROMPT_LIMIT = 600  # Meshy rejects longer prompts
DONE = "SUCCEEDED"
FAILED = {"FAILED", "CANCELED", "EXPIRED"}


def api(method, url, key, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if e.code == 429 or e.code >= 500:
                wait = 2 ** (attempt + 1)
                print(f"  Meshy {e.code}, retry in {wait}s: {detail[:200]}")
                time.sleep(wait)
                continue
            raise RuntimeError(f"Meshy {e.code} for {method} {url}: {detail}") from None
        except urllib.error.URLError as e:
            wait = 2 ** (attempt + 1)
            print(f"  network error ({e.reason}), retry in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Meshy request failed after retries: {method} {url}")


def download(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=300) as resp, open(tmp, "wb") as f:
        while chunk := resp.read(1 << 16):
            f.write(chunk)
    tmp.replace(dest)


def build_prompt(cfg, weapon):
    prompt = cfg["meshy"]["prompt_template"].format(description=weapon["description"])
    if len(prompt) > PROMPT_LIMIT:
        raise ValueError(f"{weapon['id']}: prompt is {len(prompt)} chars, Meshy allows {PROMPT_LIMIT}")
    return prompt


def load_state(path):
    if path.exists():
        return json.loads(path.read_text())
    return {}


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(path)


def preview_body(cfg, weapon, args):
    m = cfg["meshy"]
    body = {
        "mode": "preview",
        "prompt": build_prompt(cfg, weapon),
        "art_style": m.get("art_style", "realistic"),
        "topology": m.get("topology", "triangle"),
        "target_polycount": args.polycount or weapon.get("polycount", m["default_polycount"]),
        "should_remesh": True,
    }
    if args.ai_model:
        body["ai_model"] = args.ai_model
    return body


def refine_body(cfg, preview_id):
    body = {"mode": "refine", "preview_task_id": preview_id, "enable_pbr": False}
    if cfg["meshy"].get("texture_prompt"):
        body["texture_prompt"] = cfg["meshy"]["texture_prompt"]
    return body


def save_outputs(weapon, task, out_dir, formats, cfg):
    target = out_dir / weapon["category"] / weapon["id"]
    urls = task.get("model_urls") or {}
    saved = []
    for fmt in formats:
        url = urls.get(fmt)
        if not url:
            print(f"  {weapon['id']}: Meshy returned no .{fmt}")
            continue
        dest = target / f"{weapon['id']}.{fmt}"
        download(url, dest)
        saved.append(dest.name)
    if task.get("thumbnail_url"):
        download(task["thumbnail_url"], target / "preview.png")
        saved.append("preview.png")
    meta = {
        "id": weapon["id"],
        "name": weapon["name"],
        "category": weapon["category"],
        "sight": weapon["sight"],
        "target_length_studs": cfg["categories"][weapon["category"]]["length_studs"],
        "stats": weapon["stats"],
        "meshy_task_id": task.get("id"),
        "files": saved,
    }
    (target / "meta.json").write_text(json.dumps(meta, indent=2))
    return saved


def step(weapon, entry, cfg, args, key):
    """Move one weapon forward by one step. Returns True if a Meshy task is running."""
    wid = weapon["id"]
    stage = entry.get("stage", "new")

    if stage == "new":
        res = api("POST", API_BASE, key, preview_body(cfg, weapon, args))
        entry.update(stage="preview", preview_id=res["result"])
        print(f"  {wid}: preview started ({res['result']})")
        return True

    if stage in ("preview", "refine"):
        task_id = entry[f"{stage}_id"]
        task = api("GET", f"{API_BASE}/{task_id}", key)
        status = task.get("status")
        if status in FAILED:
            err = (task.get("task_error") or {}).get("message", "")
            entry.update(stage="failed", error=f"{stage} {status}: {err}")
            print(f"  {wid}: {stage} {status} {err}")
            return False
        if status != DONE:
            print(f"  {wid}: {stage} {task.get('progress', 0)}%")
            return True
        if stage == "preview" and not args.no_texture:
            res = api("POST", API_BASE, key, refine_body(cfg, task_id))
            entry.update(stage="refine", refine_id=res["result"])
            print(f"  {wid}: preview done, texture started ({res['result']})")
            return True
        files = save_outputs(weapon, task, args.out, args.formats, cfg)
        entry.update(stage="done", files=files)
        print(f"  {wid}: done -> {', '.join(files)}")
        return False

    return False


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--only", nargs="+", metavar="ID", help="only these weapon ids")
    p.add_argument("--category", nargs="+", help="only these categories")
    p.add_argument("--limit", type=int, help="stop after this many weapons")
    p.add_argument("--parallel", type=int, default=4, help="Meshy tasks at the same time (default 4)")
    p.add_argument("--no-texture", action="store_true", help="skip the texture step (cheaper, grey models)")
    p.add_argument("--polycount", type=int, help="override target polycount for all weapons")
    p.add_argument("--ai-model", help="Meshy ai_model value, e.g. 'latest' (default: Meshy's default)")
    p.add_argument("--formats", nargs="+", default=["glb"], help="model formats to download: glb fbx obj usdz")
    p.add_argument("--out", type=Path, default=ROOT / "models", help="output folder")
    p.add_argument("--retry-failed", action="store_true", help="start failed weapons again")
    p.add_argument("--dry-run", action="store_true", help="print prompts only, no API calls")
    args = p.parse_args()

    cfg = json.loads(CONFIG.read_text())
    weapons = cfg["weapons"]
    if args.only:
        unknown = set(args.only) - {w["id"] for w in weapons}
        if unknown:
            sys.exit(f"Unknown weapon ids: {', '.join(sorted(unknown))}")
        weapons = [w for w in weapons if w["id"] in args.only]
    if args.category:
        weapons = [w for w in weapons if w["category"] in args.category]
    if args.limit:
        weapons = weapons[: args.limit]

    if args.dry_run:
        for w in weapons:
            body = preview_body(cfg, w, args)
            print(f"[{w['id']}] {w['name']} ({w['category']}, {body['target_polycount']} polys)")
            print(f"  {body['prompt']}\n")
        steps = 1 if args.no_texture else 2
        print(f"{len(weapons)} weapons, {len(weapons) * steps} Meshy tasks.")
        return

    key = os.environ.get("MESHY_API_KEY")
    if not key:
        sys.exit("MESHY_API_KEY is not set.")

    state_path = args.out / "meshy_state.json"
    state = load_state(state_path)
    for w in weapons:
        entry = state.setdefault(w["id"], {"stage": "new"})
        if entry.get("stage") == "failed" and args.retry_failed:
            state[w["id"]] = {"stage": "new"}
    save_state(state_path, state)

    todo = [w for w in weapons if state[w["id"]]["stage"] not in ("done", "failed")]
    print(f"{len(todo)} of {len(weapons)} weapons still to do.")

    while todo:
        running = [w for w in todo if state[w["id"]]["stage"] in ("preview", "refine")]
        waiting = [w for w in todo if state[w["id"]]["stage"] == "new"]
        active = running + waiting[: max(0, args.parallel - len(running))]
        for w in active:
            try:
                step(w, state[w["id"]], cfg, args, key)
            except RuntimeError as e:
                state[w["id"]].update(stage="failed", error=str(e))
                print(f"  {w['id']}: {e}")
            save_state(state_path, state)
        todo = [w for w in todo if state[w["id"]]["stage"] not in ("done", "failed")]
        if todo:
            time.sleep(10)

    done = [w for w in weapons if state[w["id"]]["stage"] == "done"]
    failed = [w for w in weapons if state[w["id"]]["stage"] == "failed"]
    print(f"\nFinished: {len(done)} done, {len(failed)} failed.")
    for w in failed:
        print(f"  {w['id']}: {state[w['id']].get('error')}")
    if failed:
        print("Run again with --retry-failed to try the failed ones again.")


if __name__ == "__main__":
    main()

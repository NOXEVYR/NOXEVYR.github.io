"""Refresh registered public GitHub icons without changing their artwork."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 12 * 1024 * 1024

def download_icon(repo, path):
    if not re.fullmatch(r"[a-zA-Z0-9_.-]+", repo):
        raise ValueError("Invalid repository name")
    if path.startswith("/") or ".." in PurePosixPath(path).parts:
        raise ValueError("Icon path must stay within its repository")
    url = f"https://api.github.com/repos/turnsolesama/{repo}/contents/{path}?ref=main"
    headers = {"User-Agent": "turnsolesama-site-icons", "Accept": "application/vnd.github+json"}
    if os.getenv("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        payload = response.read(MAX_BYTES * 2 + 1)
    if len(payload) > MAX_BYTES * 2:
        raise ValueError(f"{repo}: icon response too large")
    doc = json.loads(payload)
    if doc.get("encoding") != "base64" or doc.get("size", MAX_BYTES + 1) > MAX_BYTES:
        raise ValueError(f"{repo}: expected a small public image file")
    return base64.b64decode(doc["content"])

def png_bytes(raw):
    with Image.open(io.BytesIO(raw)) as source:
        if source.format not in ("PNG", "ICO", "JPEG", "WEBP"):
            raise ValueError("Unsupported icon format")
        if source.width * source.height > 16_000_000:
            raise ValueError("Icon dimensions too large")
        if source.format == "ICO":
            size = max(source.ico.sizes(), key=lambda s: s[0] * s[1])
            icon = source.ico.getimage(size).convert("RGBA")
        else:
            icon = source.convert("RGBA")
        output = io.BytesIO()
        icon.save(output, format="PNG")
        return output.getvalue()

def sync_icons(root=ROOT, fetch=download_icon):
    catalog_path = root / "content/projects.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    sources = json.loads((root / "content/icon-sources.json").read_text(encoding="utf-8"))
    staged = []
    for project in catalog["projects"]:
        key = project["id"]
        if not re.fullmatch(r"[a-z0-9-]+", key):
            raise ValueError("Invalid project id")
        source = sources[key]
        raw = png_bytes(fetch(source.get("repo", key), source["path"]))
        digest = hashlib.sha256(raw).hexdigest()[:12]
        relative = f"assets/icons/{key}-{digest}.png"
        project["icon"] = relative
        staged.append((relative, raw))
    # All downloads and decodes must succeed before updating any catalog reference.
    for relative, raw in staged:
        destination = root / "public" / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
    temporary = catalog_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(catalog_path)
    print(f"Refreshed {len(staged)} public software icons.")

if __name__ == "__main__":
    sync_icons()


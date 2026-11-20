"""Build the village's ordered script and stylesheet responses from source files."""

from functools import lru_cache
import gzip
import hashlib
import json


SCRIPTS = (
    "ui-assets.js", "ui-skin.js", "avatars.js", "map-assets.js", "river-weather.js",
    "climate.js", "living-props.js", "farm-ui.js", "harness-ui.js", "world-scenes.js",
    "map-painted.js", "map-camera.js", "resident-actions.js", "app.js",
)
STYLES = ("style.css", "wood-ui.css", "world-ui.css", "harness.css")
BUNDLES = {
    "/village-runtime.js": (SCRIPTS, b"\n;\n", "text/javascript; charset=utf-8"),
    "/village-style.css": (STYLES, b"\n", "text/css; charset=utf-8"),
}
TCG_MANIFESTS = {
    "ui": "tcg/ui-atlas.json",
    "avatars": "tcg/avatars.json",
    "skin": "tcg/skin.json",
    "scenery": "tcg/scenery.json",
    "layout": "maps/valley-layout-v1.json",
}


@lru_cache(maxsize=4)
def _combine(paths, separator, manifests, stamps):
    body = separator.join(path.read_bytes() for path in paths)
    if manifests:
        values = {key: json.loads(path.read_bytes()) for key, path in manifests}
        data = json.dumps(values, separators=(",", ":")).encode("ascii")
        body = b"'use strict';\nconst villageTcgAssets = " + data + b";\n" + body
    return body, gzip.compress(body, compresslevel=5, mtime=0), etag_for(body)


def etag_for(body):
    return 'W/"' + hashlib.sha256(body).hexdigest()[:24] + '"'


def bundle(web, route, accepts_gzip, compact=False):
    files, separator, content_type = BUNDLES[route]
    paths = tuple(web / name for name in files)
    manifests = tuple((key, web / "assets" / name) for key, name in TCG_MANIFESTS.items()) if compact else ()
    inputs = paths + tuple(path for _, path in manifests)
    stats = [path.stat() for path in inputs]
    stamps = tuple((stat.st_mtime_ns, stat.st_size) for stat in stats)
    body, encoded, etag = _combine(paths, separator, manifests, stamps)
    return (encoded, content_type, etag, "gzip") if accepts_gzip else (body, content_type, etag, None)


def tcg_index(body):
    """Let Chromium request the runtime while it parses the initial document."""
    styles = b"".join(f'<link rel="stylesheet" href="{name}">'.encode("ascii") for name in STYLES)
    body = body.replace(styles, b'<link rel="stylesheet" href="/village-style.css">', 1)
    return body.replace(
        b'<script defer src="boot.js"></script>',
        b'<script defer src="boot.js"></script><script defer id="village-runtime" src="/village-runtime.js?render=tcg"></script>',
        1,
    )

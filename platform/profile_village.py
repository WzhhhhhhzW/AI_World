"""Measure the village page in Chromium against an isolated save, without using model APIs."""

import argparse
import json
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import threading
import time


PROBE = b"""
document.addEventListener('village-game-ready', () => {
    const ready = performance.now();
    const resources = performance.getEntriesByType('resource');
    const navigation = performance.getEntriesByType('navigation')[0];
    const assets = resources
        .filter(entry => new URL(entry.name).pathname.startsWith('/assets/'));
    const lastAssets = [...assets].sort((a,b) => b.responseEnd - a.responseEnd).slice(0, 5);
    const canvas = document.querySelector('#village');
    let paints = 0;
    let drawCalls = 0;
    let frames = [];
    let previous;
    const paint = CanvasRenderingContext2D.prototype.drawImage;
    const clear = CanvasRenderingContext2D.prototype.clearRect;
    const fill = CanvasRenderingContext2D.prototype.fillRect;
    let framePainted = false;
    function mark(ctx) {
        if (ctx.canvas !== canvas) return;
        drawCalls++;
        if (!framePainted) paints++;
        framePainted = true;
    }
    CanvasRenderingContext2D.prototype.drawImage = function(...args) {
        mark(this);
        return paint.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.clearRect = function(...args) {
        mark(this);
        return clear.apply(this, args);
    };
    CanvasRenderingContext2D.prototype.fillRect = function(...args) {
        mark(this);
        return fill.apply(this, args);
    };
    function sample(now) {
        framePainted = false;
        if (previous) frames.push(now - previous);
        previous = now;
        if (performance.now() < ready + 8000) {
            requestAnimationFrame(sample);
            return;
        }
        CanvasRenderingContext2D.prototype.drawImage = paint;
        CanvasRenderingContext2D.prototype.clearRect = clear;
        CanvasRenderingContext2D.prototype.fillRect = fill;
        frames.sort((a,b) => a-b);
        fetch('/__village_profile', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
            ready_ms:Math.round(ready),
            navigation: navigation && Object.fromEntries(['requestStart','responseStart','responseEnd','domInteractive','domContentLoadedEventEnd'].map(key=>[key,Math.round(navigation[key])])),
            first_resources:resources.slice(0, 8).map(x=>[new URL(x.name).pathname,Math.round(x.startTime),Math.round(x.responseEnd)]),
            profile:document.documentElement.dataset.renderProfile,
            asset_count:assets.length,
            asset_body_bytes:assets.reduce((sum,x) => sum+x.encodedBodySize,0),
            asset_wire_bytes:assets.reduce((sum,x) => sum+x.transferSize,0),
            last_assets:lastAssets.map(x=>({
                path:new URL(x.name).pathname,
                start_ms:Math.round(x.startTime),
                end_ms:Math.round(x.responseEnd),
                protocol:x.nextHopProtocol
            })),
            viewport:[innerWidth,innerHeight],
            sample_ms:Math.round(performance.now()-ready),
            paints, draw_calls:drawCalls,
            frame_callback_p95_ms:Math.round(frames[Math.floor(frames.length*.95)] || 0)
        })});
    }
    requestAnimationFrame(sample);
}, {once:true});
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--port", type=int, default=18769)
    args = parser.parse_args()
    source = args.source.resolve()
    sys.path.insert(0, str(source))
    from server import make_handler
    from village import Provider, Village

    html = (source / "web" / "index.html").read_bytes()
    html = html.replace(b"</head>", b'<script defer src="/__village_profile.js"></script></head>', 1)
    with TemporaryDirectory(prefix="village-profile-") as tmp:
        world = Village(Path(tmp) / "village.json", Provider([]))
        base = make_handler(world, qemu_guest=True)

        class Handler(base):
            def do_GET(self):
                if self.valid_origin():
                    route = self.path.partition("?")[0]
                    if route == "/":
                        print(f"VILLAGE_NAVIGATION_RECEIVED {time.monotonic():.6f}", flush=True)
                        return self.send_bytes(html, "text/html; charset=utf-8")
                    if route == "/__village_profile.js":
                        return self.send_bytes(PROBE, "text/javascript")
                return super().do_GET()

            def do_POST(self):
                if self.path != "/__village_profile":
                    return super().do_POST()
                size = int(self.headers.get("Content-Length", 0))
                if self.valid_origin() and 0 < size <= 8192:
                    report = json.loads(self.rfile.read(size))
                    print("VILLAGE_PROFILE " + json.dumps(report), flush=True)
                    return self.respond({"ok": True})
                return self.respond({"error": "invalid profile"}, 400)

        thread = threading.Thread(target=world.loop, daemon=True)
        thread.start()
        try:
            with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as service:
                print(f"VILLAGE_PROFILE_READY {service.server_port}", flush=True)
                service.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            world.stop.set()
            thread.join()
            world.close()


if __name__ == "__main__":
    main()

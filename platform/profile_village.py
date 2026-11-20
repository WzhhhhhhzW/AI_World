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
            startup_requests:resources.length,
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
            backing_canvas:[canvas.width,canvas.height],
            sample_ms:Math.round(performance.now()-ready),
            paints, draw_calls:drawCalls,
            frame_callback_p95_ms:Math.round(frames[Math.floor(frames.length*.95)] || 0)
        })});
    }
    requestAnimationFrame(sample);
}, {once:true});
"""

EXERCISE = rb"""
document.addEventListener('village-game-ready', async () => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const measurements = [];
    function readZoom() {
        return Number(JSON.parse(document.querySelector('#village').dataset.cameraView || '{}').zoom);
    }
    async function measure(action, act, expected) {
        const before = performance.now();
        act();
        do {
            await frame();
            if (performance.now() - before > 5000) throw new Error(action + ' timed out');
        } while (!expected());
        await frame();
        measurements.push([action, Math.round(performance.now() - before)]);
    }
    // Benchmark the steady state separately from the post-load render sample.
    await pause(9000);
    const dialog = document.querySelector('#game-window');
    const open = document.querySelector('button[data-view="taskBoard"]');
    try {
        for (let i=0; i<3; i++) {
            await measure('open-task-board', () => open.click(), () => !dialog.hidden);
            await measure('close-task-board', () => document.querySelector('#close-panel').click(), () => dialog.hidden);
            const zoom = readZoom();
            await measure('zoom-first-frame', () => document.querySelector('#zoom-in').click(), () => readZoom() > zoom + .01);
            document.querySelector('#zoom-reset').click();
            await pause(600);
        }
    } catch (error) {
        measurements.push(['error', String(error)]);
    }
    fetch('/__village_exercise', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(measurements)});
}, {once:true});
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--port", type=int, default=18769)
    parser.add_argument("--exercise", action="store_true", help="also exercise the task panel and zoom in the disposable village")
    args = parser.parse_args()
    source = args.source.resolve()
    sys.path.insert(0, str(source))
    from server import make_handler
    from village import Provider, Village

    with TemporaryDirectory(prefix="village-profile-") as tmp:
        world = Village(Path(tmp) / "village.json", Provider([]))
        base = make_handler(world, qemu_guest=True)

        class Handler(base):
            def do_GET(self):
                if self.valid_origin() and self.path.partition("?")[0] == "/__village_profile.js":
                    scripts = PROBE + EXERCISE if args.exercise else PROBE
                    return self.send_bytes(scripts, "text/javascript")
                return super().do_GET()

            def send_bytes(self, body, content_type, status=200, etag=None, **options):
                if status == 200 and content_type.startswith("text/html"):
                    print(f"VILLAGE_NAVIGATION_RECEIVED {time.monotonic():.6f}", flush=True)
                    body = body.replace(
                        b'<script defer src="boot.js"></script>',
                        b'<script defer src="/__village_profile.js"></script><script defer src="boot.js"></script>',
                        1,
                    )
                    etag = None
                return super().send_bytes(body, content_type, status, etag=etag, **options)

            def do_POST(self):
                reports = {"/__village_profile": "VILLAGE_PROFILE", "/__village_exercise": "VILLAGE_EXERCISE"}
                label = reports.get(self.path)
                if not label:
                    return super().do_POST()
                size = int(self.headers.get("Content-Length", 0))
                if self.valid_origin() and 0 < size <= 8192:
                    report = json.loads(self.rfile.read(size))
                    print(label + " " + json.dumps(report), flush=True)
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

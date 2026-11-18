"""Buildless localhost app. Python standard library only; secrets stay in environment."""
import argparse
import hashlib
import json
import mimetypes
import os
import signal
import sys
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from village import Provider, Village

ROOT = Path(__file__).resolve().parent
WORKSPACE_ID = hashlib.sha256(str(ROOT).encode('utf-8')).hexdigest()[:16]


class StateLock:
    def __init__(self, path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = path.open("a+b")
        if self.file.tell() == 0:
            self.file.write(b"0")
            self.file.flush()
        self.file.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise RuntimeError("此存档已有服务在运行，请接续已有服务") from None

    def close(self):
        self.file.close()


def make_handler(world, allow_shutdown=False, qemu_guest=False):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # Request bodies and model content are never written to access logs.

        def valid_origin(self):
            host = self.headers.get("Host", "")
            port = self.server.server_port
            valid_hosts = {f"127.0.0.1:{port}"}
            if qemu_guest:
                valid_hosts.update((f"10.0.2.2:{port}", f"10.0.2.100:{port}"))
            return host in valid_hosts and self.headers.get("Origin", "http://" + host) == "http://" + host

        def respond(self, value, status=200):
            self.send_bytes(json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8", status)

        def send_bytes(self, body, content_type, status=200, etag=None):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache" if etag else "no-store")
            if etag:
                self.send_header("ETag", etag)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if not self.valid_origin():
                return self.respond({"error": "只接受本机同源请求"}, 403)
            route = urllib.parse.urlsplit(self.path).path
            if route == "/api/state":
                return self.respond(world.public())
            if route == "/api/harness/task":
                task_id = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("id", [""])[0]
                try:
                    return self.respond(world.harness_task(task_id))
                except ValueError as exc:
                    return self.respond({"error": str(exc)}, 404)
            if route == "/api/residents/chat":
                rid = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("id", [""])[0]
                try:
                    return self.respond({"turns": world.conversation(rid)})
                except ValueError as exc:
                    return self.respond({"error": str(exc)}, 400)
            if route == "/api/health":
                return self.respond({"ok": True, "pid": os.getpid(), "mode": "local-village", "workspace_id": WORKSPACE_ID})
            path = (ROOT / "web" / urllib.parse.unquote(route).lstrip("/")).resolve()
            if route == "/":
                path = ROOT / "web" / "index.html"
            if not path.is_relative_to(ROOT / "web") or not path.is_file():
                return self.respond({"error": "页面不存在"}, 404)
            # Revalidate local artwork without sending multi-megabyte sheets through virtio-net again.
            info = path.stat()
            etag = f'W/"{info.st_mtime_ns:x}-{info.st_size:x}"'
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                return
            content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
            if content_type.startswith("text/") or content_type == "application/javascript":
                content_type += "; charset=utf-8"
            self.send_bytes(path.read_bytes(), content_type, etag=etag)

        def do_POST(self):
            if not self.valid_origin():
                return self.respond({"error": "只接受本机同源请求"}, 403)
            try:
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    return self.respond({"error": "需要 JSON 请求"}, 415)
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 20000:
                    return self.respond({"error": "请求大小不正确"}, 413)
                data = json.loads(self.rfile.read(size).decode("utf-8"))
                if not isinstance(data, dict):
                    raise ValueError("需要 JSON 对象")
                route = urllib.parse.urlsplit(self.path).path
                result = None
                if route == "/api/harness/skills":
                    result = world.forge_skill(data)
                elif route == "/api/harness/tasks":
                    result = world.plant_task(data)
                elif route == "/api/harness/action":
                    result = world.task_action(data)
                elif route == "/api/residents":
                    result = world.add_resident(data)
                elif route == "/api/residents/background":
                    return self.respond({"ok": True, "background": world.set_background(data)})
                elif route == "/api/residents/chat":
                    result = world.send_chat(data)
                elif route == "/api/residents/api":
                    if "api" not in data or "provider" not in data:
                        raise ValueError("请填写居民的 API 设置")
                    world.update_resident({k: data.get(k) for k in ("id", "provider", "api")})
                elif route == "/api/residents/update":
                    profile = world.update_resident(data)
                    if profile:
                        return self.respond({"ok": True, **profile})
                elif route == "/api/budgets":
                    world.add_budget(data)
                elif route == "/api/farm/plot":
                    world.tend_plot(data)
                elif route == "/api/granary/exchange":
                    return self.respond({"ok": True, "credited": world.exchange_food(data)})
                elif route == "/api/granary/automatic":
                    world.set_auto_food(data)
                elif route == "/api/buildings":
                    world.build(data.get("id"))
                elif route == "/api/meetings":
                    result = world.draft(data)
                elif route == "/api/meetings/start":
                    world.start_meeting(data)
                elif route == "/api/plan":
                    world.plan(data.get("id"))
                elif route == '/api/world/proposals':
                    result=world.propose(data.get('proposal'),reason=data.get('reason',''))
                elif route == '/api/world/vote':
                    world._spawn('世界提案表决',lambda:world.deliberate(data.get('id')))
                elif route == '/api/world/audit':
                    with world.lock:return self.respond({'ok':True,'issues':world.audit_world(),'revision':world.s['world']['revision']})
                elif route == "/api/control":
                    with world.lock:
                        if world.s["busy"]:
                            raise ValueError("当前有模型任务，结束后再暂停")
                        if not isinstance(data.get("paused"), bool):
                            raise ValueError("状态无效")
                        world.s["paused"] = data["paused"]
                        world.save()
                elif route == "/api/autonomy":
                    with world.lock:
                        if not isinstance(data.get("enabled"), bool):
                            raise ValueError("状态无效")
                        if data["enabled"] and not any(world.model_ready(r) for r in world.s["residents"]):
                            raise ValueError("先配置至少一项模型服务")
                        world.s["autonomy"] = data["enabled"]
                        world.save()
                elif route == "/api/shutdown" and allow_shutdown:
                    self.respond({"ok": True})
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                    return
                elif route == "/api/quit":
                    with world.lock:
                        if world.s["busy"]:
                            raise ValueError("请先等待当前模型任务结束，再保存退出")
                        world.save()
                    self.respond({"ok": True})
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                    return
                else:
                    return self.respond({"error": "操作不存在"}, 404)
                self.respond({"ok": True, "id": result})
            except (ValueError, TypeError, KeyError, UnicodeDecodeError) as exc:
                self.respond({"error": str(exc) if isinstance(exc, ValueError) else "请求字段不正确"}, 400)
            except Exception:
                self.respond({"error": "保存失败，操作未能完成。请检查本机存档目录。"}, 500)
    return Handler


def main():
    parser = argparse.ArgumentParser(description="谷言 · AI村庄，本地服务")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--qemu-guest", action="store_true",
                        help="允许同机 QEMU 客体经 10.0.2.2 或配置的 10.0.2.100 端口转发同源访问")
    parser.add_argument("--data", type=Path, default=ROOT / "data" / "village.json")
    parser.add_argument("--providers", type=Path, default=ROOT / "providers.local.json")
    parser.add_argument("--duration", type=int, default=0, help="用于有界验证的自动退出秒数；0为手动退出")
    parser.add_argument("--allow-shutdown", action="store_true", help="仅用于本机验证，启用同源退出接口")
    parser.add_argument("--open-browser", action="store_true", help="服务就绪后打开游戏；已有同工作区服务时复用")
    args = parser.parse_args()
    url=f'http://127.0.0.1:{args.port}/'
    if args.open_browser:
        try:
            with urllib.request.urlopen(url+'api/health',timeout=.7) as response:
                existing=json.load(response)
            if existing.get('workspace_id')==WORKSPACE_ID:
                webbrowser.open(url)
                print('VILLAGE_REUSED '+url,flush=True)
                return
        except (OSError,ValueError):
            pass
    lock = StateLock(args.data.with_suffix(".lock"))
    world = None
    server = None
    try:
        configs = json.loads(args.providers.read_text(encoding="utf-8-sig")) if args.providers.exists() else None
        world = Village(args.data, Provider(configs))
        server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(world, args.allow_shutdown, args.qemu_guest))
        if os.name == "posix":
            # Let the launcher close its gateway after outstanding jobs have settled.
            signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
        thread = threading.Thread(target=world.loop, name="village-clock", daemon=True)
        thread.start()
        if args.duration > 0:
            timer = threading.Timer(args.duration, server.shutdown)
            timer.daemon = True
            timer.start()
        print(f"VILLAGE_READY http://127.0.0.1:{server.server_port} pid={os.getpid()} started={time.time()}", flush=True)
        if args.open_browser:
            opener=threading.Timer(.3,lambda:webbrowser.open(url));opener.daemon=True;opener.start()
        server.serve_forever(poll_interval=.25)
    except KeyboardInterrupt:
        pass
    finally:
        if server:
            server.server_close()
        if world:
            world.close()
        lock.close()
        print("VILLAGE_EXIT clean", flush=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()

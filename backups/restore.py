"""Restore a private AI World snapshot into a fresh data directory."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import sys
import tempfile

from cryptography.fernet import Fernet, InvalidToken

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from resident_keys import ResidentKeys


def restore(archive, recovery_key, destination):
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError("恢复目录已存在。请选择一个新的目录。")
    payload = json.loads(Fernet(recovery_key.strip()).decrypt(Path(archive).read_bytes()))
    if payload.get("format") != "ai-world-save/v1":
        raise ValueError("无法识别备份格式")
    saved = payload["save_utf8"].encode("utf-8")
    state = json.loads(saved)
    references = {r["api_profile"]["key_ref"] for r in state["residents"] if r.get("api_profile")}
    keys = payload["resident_keys"]
    if set(keys) != references or any(not re.fullmatch(r"[a-f0-9]{32}", ref) for ref in references):
        raise ValueError("居民与密钥引用不匹配")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".village-restore-", dir=destination.parent) as staging:
        data = Path(staging) / "data"
        data.mkdir(mode=0o700)
        save = data / "village.json"
        with os.fdopen(os.open(save, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o600), "wb") as stream:
            stream.write(saved)
        store = ResidentKeys(save)
        for ref, key in keys.items():
            fresh = store.path(store.write(key))
            fresh.rename(store.path(ref))
        if destination.exists() or destination.is_symlink():
            raise ValueError("恢复目标已被占用，请换一个目录")
        data.rename(destination)
    return len(state["residents"]), len(references)


def main():
    parser = argparse.ArgumentParser(description="恢复谷言村庄的加密备份")
    parser.add_argument("archive", type=Path)
    parser.add_argument("--key-file", type=Path, help="本机恢复口令文件")
    parser.add_argument("--to", type=Path, default=Path(__file__).resolve().parents[1]/"data",
                        help="新建的存档目录，默认使用仓库根目录下的 data")
    args = parser.parse_args()
    try:
        key = args.key_file.read_bytes() if args.key_file else getpass.getpass("恢复口令（不回显）: ").encode("ascii")
        people, keys = restore(args.archive, key, args.to)
    except (InvalidToken, ValueError, KeyError, OSError, TypeError) as exc:
        if isinstance(exc, InvalidToken):
            parser.exit(1, "恢复失败。请核对口令和备份文件完整性。\n")
        parser.exit(1, "恢复未完成。请检查备份、恢复口令和目标目录是否可用且尚未存在。\n")
    print(f"村庄已恢复至 {args.to.resolve()}，共 {people} 位居民、{keys} 份专用密钥。")


if __name__ == "__main__":
    main()


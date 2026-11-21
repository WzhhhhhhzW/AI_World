"""Exercise launcher ownership with a disposable save and no guest VM."""

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


START = Path(__file__).resolve().parents[1] / "platform" / "start.sh"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("flock"), "requires Linux flock")
class PlatformLauncherTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "platform").mkdir()
        shutil.copyfile(START, self.root / "platform" / "start.sh")
        self.tools = self.root / "bin"
        self.tools.mkdir()
        self.save = self.root / "save root" / "qilin-village"
        self.save.mkdir(parents=True)
        self.env = dict(os.environ, PATH=f"{self.tools}:{os.environ['PATH']}",
                        XDG_DATA_HOME=str(self.save.parent), DISPLAY=":mock",
                        WSL_DISTRO_NAME="Ubuntu", TEST_RECORD=str(self.root / "record"),
                        TEST_LOCK=str(self.save / "launcher.lock"))
        self.window_name = "Qilin Village " + hashlib.sha256(os.fsencode(self.save.resolve())).hexdigest()[:12]

    def program(self, name, content):
        path = self.tools / name
        path.write_text("#!/bin/sh\n" + content + "\n", encoding="utf-8")
        path.chmod(0o700)

    def lock_existing(self):
        import fcntl

        handle = (self.save / "launcher.lock").open("ab")
        self.addCleanup(handle.close)
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def launch(self):
        return subprocess.run(["bash", "platform/start.sh"], cwd=self.root, env=self.env,
                              capture_output=True, text=True, timeout=10)

    def test_duplicate_while_starting_skips_expensive_checks_and_activation(self):
        self.lock_existing()
        self.program("pgrep", "exit 1")
        for name in ("powershell.exe", "wmctrl", "python3", "qemu-system-aarch64"):
            self.program(name, f'echo {name} >> "$TEST_RECORD"; exit 1')

        result = self.launch()

        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertIn(f"QEMU ({self.window_name})", result.stdout)
        self.assertFalse((self.root / "record").exists())

    def test_duplicate_targets_only_the_existing_session_title(self):
        self.lock_existing()
        self.env["DISPLAY"] = ""
        self.program("pgrep", 'printf "%s\n" "$@" >> "$TEST_RECORD"')
        self.program("powershell.exe", 'printf "%s\n" "$@" >> "$TEST_RECORD"')
        self.program("python3", 'echo unexpected-start >> "$TEST_RECORD"; exit 1')

        result = self.launch()

        self.assertEqual(result.returncode, 0, result.stderr)
        calls = (self.root / "record").read_text()
        self.assertIn(f"-name guest={self.window_name}( |$)", calls)
        self.assertIn(f'.AppActivate("QEMU ({self.window_name})")', calls)
        self.assertNotIn("unexpected-start", calls)

    def test_launch_owner_holds_lock_and_children_do_not_inherit_it(self):
        candidate = self.root / "data" / "platform" / "candidate"
        candidate.mkdir(parents=True)
        (candidate / "kernel.bin").write_bytes(b"mock")
        (candidate.parent / "wayland.img").write_bytes(b"mock")
        self.program("qemu-system-aarch64", "echo gtk")
        self.program("python3", '''
for descriptor in /proc/$$/fd/*; do
    if [ "$(readlink "$descriptor")" = "$TEST_LOCK" ]; then
        echo inherited-lock >> "$TEST_RECORD"
    fi
done
if flock -n "$TEST_LOCK" true; then echo missing-owner >> "$TEST_RECORD"; fi
if [ "$1" = "-u" ]; then
    echo "VILLAGE_READY http://127.0.0.1:21001 pid=$$"
    exec sleep 30
fi
printf "%s\\n" "$@" >> "$TEST_RECORD"
''')

        result = self.launch()

        self.assertEqual(result.returncode, 0, result.stderr)
        calls = (self.root / "record").read_text().splitlines()
        self.assertEqual(calls, ["platform/qemu_demo.py", "launch", "--kernel",
                                 "data/platform/candidate/kernel.bin", "--port", "21001",
                                 "--window-name", self.window_name])
        self.assertEqual(subprocess.run(["flock", "-n", self.save / "launcher.lock", "true"]).returncode, 0)

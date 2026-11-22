"""Exercise finals evidence boundaries without launching a guest."""

import contextlib
import hashlib
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


with mock.patch.object(sys, "path", [str(Path(__file__).resolve().parents[1] / "platform"), *sys.path]):
    import finals_benchmark as benchmark


class FinalsPairTests(unittest.TestCase):
    def test_order_does_not_reverse_the_delta_or_shift_a_missing_observation(self):
        groups = benchmark.paired_order(("baseline", "candidate"), 4, "alternate")
        pairs = [
            {"baseline": {"time_s": 10.0}, "candidate": {"time_s": 9.0}},
            {"candidate": {"time_s": 25.0}, "baseline": {"time_s": 24.0}},
            {"candidate": {"time_s": 50.0}},
        ]
        report = benchmark.summarize_pairs(groups, pairs)
        self.assertEqual(report["planned_pairs"], 4)
        self.assertEqual(report["complete_pairs"], 2)
        self.assertEqual(report["pairs"][1]["order"], ["candidate", "baseline"])
        self.assertEqual(report["pairs"][2]["missing_observations"], ["baseline"])
        self.assertEqual(report["candidate_minus_reference"]["time_s"],
                         {"values": [-1.0, 1.0], "median": 0.0, "min": -1.0, "max": 1.0})


@unittest.skipUnless(importlib.util.find_spec("PIL"), "requires Pillow")
class KvmFrameEvidenceTests(unittest.TestCase):
    def test_fast_home_preserves_the_exact_detected_screendump(self):
        from PIL import Image

        width, height = 160, 100
        header = f"P6\n{width} {height}\n255\n".encode()
        background = header + bytes(3 * width * height)
        rendered = header + b"".join(bytes.fromhex(color) * 4000 for color in benchmark.HOME_COLORS)
        timer = 100.0

        def monotonic():
            nonlocal timer
            timer += 0.001
            return timer

        def sleep(delay):
            nonlocal timer
            timer += delay
            serial.write_bytes(b"ICT_BROWSER_START\nFINALS_RENDERER_SEEN_FIRST pid=102\n")

        def screendump(name, *, filename):
            self.assertEqual(name, "screendump")
            Path(filename).write_bytes(background if monitor.call.call_count == 1 else rendered)

        monitor = benchmark.Monitor.__new__(benchmark.Monitor)
        monitor.call = mock.Mock(side_effect=screendump)
        result = {"stages_s": {}, "frames": []}
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            serial = work / "serial.log"
            serial.write_bytes(b"VILLAGE_WESTON_READY\n")
            with (mock.patch.object(benchmark.time, "monotonic", side_effect=monotonic),
                  mock.patch.object(benchmark.time, "sleep", side_effect=sleep),
                  contextlib.redirect_stdout(io.StringIO())):
                benchmark.measure(monitor, work, work, 100.0, result, startup_only=True, accel="kvm")

            evidence = result["first_visible_capture"]
            lower, upper = evidence["positive_request_s"]
            self.assertLess(evidence["previous_negative_request_s"], lower)
            self.assertLess(lower, upper)
            self.assertEqual(result["stages_s"]["window_visible"], round(upper, 3))
            self.assertLess(*result["launch_marker_host_observation_s"])
            self.assertTrue(evidence["used_home_colors"])
            self.assertEqual(evidence["screendump_sha256"], hashlib.sha256(rendered).hexdigest())
            self.assertEqual((work / "first-visible.ppm").read_bytes(), rendered)
            with Image.open(work / "browser-window.png") as evidence_png:
                self.assertEqual(evidence_png.tobytes(), rendered[len(header):])
            self.assertEqual(result["renderer_pid"], 102)

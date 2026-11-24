import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from village import Village
from test_village import FixtureProvider


class ScriptedProvider(FixtureProvider):
    def __init__(self):
        super().__init__()
        self.replies = []

    def call(self, pid, messages, cap):
        response = super().call(pid, messages, cap)
        if not self.replies:
            raise AssertionError("Unexpected model call in fixture")
        reply = self.replies.pop(0)
        response["choices"][0]["message"]["content"] = json.dumps(reply, ensure_ascii=False)
        return response


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "village.json"
        self.provider = ScriptedProvider()
        self.world = Village(self.path, self.provider)
        self.worker, self.advisor = self.world.s["residents"][:2]
        self.tid = self.plant()

    def tearDown(self):
        self.world.close()
        self.temp.cleanup()

    def plant(self, mode="local", **kwargs):
        return self.world.plant_task({"title": "春季盘点", "goal": "准备一份物资清单", "mode": mode,
                                      "worker_id": self.worker["id"], "skill_id": "village-inventory", **kwargs})

    def detail(self):
        return self.world.harness_task(self.tid)

    def action(self, name, **kwargs):
        self.world.task_action({"id": self.tid, "action": name, "version": self.detail()["version"], **kwargs})
        for worker in self.world.workers:
            worker.join(3)
            self.assertFalse(worker.is_alive())
        return self.detail()

    def script(self, *replies):
        self.provider.replies.extend(replies)

    def test_unconfigured_advisor_does_not_block_primary_and_harvest_is_local(self):
        self.tid = self.plant(mode="model")
        self.script({"status": "done", "artifact": "交付清单", "question": ""})
        self.assertEqual(self.action("run")["status"], "ready")
        self.assertEqual(len(self.provider.calls), 1)
        self.assertEqual(self.action("harvest")["status"], "harvested")
        self.assertEqual(len(self.world.s["ledger"]), 1)
        restored = Village(self.path, self.provider)
        self.assertEqual(restored.harness_task(self.tid)["history"][0]["artifact"], "交付清单")
        self.assertEqual(restored.harness_index()["tasks"][0]["status"], "harvested")
        self.assertNotIn("artifact", restored.public()["harness"]["tasks"][0])
        restored.close()

    def test_model_consult_is_blind_and_primary_receives_only_selected_hint(self):
        self.tid = self.plant(mode="model", reviewer_id=self.advisor["id"])
        self.advisor["memory"].append("ADVISOR_MEMORY_SENTINEL")
        self.advisor["background"] = "BACKGROUND_SENTINEL"
        self.script({"status": "blocked", "artifact": "DRAFT_SENTINEL", "question": "怎样核对作物数？"},
                    {"hints": ["SELECTED_HINT", "UNSELECTED_HINT"]},
                    {"status": "done", "artifact": "更新后的清单", "question": ""})
        first = self.action("run")
        self.assertEqual((first["status"], len(self.provider.calls)), ("blocked", 1))
        advised = self.action("assist")
        self.assertEqual((advised["status"], len(self.provider.calls)), ("advised", 2))
        advisor_context = str(self.provider.calls[1][1])
        self.assertIn("怎样核对作物数", advisor_context)
        self.assertIn("准备一份物资清单", advisor_context)
        for secret in ("DRAFT_SENTINEL", "ADVISOR_MEMORY_SENTINEL", "BACKGROUND_SENTINEL",
                       "清点木材、石料和作物"):
            self.assertNotIn(secret, advisor_context)
        result = self.action("resume", hint_ids=[advised["hints"][0]["id"]])
        worker_context = str(self.provider.calls[2][1])
        self.assertIn("SELECTED_HINT", worker_context)
        self.assertNotIn("UNSELECTED_HINT", worker_context)
        self.assertIn("DRAFT_SENTINEL", worker_context)
        self.assertEqual(result["history"][1]["input_hints"], ["SELECTED_HINT"])
        self.assertEqual([entry["resident_id"] for entry in self.world.s["ledger"]],
                         [self.worker["id"], self.advisor["id"], self.worker["id"]])

    def test_failed_advice_does_not_erase_deliverable_or_rerun_primary(self):
        self.tid = self.plant(mode="model", reviewer_id=self.advisor["id"])
        self.script({"status": "done", "artifact": "可收获原稿", "question": ""},
                    {"wrong": "invalid reply"}, {"hints": ["提示一"]})
        self.action("run")
        broken = self.action("assist", question="是否漏算仓储？")
        self.assertEqual((broken["status"], broken["artifact"], broken["stage"]), ("failed", "可收获原稿", "advisor"))
        self.assertEqual(self.action("run")["status"], "advised")
        self.assertEqual([entry["resident_id"] for entry in self.world.s["ledger"]],
                         [self.worker["id"], self.advisor["id"], self.advisor["id"]])
        self.assertEqual(self.action("harvest")["artifact"], "可收获原稿")

    def test_three_advisers_compare_same_snapshot_without_sharing_their_turns(self):
        residents = self.world.s["residents"]
        for name in ("松影", "桂音"):
            residents.append(self.world._resident(name, "探索者", "测试", "qwen", 20000))
        first, second, third, fourth = [r["id"] for r in residents[1:]]
        self.tid = self.plant(mode="model")
        self.script({"status": "blocked", "artifact": "PRIVATE_DRAFT", "question": "核对库存"},
                    {"hints": ["FIRST_KEEP", "FIRST_DROP"]}, {"hints": ["SECOND_DROP"]},
                    {"hints": ["THIRD_KEEP"]}, {"status": "done", "artifact": "修订完成", "question": ""})
        self.assertEqual(self.action("run")["advisor_ids"], [])
        p1 = self.action("assist", reviewer_id=first)
        self.world.s["resources"]["wood"] = 9999
        with self.assertRaises(ValueError):
            self.action("assist", reviewer_id=first)
        with self.assertRaises(ValueError):
            self.world.task_action({"id": self.tid, "version": p1["version"] - 1, "action": "assist", "reviewer_id": second})
        self.action("assist", reviewer_id=second)
        p3 = self.action("assist", reviewer_id=third)
        self.assertEqual(p3["advisor_ids"], [first, second, third])
        self.assertEqual([c["reviewer_id"] for c in p3["consultations"]], [first, second, third])
        calls = self.provider.calls
        for _, messages, cap in calls[1:]:
            self.assertEqual((cap, len(messages)), (480, 2))
            prompt = messages[-1]["content"]
            self.assertEqual(prompt, calls[1][1][-1]["content"])
            self.assertIn("木材 60", prompt)
            for secret in ("PRIVATE_DRAFT", "FIRST_KEEP", "FIRST_DROP", "SECOND_DROP", "9999"):
                self.assertNotIn(secret, prompt)
        ids = [h["id"] for h in p3["hints"]]
        self.assertEqual(len(set(ids)), 4)
        for r in (first, fourth, self.worker["id"], ["invalid"]):
            with self.assertRaises(ValueError):
                self.action("assist", reviewer_id=r)
        for invalid in ([ids[0], ids[0]], ids, ["unknown"], "text"):
            with self.assertRaises(ValueError):
                self.action("resume", hint_ids=invalid)
        self.assertEqual(self.detail()["version"], p3["version"])
        self.assertEqual(len(calls), 4)
        self.world.close()
        self.world = Village(self.path, self.provider)
        self.assertEqual(self.detail()["hints"], p3["hints"])
        self.assertEqual(len(calls), 4)
        result = self.action("resume", hint_ids=[ids[3], ids[0]])
        self.assertEqual(result["input_hints"], ["THIRD_KEEP", "FIRST_KEEP"])
        self.assertEqual([entry["selected_ids"] for entry in result["consultations"]], [[ids[0]], [], [ids[3]]])
        self.assertEqual((result["advisor_ids"], result["hints"], result["revision"]), ([], [], 2))
        self.assertNotIn("FIRST_DROP", str(calls[-1][1]))
        self.assertNotIn("SECOND_DROP", str(calls[-1][1]))
        self.assertEqual([e["resident_id"] for e in self.world.s["ledger"]],
                         [self.worker["id"], first, second, third, self.worker["id"]])
        self.assertEqual([c[2] for c in calls], [1000, 480, 480, 480, 1000])
        self.script({"hints": ["NEW_REVISION_HINT"]})
        self.action("assist", reviewer_id=first, question="核对新稿")
        with self.assertRaises(ValueError):
            self.action("resume", hint_ids=[ids[0]])

    def test_failed_second_adviser_preserves_first_and_old_save_migrates_only_current_round(self):
        first, second = [r["id"] for r in self.world.s["residents"][1:]]
        self.tid = self.plant(mode="model")
        self.script({"status": "done", "artifact": "草稿", "question": ""}, {"hints": ["旧版线索"]},
                    {"status": "blocked", "artifact": "", "question": "当前卡点"}, {"hints": ["现在的线索"]},
                    {"hints": ["重复", "重复"]}, {"status": "done", "artifact": "结束", "question": ""})
        self.action("run")
        self.action("assist", reviewer_id=first, question="旧版问题")
        self.action("resume")
        advised = self.action("assist", reviewer_id=second)
        current_id = advised["hints"][0]["id"]
        legacy = self.world._record("tasks", self.tid)
        del legacy["advisor_ids"]
        for entry in legacy["consultations"]:
            del entry["reviewer_id"]
            for hint in entry["hints"]:
                del hint["reviewer_id"]
        del legacy["hints"][0]["reviewer_id"]
        self.world.save()
        self.world.close()
        self.world = Village(self.path, self.provider)
        self.assertEqual(self.detail()["advisor_ids"], [second])
        old, current = self.detail()["consultations"]
        self.assertNotIn("reviewer_id", old)
        self.assertEqual(current["reviewer_id"], second)
        self.assertEqual(self.detail()["hints"][0]["id"], current_id)
        self.assertEqual(len(self.provider.calls), 4)
        failed = self.action("assist", reviewer_id=first)
        self.assertEqual((failed["status"], failed["advisor_ids"]), ("failed", [second, first]))
        self.assertEqual([h["id"] for h in failed["hints"]], [current_id])
        self.world.close()
        self.world = Village(self.path, self.provider)
        self.assertEqual(len(self.provider.calls), 5)
        result = self.action("resume", hint_ids=[current_id])
        self.assertEqual(result["history"][-1]["input_hints"], ["现在的线索"])
        self.assertEqual(result["consultations"][-1]["selected_ids"], [current_id])
        self.assertEqual(len(self.provider.calls), 6)

    def test_local_sample_is_reproducible_and_unselected_hints_stay_out(self):
        result = self.action("run")
        self.assertEqual(result["status"], "ready")
        self.assertIn("木材 60", result["artifact"])
        self.world.s["resources"]["wood"] += 25
        advised = self.action("assist", question="核对建筑数量？", reviewer_id=self.advisor["id"])
        with self.assertRaises(ValueError):
            self.action("resume", hint_ids=["foreign-id"])
        self.assertEqual(self.detail()["status"], "advised")
        no_hints = self.action("resume", hint_ids=[])
        self.assertEqual(no_hints["artifact"], result["artifact"])
        self.assertEqual(no_hints["revision"], 2)
        self.assertTrue(advised["hints"])
        again = self.action("assist", question="如何核对材料？")
        selected = again["hints"][0]
        revised = self.action("resume", hint_ids=[selected["id"]])
        self.assertIn(selected["text"], revised["artifact"])
        self.assertNotIn(again["hints"][1]["text"], revised["artifact"])
        with self.assertRaises(ValueError):
            self.action("assist", question="还有盲点吗")
        self.assertEqual(len(self.action("harvest")["history"]), 3)
        self.assertEqual(self.provider.calls, [])
        self.assertEqual(self.world.s["ledger"], [])

    def test_two_clients_one_slot_and_interrupted_consult_does_not_replay(self):
        first, second = [r["id"] for r in self.world.s["residents"][1:]]
        initial = self.action("run")
        barrier = threading.Barrier(2)
        outcomes = []

        def compete(reviewer):
            data = {"id": self.tid, "version": initial["version"], "reviewer_id": reviewer,
                    "question": "核对账目", "action": "assist"}
            barrier.wait(timeout=3)
            try:
                self.world.task_action(data)
            except ValueError:
                outcomes.append((reviewer, False))
            else:
                outcomes.append((reviewer, True))

        clients = [threading.Thread(target=compete, args=(rid,)) for rid in (first, second)]
        for client in clients:
            client.start()
        for client in clients:
            client.join(3)
            self.assertFalse(client.is_alive())
        for worker in self.world.workers:
            worker.join(3)
        self.assertEqual(sorted(ok for _, ok in outcomes), [False, True])
        winner = next(rid for rid, ok in outcomes if ok)
        other = next(rid for rid, ok in outcomes if not ok)
        advised = self.detail()
        self.assertEqual(advised["advisor_ids"], [winner])
        self.assertEqual(len(advised["consultations"]), 1)

        # Persist the normal claim without executing its worker, as if the
        # process exited between saving the stage and invoking the provider.
        with patch.object(self.world, "_spawn", side_effect=lambda _name, _fn: self.world.save()):
            self.world.task_action({"id": self.tid, "version": advised["version"], "reviewer_id": other, "action": "assist"})
        self.world.close()
        self.world = Village(self.path, self.provider)
        interrupted = self.detail()
        self.assertEqual((interrupted["status"], interrupted["advisor_ids"]), ("interrupted", [winner, other]))
        self.assertEqual(interrupted["hints"], advised["hints"])
        another = self.action("run")
        self.assertEqual([c["reviewer_id"] for c in another["consultations"]], [winner, other])
        self.assertNotEqual(another["consultations"][0]["hints"][0]["text"], another["consultations"][1]["hints"][0]["text"])
        self.assertEqual(self.provider.calls, [])
        self.assertEqual(self.world.s["ledger"], [])

    def test_blocked_primary_can_use_human_input_without_consultation(self):
        self.tid = self.plant(mode="model")
        self.script({"status": "blocked", "artifact": "", "question": "盘点哪块田？"},
                    {"status": "done", "artifact": "已记录共耕田", "question": ""})
        self.action("run")
        with self.assertRaises(ValueError):
            self.action("assist", reviewer_id=self.worker["id"])
        with self.assertRaises(ValueError):
            self.action("resume")
        self.assertEqual(self.action("resume", feedback="只看共耕田")["status"], "ready")
        self.assertIn("只看共耕田", str(self.provider.calls[-1][1]))
        self.assertEqual(len(self.provider.calls), 2)

    def test_skill_uses_selected_data_and_failed_save_rolls_back(self):
        skill = {"name": "园丁", "description": "春种", "instructions": "只读田地。", "tools": ["farm"]}
        with self.assertRaises(ValueError):
            self.world.forge_skill(skill)
        next(b for b in self.world.s["buildings"] if b["id"] == "workshop")["built"] = True
        with patch.object(self.world, "save", side_effect=OSError):
            with self.assertRaises(OSError):
                self.world.forge_skill(skill)
        with self.assertRaises(ValueError):
            self.world.forge_skill(dict(skill, tools=["shell"]))
        self.tid = self.plant(skill_id=self.world.forge_skill(skill))
        first = self.action("run")
        self.assertEqual(set(first["snapshot"]), {"farm"})
        self.assertNotIn("建筑", first["artifact"])
        with patch.object(self.world, "save", side_effect=OSError):
            with self.assertRaises(OSError):
                self.action("revise", feedback="写清种植率")
        self.assertEqual(self.detail()["status"], "ready")
        self.assertEqual(self.action("revise", feedback="写清种植率")["status"], "planted")
        self.assertEqual(self.action("run")["history"][-1]["revision"], 2)

    def test_contest_skill_migrates_once_and_keeps_village_facts_out_of_pure_text_work(self):
        self.world.s["harness"]["skills"] = [self.world.s["harness"]["skills"][0]]
        self.world.save()
        self.world = Village(self.path, self.provider)
        self.world.init_harness()
        ids = [s["id"] for s in self.world.harness_index()["skills"]]
        self.assertEqual(ids.count("contest-record-review"), 1)
        with self.assertRaises(ValueError):
            self.plant(skill_id="contest-record-review")
        self.tid = self.plant(mode="model", skill_id="contest-record-review", reviewer_id=self.advisor["id"])
        self.script({"status": "blocked", "artifact": "", "question": "缺少采样次数。"}, {"hints": ["补齐原始数据。"]})
        self.assertEqual(self.action("run")["snapshot"], {})
        self.assertEqual(self.action("assist")["status"], "advised")
        for call in self.provider.calls:
            self.assertNotIn("取样时刻", str(call[1]))
            self.assertNotIn("木材", str(call[1]))

    def test_busy_claim_and_restart_require_explicit_action_to_resume(self):
        with self.world.job_lock:
            with self.assertRaises(ValueError):
                self.action("run")
        self.assertEqual((self.detail()["status"], self.detail()["version"]), ("planted", 0))
        self.action("run")
        with self.assertRaises(ValueError):
            self.world.task_action({"action": "harvest", "id": self.tid, "version": 0})
        task = self.world._record("tasks", self.tid)
        task.update(status="advising", stage="advisor", reviewer_id=self.advisor["id"], consult_question="复点库存")
        self.world.save()
        self.world = Village(self.path, self.provider)
        self.assertEqual(self.detail()["status"], "interrupted")
        self.assertEqual(self.provider.calls, [])
        self.assertEqual(self.action("run")["status"], "advised")
        self.assertEqual(self.action("finish")["status"], "closed")


if __name__ == "__main__":
    unittest.main()

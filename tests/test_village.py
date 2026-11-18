import copy
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from village import DEFAULT_PROVIDERS, Provider, Village
from village_map import LAYOUT, NAVIGATION, entry, spawn_position, state_point, work_position, world_point


class FixtureProvider:
    """Explicit fixture, not a real provider and never exposed as a live AI mode."""
    def __init__(self, reply=None):
        self.reply = reply or {"choices": [{"message": {"content": "先收集证据，再选择建设方案。"}}],
                               "usage": {"prompt_tokens": 31, "completion_tokens": 17, "total_tokens": 48}}
        self.calls = []

    def public(self):
        return [{"id": p["id"], "name": p["name"], "configured": True, "model": "fixture-only"} for p in DEFAULT_PROVIDERS]

    def get(self, pid):
        return {"id": pid, "model": "fixture-only"} if pid in [p["id"] for p in DEFAULT_PROVIDERS] else None

    def ready(self, pid):
        return self.get(pid) is not None

    def call(self, pid, messages, cap):
        self.calls.append(copy.deepcopy((pid, messages, cap)))
        return copy.deepcopy(self.reply)


class VillageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "world.json"
        self.provider = FixtureProvider()
        self.world = Village(self.path, self.provider)
        self.rid = self.world.s["residents"][0]["id"]

    def tearDown(self):
        self.world.close()
        self.temp.cleanup()

    def test_usage_is_actual_and_settlement_is_idempotent_guarded(self):
        entry = self.world.reserve(self.rid, "fixture", [{"content": "你好"}], 100)
        self.assertGreater(self.world.resident(self.rid)["reserved"], 100)
        self.world.settle(entry, self.provider.reply)
        resident = self.world.resident(self.rid)
        self.assertEqual((resident["used"], resident["reserved"]), (48, 0))
        with self.assertRaises(ValueError):
            self.world.settle(entry, self.provider.reply)
        self.assertEqual(resident["used"], 48)

    def test_shared_food_cannot_pay_two_concurrent_reservations(self):
        ids=[r["id"] for r in self.world.s["residents"][:2]]
        for rid in ids:
            self.world.resident(rid)["budget"]=0
        self.world.stock_change("radish", 1)
        barrier=threading.Barrier(2)
        def reserve(rid):
            barrier.wait()
            try:
                self.world.reserve(rid,"test",[{"content":"x"}],500)
            except ValueError:
                pass
        threads=[threading.Thread(target=reserve,args=(rid,)) for rid in ids]
        for thread in threads: thread.start()
        for thread in threads: thread.join()
        self.assertEqual(len(self.world.s["ledger"]),1)
        self.assertEqual(self.world.s["ledger"][0]["food"],{"radish":1})
        self.assertEqual(self.world.s["resources"]["crops"],0)
        self.assertEqual(sum(self.world.resident(rid)["budget"] for rid in ids),1000)

    def test_old_harvest_migrates_once_and_failed_save_keeps_inventory(self):
        del self.world.s["farm"]
        self.world.s["resources"]["crops"]=13
        del self.world.resident(self.rid)["auto_food"]
        self.world.save()
        self.world=Village(self.path,self.provider)
        farm=self.world.s["farm"]
        self.assertEqual(farm["inventory"],{"mixed":13,"radish":0,"cabbage":0})
        self.assertFalse(self.world.resident(self.rid)["auto_food"])
        self.world.resident(self.rid)["budget"]=0
        with self.assertRaises(ValueError): self.world.reserve(self.rid,"test",[],100)
        self.world.set_auto_food({"id":self.rid,"enabled":True})
        with patch.object(self.world,"save",side_effect=OSError("fixture")):
            with self.assertRaises(OSError): self.world.reserve(self.rid,"test",[],100)
        self.assertEqual(self.world.s["farm"]["inventory"]["mixed"],13)
        self.assertEqual(self.world.resident(self.rid)["reserved"],0)
        self.assertEqual(self.world.resident(self.rid)["budget"],0)
        self.assertEqual(self.world.s["ledger"],[])
        self.assertEqual(Village(self.path,self.provider).s["farm"],self.world.s["farm"])

    def test_gardener_uses_shared_bed_without_harvesting_player_crops(self):
        r=self.world.s["residents"][1]
        self.world.tend_plot({"plot":0,"version":0,"action":"plant","crop":"radish"})
        self.world.gardener_work(r)
        self.world.gardener_work(r)
        bed=self.world.s["farm"]["plots"][-1]
        self.world.s["clock"]=bed["ready_at"]
        self.world.gardener_work(r)
        self.assertEqual(r["cargo"],{"kind":"crops","crop":"cabbage","amount":1})
        self.assertEqual(self.world.s["farm"]["plots"][0]["crop"],"radish")
        self.assertEqual(self.world.s["resources"]["crops"],0)
        r["x"],r["y"]=entry("granary",1)
        self.world.tick()
        self.assertEqual(self.world.s["farm"]["inventory"]["cabbage"],1)

    def test_unknown_usage_and_restart_keep_reservation(self):
        entry = self.world.reserve(self.rid, "fixture", [{"content": "你好"}], 100)
        reserved = self.world.resident(self.rid)["reserved"]
        self.world.settle(entry, {"choices": []})
        restarted = Village(self.path, self.provider)
        self.assertEqual(restarted.resident(self.rid)["reserved"], reserved)
        self.assertEqual(restarted.s["ledger"][0]["status"], "unknown")
        restarted.close()

    def test_interrupted_call_is_unknown_after_restart(self):
        self.world.reserve(self.rid, "fixture", [{"content": "hi"}], 100)
        restarted = Village(self.path, self.provider)
        self.assertEqual(restarted.s["ledger"][0]["status"], "unknown")
        self.assertGreater(restarted.resident(self.rid)["reserved"], 0)
        self.assertFalse(restarted.s["autonomy"])
        restarted.close()

    def test_concurrent_reservation_cannot_spend_same_budget_twice(self):
        self.world.resident(self.rid)["budget"] = 600
        outcomes = []
        def reserve():
            try:
                self.world.reserve(self.rid, "fixture", [{"content": "hi"}], 100)
                outcomes.append(True)
            except ValueError:
                outcomes.append(False)
        threads = [threading.Thread(target=reserve) for _ in range(8)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(outcomes.count(True), 1)
        self.assertGreaterEqual(self.world.public()["residents"][0]["remaining"], 0)

    def test_walking_and_farming_never_spend_tokens(self):
        before = self.world.resident(self.rid)["budget"]
        for _ in range(150):
            self.world.tick()
        self.assertEqual(self.world.resident(self.rid)["used"], 0)
        self.assertEqual(self.world.resident(self.rid)["budget"], before)
        self.assertGreater(self.world.s["resources"]["wood"], 60)
        self.assertEqual(self.world.s["ledger"], [])

    def test_construction_cost_once_and_residents_finish_it(self):
        self.world.build("workshop")
        self.assertEqual(self.world.s["resources"]["wood"], 25)
        with self.assertRaises(ValueError):
            self.world.build("workshop")
        for _ in range(180):
            self.world.tick()
        b = next(b for b in self.world.s["buildings"] if b["id"] == "workshop")
        self.assertTrue(b["built"])
        self.assertFalse(b["constructing"])

    def test_meeting_independent_contributions_then_shared_summary(self):
        mid = self.world.draft({"question": "如何建设村庄？"})
        m = next(m for m in self.world.s["meetings"] if m["id"] == mid)
        ids = [r["id"] for r in self.world.s["residents"]]
        self.world._meeting_work(m, ids, gather=False)
        self.assertEqual(m["status"], "complete")
        self.assertEqual(len(self.provider.calls), len(ids) + 1)
        self.assertEqual(len(m["messages"]), 3)
        self.assertNotIn("发言记录", self.provider.calls[1][1][1]["content"])
        self.assertIn("发言记录", self.provider.calls[-1][1][1]["content"])
        self.assertEqual(sum(r["used"] for r in self.world.s["residents"]), 48 * 4)
        self.assertTrue(all(r["memory"] for r in self.world.s["residents"]))

    def test_model_actions_are_allowlisted(self):
        self.provider.reply["choices"][0]["message"]["content"] = json.dumps({"thought": "恶意动作", "action": "run_shell", "command": "noop"})
        old_task = self.world.resident(self.rid)["task"]
        with self.assertRaises(ValueError):
            self.world._plan_work(self.rid)
        self.assertEqual(self.world.resident(self.rid)["task"], old_task)
        self.assertEqual(self.world.resident(self.rid)["used"], 48)

    def test_valid_ai_plan_changes_work_and_remembers_reason(self):
        self.provider.reply["choices"][0]["message"]["content"] = '```json\n{"thought":"石料短缺，先补足石料。","action":"stone"}\n```'
        self.world._plan_work(self.rid)
        self.assertEqual(self.world.resident(self.rid)["task"], "stone")
        self.assertEqual(self.world.resident(self.rid)["thought_source"], "api")

    def test_background_is_per_resident_and_used_in_life_and_meeting_prompts(self):
        saved = json.loads(self.path.read_text("utf-8"))
        for resident in saved["residents"]:
            resident.pop("background")
        self.path.write_text(json.dumps(saved), encoding="utf-8")
        world = Village(self.path, self.provider)
        story = "以前在海岛修灯塔。\n现在想教邻居认星星。"
        self.assertEqual(world.resident(self.rid)["background"], "")
        world.set_background({"id": self.rid, "previous": "", "background": story})
        world = Village(self.path, self.provider)
        self.assertEqual(world.public()["residents"][0]["background"], story)
        self.assertEqual(self.provider.calls, [])
        self.provider.reply["choices"][0]["message"]["content"] = '{"thought":"研究星图","action":"stone"}'
        world._plan_work(self.rid)
        other = world.s["residents"][1]["id"]
        mid = world.draft({"question": "如何照亮村道？"})
        world._meeting_work(world.s["meetings"][0], [self.rid, other], gather=False)
        self.assertEqual(world.s["meetings"][0]["id"], mid)
        for i, (_, messages, _) in enumerate(self.provider.calls):
            self.assertNotIn("修灯塔", messages[0]["content"])
            self.assertEqual("修灯塔" in messages[1]["content"], i in (0, 1, 3))
        with self.assertRaises(ValueError):
            world.set_background({"id": self.rid, "previous": "", "background": "过期草稿"})
        with self.assertRaises(ValueError):
            world.set_background({"id": self.rid, "background": "星" * 1201})
        self.assertEqual(world.resident(self.rid)["background"], story)
        self.assertEqual(world.set_background({"id": self.rid, "previous": story, "background": ""}), "")

    def test_invalid_and_insufficient_requests_do_not_create_calls(self):
        with self.assertRaises(ValueError):
            self.world.add_budget({"id": self.rid, "amount": True})
        self.world.resident(self.rid)["budget"] = 0
        with self.assertRaises(ValueError):
            self.world.ask(self.rid, "fixture", "hello")
        self.assertEqual(self.provider.calls, [])

    def test_pause_freezes_world(self):
        self.world.s["paused"] = True
        before = copy.deepcopy(self.world.s)
        self.world.tick()
        self.assertEqual(before, self.world.s)

    def test_workers_use_distinct_spots_and_deliver_real_resources(self):
        first = self.world.resident(self.rid)
        other_id = self.world.add_resident({"name":"木工","role":"匠人","nature":"勤劳。","provider":"qwen","budget":20000})
        self.assertNotEqual(self.world.work_spot(first), self.world.work_spot(self.world.resident(other_id)))
        first["x"], first["y"] = self.world.work_spot(first)
        first["progress"] = 19
        stock = self.world.s["resources"]["wood"]
        self.world.tick()
        self.assertEqual(first["phase"], "deliver")
        self.assertEqual(self.world.s["resources"]["wood"], stock)
        self.assertEqual(first["cargo"], {"kind":"wood","amount":4})
        first["x"], first["y"] = entry("granary",0)
        self.world.tick()
        self.assertEqual(self.world.s["resources"]["wood"], stock+4)
        self.assertIsNone(first["cargo"])
        self.assertEqual(first["used"], 0)

    def test_meeting_gathering_preserves_carried_resources(self):
        r = self.world.resident(self.rid)
        r.update(cargo={"kind":"wood","amount":4},phase="deliver",meeting={"id":"test","seat":[13,8]})
        for _ in range(5): self.world.tick()
        self.assertEqual(r["cargo"], {"kind":"wood","amount":4})

    def test_all_painted_map_work_and_building_entries_are_reachable(self):
        start=spawn_position()
        targets=[entry(k,i) for k in LAYOUT['buildings'] for i in range(12)]
        targets.extend(work_position(k,i) for k in LAYOUT['jobs'] for i in range(12))
        for target in targets:
            path=self.world.walk(start,target)
            self.assertTrue(path or start==target,target)
            if path:self.assertEqual(tuple(path[-1]),target)
            self.assertTrue(all(NAVIGATION.allowed(p) for p in path))
        for job in LAYOUT['jobs']:
            self.assertEqual(len({work_position(job,i) for i in range(12)}),12)

    def test_bridge_route_avoids_water_and_building_silhouettes(self):
        path=self.world.walk(spawn_position(),state_point((544,624)))
        self.assertTrue(path)
        self.assertTrue(any(world_point(p)[1]>520 for p in path))
        self.assertFalse(NAVIGATION.allowed(state_point((400,560))))
        self.assertFalse(NAVIGATION.allowed(state_point((450,180))))
        for a,b in zip(path,path[1:]):
            p,q=world_point(a),world_point(b)
            self.assertTrue(NAVIGATION.contains_world(((p[0]+q[0])/2,(p[1]+q[1])/2)))

    def test_map_migration_preserves_identity_tokens_cargo_and_construction(self):
        r=self.world.resident(self.rid)
        r.update(used=321,reserved=120,cargo={'kind':'wood','amount':4},memory=['保留这段记忆'])
        b=next(b for b in self.world.s['buildings'] if b['id']=='workshop')
        b.update(constructing=True,progress=17)
        self.world.s.pop('map_version',None)
        self.world.save()
        restarted=Village(self.path,self.provider)
        after=restarted.resident(self.rid)
        self.assertEqual((after['used'],after['reserved'],after['budget']),(321,120,20000))
        self.assertEqual(after['cargo'],r['cargo'])
        self.assertEqual(after['memory'],r['memory'])
        self.assertTrue(NAVIGATION.allowed((after['x'],after['y'])))
        site=next(b for b in restarted.s['buildings'] if b['id']=='workshop')
        self.assertEqual((site['constructing'],site['progress']),(True,17))
        self.assertEqual(restarted.s['map_version'],LAYOUT['version'])
        restarted.close()

    def test_created_appearance_persists_independently_of_provider(self):
        rid = self.world.add_resident({"name":"测试居民","role":"园丁","nature":"细心。","provider":"qwen","appearance":"gemini","budget":12345})
        restarted = Village(self.path, self.provider)
        r = restarted.resident(rid)
        self.assertEqual(r["appearance"], "gemini")
        self.assertEqual(r["provider"], "qwen")
        self.assertEqual(r["budget"], 12345)
        restarted.close()

    def test_invalid_appearance_does_not_create_resident(self):
        count = len(self.world.s["residents"])
        with self.assertRaises(ValueError):
            self.world.add_resident({"name":"测试居民","role":"园丁","nature":"细心。","provider":"qwen","appearance":"invalid","budget":20000})
        self.assertEqual(len(self.world.s["residents"]), count)

    def test_legacy_save_gets_appearance_without_resetting_budget(self):
        r = self.world.resident(self.rid)
        r.pop("appearance", None)
        r["used"] = 321
        self.world.save()
        restarted = Village(self.path, self.provider)
        self.assertEqual(restarted.resident(self.rid)["appearance"], "deepseek")
        self.assertEqual(restarted.resident(self.rid)["used"], 321)
        self.assertEqual(restarted.resident(self.rid)["budget"], 20000)
        restarted.close()

    def test_appearance_update_is_atomic_and_does_not_switch_provider(self):
        r = self.world.resident(self.rid)
        self.world.update_resident({"id":self.rid,"appearance":"claude"})
        self.assertEqual(r["appearance"], "claude")
        self.assertEqual(r["provider"], "deepseek")
        with self.assertRaises(ValueError):
            self.world.update_resident({"id":self.rid,"appearance":"grok","provider":"invalid"})
        self.assertEqual(r["appearance"], "claude")


if __name__ == "__main__":
    unittest.main(verbosity=2)

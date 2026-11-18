import http.client
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import make_handler
from village import Provider, Village
from test_provider import Response


class ResidentApiTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.path = Path(temp.name) / "village.json"
        self.provider = Provider([{"id": "fixture", "name": "Fixture", "base_url": "", "key_env": "UNUSED_FIXTURE_ENV"}])
        self.world = Village(self.path, self.provider)
        self.addCleanup(self.world.close)
        self.rid, self.other, _ = [r["id"] for r in self.world.s["residents"]]
        service = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.world))
        thread = threading.Thread(target=service.serve_forever, kwargs={"poll_interval": .01})
        thread.start()
        self.addCleanup(service.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(service.shutdown)
        self.port = service.server_port
        self.base = "https://fixture.invalid/v1"

    def post(self, path, data):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        try:
            conn.request("POST", path, json.dumps(data), {"Content-Type": "application/json"})
            response = conn.getresponse()
            return response.status, json.loads(response.read())
        finally:
            conn.close()

    def configure(self, rid, key, model="resident-model", base=None):
        data = {"id": rid, "provider": "fixture", "api": {
            "base_url": base or self.base, "model": model, "api_key": key}}
        return self.post("/api/residents/api", data)[0]

    def test_farm_to_pantry_to_resident_through_http(self):
        for index, (crop, seconds, credit) in enumerate([("cabbage",120,500), ("radish",300,1000)]):
            def act(action, version):
                return self.post("/api/farm/plot", {"plot":index,"version":version,"action":action,"crop":crop})[0]
            self.assertEqual(act("plant",0),200)
            self.assertEqual(act("plant",0),400)
            self.assertEqual(act("harvest",1),400)
            self.assertEqual(act("water",1),200)
            planted=self.world.s["clock"]
            self.assertEqual(self.world.s["farm"]["plots"][index]["ready_at"],planted+4*seconds)
            self.world.s["clock"]+=4*seconds-1
            self.assertEqual(act("harvest",2),400)
            self.world.s["clock"]+=1
            self.assertEqual(act("harvest",2),200)
            self.assertEqual(act("harvest",2),400)
            self.assertEqual(self.world.s["resources"]["crops"],1)
            version=self.world.s["farm"]["stock_version"]
            before=self.world.resident(self.rid)["budget"]
            args={"id":self.rid,"crop":crop,"count":1,"version":version}
            self.assertEqual(self.post("/api/granary/exchange",args),(200,{"ok":True,"credited":credit}))
            self.assertEqual(self.post("/api/granary/exchange",args)[0],400)
            self.assertEqual(self.world.resident(self.rid)["budget"],before+credit)
        reopened=Village(self.path,self.provider)
        self.assertEqual(reopened.s["farm"],self.world.s["farm"])
        self.assertEqual(reopened.resident(self.rid)["budget"],21500)
        self.assertEqual(reopened.resident(self.other)["budget"],20000)
        self.assertEqual(reopened.s["ledger"],[])

    def test_background_endpoint_preserves_api_profile_and_other_residents(self):
        self.assertEqual(self.configure(self.rid, "unit-test-key"), 200)
        api_before = self.world.resident(self.rid)["api_profile"].copy()
        story = "在海边长大。\n随身带着一本星图。"
        data = {"id": self.rid, "previous": "", "background": story}
        self.assertEqual(self.post("/api/residents/background", data), (200, {"ok": True, "background": story}))
        self.assertEqual(self.world.resident(self.rid)["api_profile"], api_before)
        self.assertEqual(self.world.resident(self.other)["background"], "")
        self.assertEqual(self.world.s["ledger"], [])

    def test_rename_and_private_chat_follow_the_same_resident_after_restart(self):
        self.configure(self.rid, "unit-test-chat-key")
        before = self.world.resident(self.rid).copy()
        rename = {"id": self.rid, "name": " 星河 ", "previous_name": before["name"]}
        self.assertEqual(self.post("/api/residents/update", rename), (200, {"ok":True, "name":"星河"}))
        self.assertEqual(self.world.resident(self.rid), dict(before, name="星河"))
        for bad in [" ", "长" * 13]:
            self.assertEqual(self.post("/api/residents/update", dict(rename, name=bad))[0], 400)
            self.assertEqual(self.post("/api/residents/update", {"id":self.rid,"role":bad,"name":"无效改动"})[0],400)
        self.assertEqual(self.world.resident(self.rid)["name"],"星河")
        self.assertEqual(self.post("/api/residents/update",dict(rename,name="过期编辑"))[0],400)
        role={"id":self.rid,"role":" 灯塔守望者 ","previous_role":before["role"]}
        self.assertEqual(self.post("/api/residents/update",role),(200,{"ok":True,"role":"灯塔守望者"}))
        self.assertEqual(self.world.resident(self.rid),dict(before,name="星河",role="灯塔守望者"))
        self.assertEqual(self.post("/api/residents/update",dict(role,role="过期身份"))[0],400)
        self.world.set_background({"id": self.rid, "background":"在海边修灯塔"})
        message = {"id":self.rid,"request_id":"chat-fixture-0001","text":"你以前住在哪？"}
        with patch("urllib.request.build_opener") as opener:
            opener.return_value.open.return_value = Response()
            for _ in range(2):
                self.assertEqual(self.post("/api/residents/chat",message)[0],200)
            self.world.workers[-1].join(3)
            self.assertEqual(opener.return_value.open.call_count,1)
            self.assertEqual(self.post("/api/residents/chat",dict(message,text="不同消息"))[0],400)
            second=dict(message,text="然后呢？",request_id="chat-fixture-0002")
            self.assertEqual(self.post("/api/residents/chat",second)[0],200)
            self.world.workers[-1].join(3)
            sent=json.loads(opener.return_value.open.call_args.args[0].data)
            self.assertIn("星河",sent["messages"][0]["content"])
            self.assertIn("灯塔守望者",sent["messages"][0]["content"])
            self.assertIn("海边修灯塔",sent["messages"][-1]["content"])
            self.assertEqual(sent["messages"][1:3],[{"role":"user","content":message["text"]},{"role":"assistant","content":"fixture"}])
        restart=Village(self.path,self.provider)
        self.addCleanup(restart.close)
        self.assertEqual(restart.resident(self.rid)["name"],"星河")
        self.assertEqual(restart.resident(self.rid)["role"],"灯塔守望者")
        self.assertEqual([t["reply"] for t in restart.conversation(self.rid)],["fixture","fixture"])
        self.assertEqual(restart.conversation(self.other),[])
        self.assertNotIn(message["text"],json.dumps(restart.public(),ensure_ascii=False))
        self.assertEqual(restart.resident(self.rid)["used"],10)

    def test_unconfigured_chat_and_failed_reply_have_distinct_results(self):
        data={"id":self.rid,"text":"你好","request_id":"chat-fixture-0003"}
        self.assertEqual(self.post("/api/residents/chat",data)[0],400)
        self.assertEqual(self.world.conversation(self.rid),[])
        self.configure(self.rid,"unit-test-chat-key")
        with patch("urllib.request.build_opener") as opener:
            opener.return_value.open.side_effect=TimeoutError()
            self.assertEqual(self.post("/api/residents/chat",data)[0],200)
            self.world.workers[-1].join(3)
        turn=self.world.conversation(self.rid)[0]
        self.assertEqual(turn["status"],"error")
        self.assertNotIn("reply",turn)
        self.assertEqual(self.world.s["ledger"][-1]["status"],"unknown")

    def test_separate_keys_for_two_residents_survive_restart_and_reach_actual_adapter(self):
        keys = ["unit-test-key-one", "unit-test-key-two"]
        for i, rid in enumerate([self.rid, self.other]):
            self.assertEqual(self.configure(rid, keys[i], f"model-{i}"), 200)
        restarted = Village(self.path, self.provider)
        self.addCleanup(restarted.close)
        public = restarted.public()
        self.assertTrue(all(r["connected"] for r in public["residents"][:2]))
        self.assertFalse(public["providers"][0]["configured"])
        self.assertNotIn("key_ref", json.dumps(public))
        for key in keys:
            self.assertNotIn(key, json.dumps(public))
            self.assertNotIn(key, self.path.read_text("utf-8"))
            if os.name == "nt":
                for blob in restarted.api_keys.directory.iterdir():
                    self.assertNotIn(key.encode(), blob.read_bytes())
        with patch("urllib.request.build_opener") as opener:
            opener.return_value.open.return_value = Response()
            for i, rid in enumerate([self.rid, self.other]):
                self.assertEqual(restarted.ask(rid, "fixture", "hello"), "fixture")
                req = opener.return_value.open.call_args.args[0]
                self.assertEqual(req.full_url, self.base + "/chat/completions")
                self.assertEqual(req.get_header("Authorization"), "Bearer " + keys[i])
                self.assertEqual(json.loads(req.data)["model"], f"model-{i}")
                entry = restarted.s["ledger"][-1]
                self.assertEqual((entry["model"], entry["total"]), (f"model-{i}", 5))

    def test_key_retention_is_bound_to_service_and_destination(self):
        self.assertEqual(self.configure(self.rid, "unit-test-key"), 200)
        self.assertEqual(self.configure(self.rid, "", "revised-model"), 200)
        original = self.world.resident(self.rid)["api_profile"].copy()
        self.assertEqual(self.configure(self.rid, "", base="https://new.invalid/v1"), 400)
        self.assertEqual(self.configure(self.rid, "new-key", base="http://new.invalid/v1"), 400)
        self.assertEqual(self.world.resident(self.rid)["api_profile"], original)
        self.assertEqual(self.configure(self.rid, "rotated-unit-test-key"), 200)
        self.assertFalse(self.world.api_keys.path(original["key_ref"]).exists())
        self.world.update_resident({"id": self.rid, "api": None})
        self.assertNotIn("api_profile", self.world.resident(self.rid))
        self.assertFalse(self.world.model_ready(self.world.resident(self.rid)))

    def test_failed_save_rolls_back_profile_and_expunges_the_new_key(self):
        self.assertEqual(self.configure(self.rid, "unit-test-key"), 200)
        original = self.world.resident(self.rid).copy()
        with patch.object(self.world, "save", side_effect=OSError):
            self.assertEqual(self.configure(self.rid, "unsaved-fixture-key"), 500)
        self.assertEqual(self.world.resident(self.rid), original)
        self.assertEqual(len(list(self.world.api_keys.directory.iterdir())), 1)

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import guest_ui as ui


class GuestEvidenceTests(unittest.TestCase):
    def test_wayland_decoding_requires_a_fresh_native_click(self):
        self.assertEqual(ui.MOTION.search(b'[123.7] wl_pointer@16.motion(132, 80.375, 143.500)').groups(), (b'80.375', b'143.500'))
        self.assertEqual(ui.MOTION.search(b'wl_pointer#16.enter(85, wl_surface#18, 4.0, 12.75)').groups(), (b'4.0', b'12.75'))
        raw=b'wl_pointer#16.button(91, 205, 272, 1)|wl_pointer#16.button(92, 207, 272, 0)'
        clicks=[tuple(map(int,g)) for g in ui.BUTTON.findall(raw)]
        self.assertTrue(ui.new_click([],clicks))
        self.assertFalse(ui.new_click(clicks,clicks))
        self.assertFalse(ui.new_click(clicks[:1],clicks))
        self.assertFalse(ui.new_click([],[(16,91,205,1),(17,92,207,0)]))

    def test_fixture_state_readback_accepts_only_one_selected_hint_on_retry(self):
        with TemporaryDirectory() as tmp:
            run=Path(tmp)
            health={'pid':17,'workspace_id':'test'}
            ui.save(run/'launch.json', {'port':18767,'server':health})
            ui.save(run/'before.json',{'harness':{'tasks':[]},'residents':[{'id':'p'}]})
            task={'id':'t','revision':2,'mode':'local','worker_id':'p','goal':'proof','status':'harvested',
                  'consultations':[{'revision':1,'reviewer_id':'a','selected_ids':[]},
                                   {'revision':1,'reviewer_id':'b','selected_ids':['b1'],'hints':[{'id':'b1','text':'verify'}]}],
                  'history':[{'input_hints':['verify']}]}
            args=SimpleNamespace(run=run,save=run/'state.json',status='harvested',goal='proof',two_advisers=True,first_worker=True)
            state={'harness':{'tasks':[{'id':'t'}]},'providers':[],'ledger':[]}
            api={'/api/health':health,'/api/state':state,'/api/harness/task?id=t':task,'/api/residents/chat?id=p':{'turns':[]}}
            def persist():
                args.save.write_text(json.dumps({'ledger':[],'harness':{'tasks':[task]}}),encoding='utf8')
            with patch.object(ui,'get',side_effect=lambda port,path:api[path]):
                persist()
                ui.receipt(args)
                self.assertTrue((run/'receipt-harvested-two.json').is_file())
                task['history'][0]['input_hints'].append('unselected')
                persist()
                with self.assertRaisesRegex(ValueError,'selected hint'): ui.receipt(args)


if __name__=='__main__':
    unittest.main()

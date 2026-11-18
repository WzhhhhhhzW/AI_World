import copy
import json
import tempfile
import unittest
from pathlib import Path
from test_village import FixtureProvider
from village import Village, SEATS
from world_governance import SLOTS, REGION_OBSTACLES, regional_route

class GovernanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.provider=FixtureProvider()
        self.provider.reply['choices'][0]['message']['content']=json.dumps({'vote':'yes','reason':'收益明确，材料足够，入口不受阻挡。'})
        self.w=Village(Path(self.tmp.name)/'world.json',self.provider)
        self.w.s['resources'].update(wood=500,stone=500)
    def tearDown(self):self.w.close();self.tmp.cleanup()
    def decide(self,payload):
        pid=self.w.propose(payload,reason='fixture proposal');self.w.deliberate(pid)
        return next(p for p in self.w.s['world']['proposals'] if p['id']==pid)
    def test_majority_unlocks_real_region_once_and_records_backup(self):
        p=self.decide({'kind':'expand','region':'eastwood'})
        self.assertEqual(p['status'],'executed');self.assertEqual(len(p['votes']),3)
        self.assertEqual(self.w.s['world']['regions'][0]['id'],'eastwood')
        self.assertEqual(self.w.s['resources']['wood'],450)
        self.assertFalse(self.w.apply_proposal(p));self.assertEqual(self.w.s['resources']['wood'],450)
        self.assertTrue((self.w.path.parent/'world-history'/self.w.s['world']['audit'][0]['backup']).exists())
        self.assertEqual(len(self.provider.calls),3)
    def test_no_or_unavailable_models_cannot_fabricate_votes(self):
        self.provider.ready=lambda pid:False
        p=self.decide({'kind':'expand','region':'eastwood'})
        self.assertEqual(p['status'],'waiting');self.assertEqual(p['votes'],[])
        self.assertEqual(self.w.s['world']['regions'],[]);self.assertEqual(self.provider.calls,[])
        with self.assertRaises(ValueError):self.w.propose({'kind':'expand','region':'eastwood'})
    def test_rejection_and_stale_resources_leave_world_unchanged(self):
        self.provider.reply['choices'][0]['message']['content']=json.dumps({'vote':'no','reason':'暂不建设'})
        p=self.decide({'kind':'build','building':'archive'});self.assertEqual(p['status'],'rejected')
        self.assertEqual(self.w.s['resources']['wood'],500)
        self.provider.reply['choices'][0]['message']['content']=json.dumps({'vote':'yes','reason':'同意'})
        self.w.s['resources']['wood']=0
        p=self.decide({'kind':'expand','region':'eastwood'});self.assertEqual(p['status'],'blocked');self.assertEqual(self.w.s['world']['revision'],0)
    def test_expansion_construction_travel_and_delivery_are_executable(self):
        self.decide({'kind':'expand','region':'eastwood'})
        p=self.decide({'kind':'structure','structure':'cabin','slot':0})
        self.assertEqual(p['status'],'executed');self.assertEqual(self.w.audit_world(),[])
        visited=False
        for _ in range(700):
            self.w.tick();visited|=any(r.get('region')=='eastwood' for r in self.w.s['residents'])
        self.assertTrue(visited);self.assertTrue(self.w.s['world']['structures'][0]['built'])
        self.assertTrue(any('东林' in e['title'] for e in self.w.s['events']))
    def test_overlap_and_invalid_rule_are_rejected_without_mutation(self):
        self.decide({'kind':'expand','region':'eastwood'});self.decide({'kind':'structure','structure':'cabin','slot':0})
        before=copy.deepcopy(self.w.s['resources'])
        for data in [{'kind':'structure','structure':'garden','slot':0},{'kind':'rule','rule':'harvest_amount','value':100000},{'kind':'run_shell','command':'noop'}]:
            with self.assertRaises(ValueError):self.w.propose(data)
        self.assertEqual(self.w.s['resources'],before)
    def test_rule_version_and_building_majority_use_real_provider_usage(self):
        p=self.decide({'kind':'rule','rule':'harvest_amount','value':6})
        self.assertEqual(self.w.s['world']['rules']['harvest_amount'],6)
        self.assertEqual(p['applied_revision'],1)
        p=self.decide({'kind':'build','building':'archive'})
        self.assertTrue(next(b for b in self.w.s['buildings'] if b['id']=='archive')['constructing'])
        self.assertEqual(sum(r['used'] for r in self.w.s['residents']),48*6)
    def test_routes_avoid_obstacles_and_reach_all_plot_entrances(self):
        for rect in SLOTS:
            x,y,w,h=rect;goal=(round((x+w/2)/16)/2-.5,round((y+h+24)/16)/2-1)
            structures=[{'rect':list(r)} for r in SLOTS]
            path=regional_route((14.5,16.5),goal,structures);self.assertTrue(path)
            for a,b in path:
                x,y=(a+.5)*32,(b+1)*32
                self.assertFalse(any(r[0]-8<=x<=r[0]+r[2]+8 and r[1]-8<=y<=r[1]+r[3]+8 for r in REGION_OBSTACLES+SLOTS))
    def test_twelve_attendees_have_distinct_collision_safe_gather_points(self):
        self.assertEqual(len(SEATS),12)
        for i,a in enumerate(SEATS):
            self.assertTrue(all((a[0]-b[0])**2+(a[1]-b[1])**2>=1 for b in SEATS[:i]))
        self.assertTrue(all(self.w.walk((r['x'],r['y']),SEATS[i]) for i,r in enumerate(self.w.s['residents'])))
    def test_ai_audit_is_actual_decision_with_bounded_geometry_report(self):
        self.provider.reply['choices'][0]['message']['content']=json.dumps({'action':'audit','thought':'检查新增建筑是否堵住道路'})
        rid=self.w.s['residents'][0]['id'];self.w._plan_work(rid)
        report=self.w.s['world']['inspections'][0]
        self.assertEqual(report['resident_id'],rid);self.assertEqual(report['issues'],[])
        self.assertEqual(len(self.provider.calls),1);self.assertEqual(self.w.resident(rid)['used'],48)

if __name__=='__main__':unittest.main()

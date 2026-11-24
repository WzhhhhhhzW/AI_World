"""Replay one R117 village continuation run offline. Pass --stage once to pack its verified originals."""
import hashlib
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
read = lambda name: json.loads((ROOT / name).read_bytes())
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
PHASES = ("initial-paused","start-running","middle-running","end-running","end-paused","end-paused-again")
PAIRS = ("02-start","03-middle","04-end")
HEAD = "a68c9eec38f34cdcea7b4a512310d9d567e056b6"

def state_gate(s):
    assert s['harness']['tasks']==[] and s['ledger']==[] and s['autonomy'] is False
    assert len(s['residents'])==3 and all(r['used']==r['reserved']==0 for r in s['residents'])
    assert len(s['harness']['skills'])==2 and all(any(b['id']==name and b['built'] for b in s['buildings']) for name in ('farm','workshop'))

def replay():
    m=read('guest/launch.json')
    assert m['kernel_sha256']=='9db7df1ef1558226c2b6478dbb56aa9a717aad2f9f14241f85b7105c865c0682'
    assert m['rootfs_sha256']=='2817c7e2438075a42d8fc6d01d9e525164c9ea05d6696776d94ae26e901eeac4'
    src=read('source-identity.json');assert src['commit']==HEAD and src['tracked_status_clean']
    assert all(src['files'][n]['working_sha256']==h for n,h in m['sources'].items())
    assert read('providers.json')==[]
    initial=read('guest/before.json');state_gate(initial);assert initial['paused'] and initial['clock']==480
    prev=0; samples={}
    roster=[r['id'] for r in initial['residents']]
    for n in PHASES:
        s=read(f'sample-{n}.json'); a=read(f'api-{n}.json'); b=read(f'disk-{n}.json'); samples[n]=s
        assert s['label']==n and prev<s['monotonic_start_ns']<=s['monotonic_end_ns']
        prev=s['monotonic_end_ns']
        assert s['saved_sha256']==sha(ROOT/f'disk-{n}.json') and a['providers']==[]
        for row in (a,b):
            state_gate(row)
            assert [r['id'] for r in row['residents']]==roster and row['harness']['skills']==initial['harness']['skills']
            assert row['paused']==s['paused']==('paused' in n)
        assert a['clock']==s['api_clock'] and b['clock']==s['disk_clock']<=a['clock']
        assert a['resources']==s['api_resources'] and b['resources']==s['disk_resources']
        if s['paused']:assert a['clock']==b['clock'] and a['resources']==b['resources']
    st,mid,end=(samples[n] for n in PHASES[1:4])
    first=st['monotonic_end_ns'];span=end['monotonic_start_ns']-first
    assert mid['monotonic_start_ns']-first>=900_000_000_000 and span>=1_800_000_000_000
    assert st['api_clock']<mid['api_clock']<end['api_clock']<=samples['end-paused']['api_clock']==samples['end-paused-again']['api_clock']
    assert st['disk_clock']<mid['disk_clock']<end['disk_clock'] and st['api_resources']!=end['api_resources']
    beats=[json.loads(line) for line in (ROOT/'heartbeat.jsonl').read_text().splitlines()]
    assert len(beats)>=2 and all(i['mono_ns']<j['mono_ns'] and i['clock']<=j['clock'] for i,j in zip(beats,beats[1:]))
    assert first<beats[0]['mono_ns']<beats[-1]['mono_ns']<=end['monotonic_start_ns']
    obs=read('interactive-observations.json');assert obs['elapsed_active_monotonic_ns']==span and obs['session']==m['session']
    assert obs['clock_at_start_middle_end']==[st['api_clock'],mid['api_clock'],end['api_clock']]
    review=read('visual-review.json')
    assert set(review['at'])==set(PAIRS) and review['session']==m['session']
    for prefix in PAIRS:
        for view,action in [('board','click'),('map','key')]:
            rel=f'guest/{prefix}-{view}';step=read(rel+'/step.json')
            assert step['action']==action and step['session']==m['session'] and step['transport']=='ok'
            if action=='click':assert step['guest_received_left_click'] and step['requested_surface_xy']==[56,736]
            else:assert step['keys']==['esc']
            assert step['after']['sha256']==sha(ROOT/rel/'after.png')==review['at'][prefix][view]['sha256']
            assert review['at'][prefix][view]['observed']
    for n in ('01-resume','05-pause'):
        s=read(f'guest/{n}/step.json')
        assert s['session']==m['session'] and s['transport']=='ok' and s['guest_received_left_click'] and s['requested_surface_xy']==[156,110]
    assert read('guest/99-quit/step.json')['transport']=='ok'
    t=read('terminal.json')
    assert t['qemu_rows']==t['fixture_rows']==[] and t['vm_exit']==read('guest/exit.json')['returncode']==0
    assert t['fixture_pid']==m['server']['pid'] and t['server_last']=='VILLAGE_EXIT clean'
    for n in ('service','launcher','observer'): assert int((ROOT/(n+'.exitcode')).read_text(encoding='utf-8-sig').strip())==0
    stopped=read('village.json');state_gate(stopped)
    assert stopped['paused'] and stopped['clock']==samples['end-paused-again']['api_clock'] and stopped['resources']==samples['end-paused-again']['api_resources']
    return dict(elapsed_active_seconds=span/1e9, clock=obs['clock_at_start_middle_end'], ends_paused_at=stopped['clock'],
                resources=[s['api_resources'] for s in (st,mid,end)], heartbeat_count=len(beats),
                visual_pairs=len(PAIRS), session=m['session'])

def stage():
    dest=ROOT/'publication'; case=dest/ROOT.name;case.mkdir(parents=True,exist_ok=False)
    names=['PLAN.md','MEASURED.md','run.sh','run-initial.sh','watch.py','audit.py','source-identity.json','visual-review.json','providers.json','start.json','village.json','heartbeat.jsonl','interactive-observations.json','terminal.json','qemu-pid.txt','observer.log','launcher.exitcode','observer.exitcode','service.exitcode','launch.log','server.log','guest/launch.json','guest/before.json','guest/serial.log','guest/emulator.log','guest/exit.json']
    names += [f'{tag}-{ph}.json' for tag in ('api','disk','sample') for ph in PHASES]
    names += [f'guest/{ph}-{view}/{file}' for ph in PAIRS for view in ('board','map') for file in ('step.json','after.png')]
    names += [f'guest/{ph}/step.json' for ph in ('01-resume','05-pause','99-quit')]
    for n in names:
        out=case/n;out.parent.mkdir(exist_ok=True,parents=True);shutil.copyfile(ROOT/n,out)
    shutil.copyfile(ROOT.parent/'guest_ui.py',dest/'guest_ui.py')
    rows=[{'path':p.relative_to(dest).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(dest.rglob('*')) if p.is_file()]
    (dest/'PUBLICATION_FILES.json').write_text(json.dumps({'bytes':sum(r['bytes'] for r in rows),'files':rows},indent=2)+'\n',encoding='utf8')
    for r in rows: assert (dest/r['path']).stat().st_size==r['bytes'] and sha(dest/r['path'])==r['sha256']

if __name__=='__main__':
    index = ROOT.parent / 'PUBLICATION_FILES.json'
    if index.is_file():
        rows = json.loads(index.read_bytes())
        assert sum(r['bytes'] for r in rows['files']) == rows['bytes']
        assert len({r['path'] for r in rows['files']}) == len(rows['files'])
        for r in rows['files']:
            p = (ROOT.parent / r['path']).resolve()
            assert p.is_relative_to(ROOT.parent) and p.stat().st_size == r['bytes'] and sha(p) == r['sha256']
    print(json.dumps(replay(),indent=2,ensure_ascii=False))
    if sys.argv[1:]==['--stage']: stage()
    elif sys.argv[1:]: raise SystemExit('usage: python audit.py [--stage]')

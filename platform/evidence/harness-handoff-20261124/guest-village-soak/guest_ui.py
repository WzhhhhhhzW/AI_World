"""Capture a real R117 village guest. Run on Linux only after the shared VM slot is free."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlencode
from urllib.request import build_opener, ProxyHandler, Request
from uuid import uuid4


KERNEL = '9db7df1ef1558226c2b6478dbb56aa9a717aad2f9f14241f85b7105c865c0682'
IMAGE = '2817c7e2438075a42d8fc6d01d9e525164c9ea05d6696776d94ae26e901eeac4'
TRACE = b'export WAYLAND_DEBUG=client\n'
MOTION = re.compile(rb'wl_pointer[#@]\d+\.(?:motion|enter)\([^\r\n]*?,\s*(-?[\d.]+),\s*(-?[\d.]+)\)')
BUTTON = re.compile(rb'wl_pointer[#@](\d+)\.button\(\s*(\d+),\s*(\d+),\s*272,\s*(\d+)\)')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def save(path, data):
    with path.open('x', encoding='utf8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def get(port, path, guest=False):
    host = {'Host':'10.0.2.100:8766'} if guest else {}
    req = Request(f'http://127.0.0.1:{port}'+path, headers=host)
    with build_opener(ProxyHandler({})).open(req, timeout=5) as response:
        return json.load(response)


def launch(args):
    run = args.run.resolve()
    run.mkdir(exist_ok=False)
    repo = args.repo.resolve(strict=True)
    sys.path.insert(0, str(repo/'platform'))
    from qemu_demo import cached_boot_disk, emulator_command, GUEST_HOST
    if digest(args.kernel) != KERNEL or digest(args.rootfs) != IMAGE:
        raise ValueError('R117 kernel or frozen source disk SHA mismatch')
    health = get(args.port, '/api/health', guest=True)
    state = get(args.port, '/api/state', guest=True)
    workspace_id=hashlib.sha256(str(repo).encode()).hexdigest()[:16]
    if not (health.get('ok') and health.get('mode') == 'local-village' and health.get('workspace_id') == workspace_id
            and state.get('providers') == [] and state.get('autonomy') is False
            and state.get('paused') is True and state['harness']['tasks'] == []
            and state.get('ledger') == [] and any(b['id']=='farm' and b['built'] for b in state['buildings'])):
        raise ValueError('Need empty offline, paused, farm-built fixture and --qemu-guest')
    save(run/'before.json', state)
    nc = shutil.which('nc')
    if not nc:
        raise RuntimeError('netcat-openbsd required')
    disk, cache_stage = cached_boot_disk(args.rootfs.resolve(),
        guest_files=[('/etc/profile.d/00-village-ui-observe.sh', TRACE, False)])
    with tempfile.TemporaryDirectory(prefix='vlg-ui-') as name:
        work = Path(name)
        session = 'vlg-'+uuid4().hex
        net = f'user,id=net0,restrict=on,guestfwd=tcp:{GUEST_HOST}-cmd:{nc} 127.0.0.1 {args.port}'
        command = emulator_command(args.kernel.resolve(), disk, work, network=net)
        command.extend(['-name', session])
        meta = dict(session=session, repo=str(repo), work=name, port=args.port, kernel_sha256=KERNEL,
                    rootfs_sha256=IMAGE, disk=str(disk), cache=cache_stage, command=command, server=health,
                    qemu=subprocess.check_output([command[0],'--version'], text=True).splitlines()[0],
                    profile_hook=TRACE.decode().strip(), sources={f:digest(repo/f) for f in
                    ('web/harness-ui.js','web/harness.css','web/resident-actions.js','village_harness.py',
                     'server.py','platform/qemu_demo.py','platform/guest-session.sh','platform/finals_benchmark.py')})
        save(run/'launch.json', meta)
        with (run/'emulator.log').open('xb') as log, subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT) as child:
            try:
                print(f'Guest {session}; evidence {run}', flush=True)
                result = child.wait(timeout=args.duration)
            finally:
                if child.poll() is None:
                    child.terminate()
                    try: child.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait()
                if (work/'serial.log').is_file():
                    shutil.copyfile(work/'serial.log', run/'serial.log')
                save(run/'exit.json', {'returncode':child.returncode})
        return result


def wire(work, events, n):
    token = uuid4().hex
    # Query only the latest portion of the current Chromium log. A unique marker
    # separates this reply from command echo and output left on the serial console.
    cmd = ("p=$(tail -c 131072 /tmp/village-chromium.log | "
           f"grep -E 'wl_pointer.*({events})\\(' | tail -{n} | tr '\\n' '|'); "
           "printf '\\nVG%s %s\\n' " + token + ' "$p"\r')
    mark = ('VG'+token+' ').encode()
    with socket.socket(socket.AF_UNIX) as serial:
        serial.settimeout(.5)
        serial.connect(str(work/'serial.sock'))
        for byte in cmd.encode():
            serial.sendall(bytes([byte]))
            time.sleep(.004)
        data = b''
        end = time.monotonic()+7
        while time.monotonic()<end and len(data)<262144:
            try: chunk = serial.recv(8192)
            except TimeoutError: continue
            if not chunk: break
            data += chunk
            reply = re.search(rb'(?:^|[\r\n])'+mark+rb'([^\r\n]*)[\r\n]', data)
            if reply: return reply[1]
    raise RuntimeError('No marked reply from the guest serial shell')


def position(work):
    sample=MOTION.search(wire(work,'motion|enter',1))
    if sample: return tuple(map(float,sample.groups()))
    raise RuntimeError('No recent Chromium wl_pointer location; inspect the frame and serial log')


def buttons(work):
    return [tuple(map(int,entry)) for entry in BUTTON.findall(wire(work,'button',6))]


def new_click(previous, current):
    fresh=[entry for entry in current if entry not in previous]
    return any(down[0]==up[0] and down[3]==1 and up[3]==0 for down,up in zip(fresh,fresh[1:]))


def distance(x, y, point):
    return max(abs(x-point[0]), abs(y-point[1]))


def point(monitor, work, x, y):
    # A small initial motion also renews the wire record in a busy browser log.
    monitor.move(1, 1)
    time.sleep(.25)
    readings = [position(work)]
    for _ in range(36):
        px, py = readings[-1]
        if distance(x, y, readings[-1])<=3: return readings
        dx, dy = x-px, y-py
        scale = max(1, abs(dx)/85, abs(dy)/85)
        monitor.move_steps(round(dx/scale), round(dy/scale))
        time.sleep(.18)
        readings.append(position(work))
        if len(readings)>=4 and len(set(readings[-4:]))==1: break
    raise RuntimeError(f'Pointer did not converge to {(x,y)}; last observed {readings[-1]}')


def screenshot(monitor, dest):
    monitor.screenshot(dest)
    raw=dest.read_bytes()
    if raw[:8]!=b'\x89PNG\r\n\x1a\n' or raw[12:16]!=b'IHDR':
        raise ValueError('Invalid QMP framebuffer PNG')
    return {'sha256':hashlib.sha256(raw).hexdigest(), 'width':int.from_bytes(raw[16:20],'big'),
            'height':int.from_bytes(raw[20:24],'big')}


def control(args):
    run=args.run.resolve(strict=True)
    meta=json.loads((run/'launch.json').read_text(encoding='utf8'))
    sys.path.insert(0,str(Path(meta['repo'])/'platform'))
    from finals_benchmark import Monitor
    work=Path(meta['work'])
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,48}',args.label):
        raise ValueError('Choose a unique alphanumeric step label')
    out=run/args.label
    out.mkdir(exist_ok=False)
    details={'action':args.action, 'session':meta['session'], 'time_unix':time.time()}
    try:
        with socket.socket(socket.AF_UNIX) as sock:
            sock.settimeout(20)
            sock.connect(str(work/'monitor.sock'))
            with sock.makefile('rwb') as channel:
                mon=Monitor(channel)
                if mon.call('query-name').get('name')!=meta['session'] or not mon.call('query-status').get('running'):
                    raise ValueError('Saved QMP session does not match a running guest')
                if args.action=='quit':
                    mon.call('quit')
                else:
                    details['before']=screenshot(mon,out/'before.png')
                    if args.action in ('hover','click'):
                        if args.x is None or args.y is None or not (0<=args.x<details['before']['width'] and 0<=args.y<details['before']['height']):
                            raise ValueError('Choose an in-frame Chromium surface coordinate')
                        details['requested_surface_xy']=[args.x,args.y]
                        details['wayland_positions']=point(mon,work,args.x,args.y)
                        if args.action=='click':
                            prior=buttons(work)
                            mon.left_click()
                            time.sleep(.3)
                            current=buttons(work)
                            details['button_events']=current
                            details['guest_received_left_click']=new_click(prior,current)
                    if args.action=='key':
                        if not args.keys: raise ValueError('Pass one key/chord, e.g. --keys shift tab')
                        details['keys']=args.keys
                        mon.key(*args.keys)
                    if args.action=='text':
                        if not args.text or not re.fullmatch(r'[a-z0-9./: -]{1,80}',args.text):
                            raise ValueError('Use lower-case ASCII input, 1..80 chars')
                        details['typed']=args.text
                        mon.type_text(args.text)
                    if args.action!='shot':
                        time.sleep(args.settle)
                        details['after']=screenshot(mon,out/'after.png')
                    if details.get('guest_received_left_click') is False:
                        raise RuntimeError('Fresh guest BTN_LEFT press and release not confirmed; inspect frames before any retry')
        details['transport']='ok'
    except Exception as exc:
        details['error']=str(exc)
        raise
    finally: save(out/'step.json',details)


def receipt(args):
    run=args.run.resolve(strict=True)
    meta=json.loads((run/'launch.json').read_text(encoding='utf8'))
    initial=json.loads((run/'before.json').read_text(encoding='utf8'))
    if get(meta['port'],'/api/health')!=meta['server']:
        raise ValueError('The original fixture server has changed')
    data=args.save.read_bytes()
    saved=json.loads(data.decode('utf-8-sig'))
    state=get(meta['port'],'/api/state')
    summaries=state['harness']['tasks']
    if len(summaries)!=1: raise ValueError('Expected exactly one task in the isolated active fixture')
    detail=get(meta['port'],'/api/harness/task?'+urlencode({'id':summaries[0]['id']}))
    tasks=saved['harness']['tasks']
    chat=get(meta['port'],'/api/residents/chat?'+urlencode({'id':detail['worker_id']}))
    if (tasks!=[detail] or state.get('providers')!=[] or state.get('ledger')!=[] or saved.get('ledger')!=[]
            or chat['turns'] or initial['harness']['tasks'] or detail['mode']!='local' or detail['status']!=args.status):
        raise ValueError('Live detail, offline conditions, status or persisted save disagree')
    if args.goal is not None and detail['goal']!=args.goal: raise ValueError('Guest goal differs')
    if args.first_worker and detail['worker_id']!=initial['residents'][0]['id']:
        raise ValueError('Worker differs from the first seeded resident')
    if args.two_advisers:
        consults=[c for c in detail['consultations'] if c['revision']==1]
        seen=[c['reviewer_id'] for c in consults]
        if (detail['status']!='harvested' or detail['revision']!=2 or len(set(seen))!=2 or len(seen)!=2
                or detail['worker_id'] in seen or consults[0]['selected_ids'] or len(consults[1]['selected_ids'])!=1):
            raise ValueError('Need two distinct first-revision advisers and one accepted hint from adviser 2')
        chosen=[h['text'] for h in consults[1]['hints'] if h['id'] in consults[1]['selected_ids']]
        if len(chosen)!=1 or detail['history'][-1]['input_hints']!=chosen:
            raise ValueError('Primary input did not match the selected hint')
    save(run/('receipt-'+args.status+('-two' if args.two_advisers else '')+'.json'),
         {'mode':'read-only host save and local API', 'status':args.status,'two_advisers_checked':args.two_advisers,
          'save_sha256':hashlib.sha256(data).hexdigest(),'detail':detail,'worker_chat_turns':len(chat['turns']),
          'ledger':saved['ledger'],'provider_count':len(state['providers'])})


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',type=Path,required=True)
    sub=parser.add_subparsers(dest='action',required=True)
    boot=sub.add_parser('launch')
    for name in ['repo','kernel','rootfs']: boot.add_argument('--'+name,type=Path,required=True)
    boot.add_argument('--port',type=int,required=True)
    boot.add_argument('--duration',type=int,default=900,help='maximum guest seconds including startup')
    proof=sub.add_parser('receipt')
    proof.add_argument('--save',type=Path,required=True)
    proof.add_argument('--status',choices=['planted','ready','advised','harvested'],required=True)
    proof.add_argument('--goal')
    proof.add_argument('--two-advisers',action='store_true')
    proof.add_argument('--first-worker',action='store_true')
    for name in ['shot','hover','click','key','text','quit']:
        a=sub.add_parser(name); a.add_argument('label')
        a.add_argument('--settle',type=float,default=2)
        if name in ('hover','click'):
            a.add_argument('--x',type=int,required=True); a.add_argument('--y',type=int,required=True)
        if name=='key': a.add_argument('--keys',nargs='+',required=True)
        if name=='text': a.add_argument('--text',required=True)
    args=parser.parse_args()
    if not 0<=getattr(args,'settle',0)<=30: parser.error('settle must be 0..30s')
    if args.action=='launch': return launch(args)
    if args.action=='receipt': return receipt(args)
    return control(args)


if __name__=='__main__':
    sys.exit(main())

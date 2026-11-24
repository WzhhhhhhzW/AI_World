import json, socket, sys, time
from pathlib import Path
run=Path(__file__).resolve().parent/'guest'; meta=json.loads((run/'launch.json').read_text());sys.path.insert(0,str(Path(meta['repo'])/'platform'))
from finals_benchmark import Monitor
out=run/sys.argv[1];out.mkdir();direction=sys.argv[2];n=int(sys.argv[3]);assert direction in ('wheel-up','wheel-down') and 1<=n<=8
with socket.socket(socket.AF_UNIX) as sock:
 sock.settimeout(15);sock.connect(meta['work']+'/monitor.sock')
 with sock.makefile('rwb') as ch:
  m=Monitor(ch);assert m.call('query-name')['name']==meta['session'];m.screenshot(out/'before.png')
  for i in range(n):
   for down in [True,False]:m.call('input-send-event',events=[{'type':'btn','data':{'button':direction,'down':down}}])
   time.sleep(.13)
  time.sleep(1);m.screenshot(out/'after.png')
(out/'step.json').write_text(json.dumps({'event':direction,'n':n,'session':meta['session']}))

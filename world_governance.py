"""Versioned virtual-world decisions. Model output is data, never executable code."""
import copy
import heapq
import json
import math
import re
import time
import uuid

REGION = {"id":"eastwood","name":"东林开拓地","background":"maps/eastwood-v1.png","width":960,"height":640}
SLOTS = [(225,170,110,90),(680,155,110,90),(650,350,110,90)]
REGION_OBSTACLES=[(380,55,205,155),(510,510,140,125),(664,272,28,24),(703,515,30,26)]
STRUCTURES = {"cabin":"林间小屋","garden":"林间菜园","watchtower":"瞭望台"}
RULES = {"work_ticks":(12,40,20),"harvest_amount":(2,8,4),"rest_ticks":(2,12,4)}

def overlaps(a,b,pad=0):
    return a[0]<b[0]+b[2]+pad and a[0]+a[2]+pad>b[0] and a[1]<b[1]+b[3]+pad and a[1]+a[3]+pad>b[1]

def parse_object(answer):
    match=re.fullmatch(r"(?:```(?:json)?\s*)?(\{[\s\S]*\})(?:\s*```)?",answer)
    value=json.loads(match.group(1) if match else answer)
    if not isinstance(value,dict):raise ValueError("模型需返回JSON对象")
    return value

def regional_route(start,goal,structures):
    """16px navigation; central entrance/corridor cannot be built over."""
    def world(p):return ((p[0]+.5)*32,(p[1]+1)*32)
    def key(p):return tuple(round(v/16) for v in world(p))
    def point(p):return [p[0]/2-.5,p[1]/2-1]
    obstacles=REGION_OBSTACLES+[s['rect'] for s in structures]
    allowed={(x,y) for x in range(12,51) for y in range(7,37)
             if not any(r[0]-8<=x*16<=r[0]+r[2]+8 and r[1]-8<=y*16<=r[1]+r[3]+8 for r in obstacles)}
    a,b=key(start),key(goal)
    if b not in allowed:return []
    prefix=[]
    if a not in allowed:
        a=min(allowed,key=lambda p:((p[0]-a[0])**2+(p[1]-a[1])**2,p));prefix=[point(a)]
    queue=[(0,a)];prev={a:None};cost={a:0}
    while queue:
        _,p=heapq.heappop(queue)
        if p==b:
            out=[]
            while prev[p] is not None:out.append(point(p));p=prev[p]
            return prefix+out[::-1]
        for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
            n=(p[0]+dx,p[1]+dy)
            if n not in allowed:continue
            c=cost[p]+1
            if c>=cost.get(n,float('inf')):continue
            prev[n]=p;cost[n]=c;heapq.heappush(queue,(c+abs(n[0]-b[0])+abs(n[1]-b[1]),n))
    return []

class WorldGovernance:
    def init_world(self):
        w=self.s.setdefault('world',{})
        for k,v in dict(revision=0,regions=[],structures=[],proposals=[],audit=[],inspections=[],rules={k:v[2] for k,v in RULES.items()}).items():w.setdefault(k,v)
        for r in self.s['residents']:r.setdefault('region','village')

    def world_payload(self,raw):
        if not isinstance(raw,dict):raise ValueError('提案格式不正确')
        kind=raw.get('kind')
        if kind=='build':
            b=next((b for b in self.s['buildings'] if b['id']==raw.get('building')),None)
            if not b or b['built'] or b.get('constructing'):raise ValueError('该建筑当前不能开工')
            return {'kind':kind,'building':b['id']},dict(b['cost']),f"建造{b['name']}"
        if kind=='expand':
            if raw.get('region')!='eastwood' or self.s['world']['regions']:raise ValueError('东林已开拓或区域不可用')
            return {'kind':kind,'region':'eastwood'},{'wood':50,'stone':20},'开拓东林新地图'
        if kind=='structure':
            slot=raw.get('slot');name=raw.get('structure')
            if not self.s['world']['regions'] or name not in STRUCTURES or isinstance(slot,bool) or not isinstance(slot,int) or not 0<=slot<len(SLOTS):raise ValueError('请选择已开拓区域和可用建筑位置')
            rect=SLOTS[slot]
            if any(overlaps(rect,s['rect'],12) for s in self.s['world']['structures']):raise ValueError('建筑与已有结构重叠')
            return {'kind':kind,'structure':name,'slot':slot,'region':'eastwood'},{'wood':45,'stone':20},f"在东林建造{STRUCTURES[name]}"
        if kind=='rule':
            key=raw.get('rule');value=raw.get('value')
            if key not in RULES or isinstance(value,bool) or not isinstance(value,int) or not RULES[key][0]<=value<=RULES[key][1]:raise ValueError('规则参数超出可调整范围')
            if self.s['world']['rules'][key]==value:raise ValueError('规则值没有变化')
            return {'kind':kind,'rule':key,'value':value},{},f"调整{dict(work_ticks='劳动周期',harvest_amount='每次收获',rest_ticks='休息时长')[key]}为{value}"
        raise ValueError('不支持的世界指令')

    def propose(self,raw,author=None,reason=''):
        with self.lock:
            payload,cost,title=self.world_payload(raw)
            if any(p['payload']==payload and p['status'] in ('proposed','waiting','voting','approved') for p in self.s['world']['proposals']):raise ValueError('相同提案正在处理中')
            p={'id':uuid.uuid4().hex[:12],'title':title,'payload':payload,'cost':cost,'author':author,'reason':str(reason)[:300],'status':'proposed','votes':[],'electorate':[],'applied_revision':None,'clock':self.s['clock'],'time':time.time()}
            self.s['world']['proposals'].insert(0,p);self.event('世界提案',title,'api' if author else 'user');self.save();return p['id']

    def deliberate(self,pid):
        with self.lock:
            p=next((p for p in self.s['world']['proposals'] if p['id']==pid),None)
            if not p or p['status'] not in ('proposed','waiting'):raise ValueError('提案不在待表决状态')
            if self.s['paused']:raise ValueError('先恢复村庄时间')
            ids=[r['id'] for r in self.s['residents']];p['electorate']=ids
            eligible=[rid for rid in ids if self.model_ready(self.resident(rid))]
            needed=len(ids)//2+1
            if len(eligible)<needed:p.update(status='waiting',note=f'需要全体{len(ids)}位居民过半数同意，已连接的居民不足');self.save();return
            p.update(status='voting',votes=[]);self.save()
        try:
            # Every vote is a separate real model response, independent of others.
            for rid in eligible:
                if self.stop.is_set():raise ValueError('服务退出，表决中止')
                answer=self.ask(rid,'世界提案 · 独立投票','请独立评估提案，不要假称执行。\n'+json.dumps({'title':p['title'],'proposal':p['payload'],'reason':p['reason'],'cost':p['cost'],'resources':self.s['resources'],'rules':self.s['world']['rules']},ensure_ascii=False)+'\n只返回JSON：{"vote":"yes|no|abstain","reason":"具体理由"}。',300)
                vote=parse_object(answer)
                if vote.get('vote') not in ('yes','no','abstain') or not isinstance(vote.get('reason'),str):raise ValueError('模型投票格式无效')
                with self.lock:
                    r=self.resident(rid);p['votes'].append({'resident_id':rid,'name':r['name'],'vote':vote['vote'],'reason':vote['reason'][:300],'source':'api'});self.save()
            with self.lock:
                if sum(v['vote']=='yes' for v in p['votes'])>=needed:
                    p['status']='approved';self.apply_proposal(p)
                else:p.update(status='rejected',note='未获得全体居民过半数同意')
                self.save()
        except Exception:
            with self.lock:p.update(status='interrupted',note='表决中止，已发生的用量和投票原样保留');self.save()
            raise

    def apply_proposal(self,p):
        with self.lock:
            if p['applied_revision'] is not None:return False
            voters=p['electorate'];votes=p['votes']
            if p['status']!='approved' or len({v['resident_id'] for v in votes if v['vote']=='yes' and v['source']=='api' and v['resident_id'] in voters})<=len(voters)//2:raise ValueError('没有有效多数票')
            payload,cost,_=self.world_payload(p['payload'])
            if any(self.s['resources'].get(k,0)<v for k,v in cost.items()):p.update(status='blocked',note='表决后资源不足，未扣除材料');return False
            before={k:copy.deepcopy(self.s[k]) for k in ('resources','buildings','residents','world')}
            backup=self.path.parent/'world-history'/f"revision-{self.s['world']['revision']:06d}-{p['id']}.json"
            backup.parent.mkdir(parents=True,exist_ok=True)
            if not backup.exists():backup.write_text(json.dumps(self.s,ensure_ascii=False,indent=2),encoding='utf-8')
            try:
                if payload['kind']=='build':
                    for k,v in cost.items():self.s['resources'][k]-=v
                    next(b for b in self.s['buildings'] if b['id']==payload['building']).update(constructing=True,progress=0)
                else:
                    for k,v in cost.items():self.s['resources'][k]-=v
                    if payload['kind']=='expand':self.s['world']['regions'].append(copy.deepcopy(REGION))
                    elif payload['kind']=='rule':self.s['world']['rules'][payload['rule']]=payload['value']
                    else:
                        s={'id':uuid.uuid4().hex[:12],'kind':payload['structure'],'name':STRUCTURES[payload['structure']],'region':'eastwood','rect':list(SLOTS[payload['slot']]),'built':False,'progress':0}
                        self.s['world']['structures'].append(s)
                        actor=next((r for r in self.s['residents'] if not r.get('world_job') and not r.get('meeting')),None)
                        if not actor:raise ValueError('没有可参与建设的居民')
                        actor.update(world_job=s['id'],path=[])
                issues=self.audit_world()
                if issues:raise ValueError('世界校验未通过：'+'；'.join(issues))
                w=self.s['world'];w['revision']+=1;p.update(status='executed',applied_revision=w['revision'],note='多数票通过，世界指令已执行')
                w['audit'].insert(0,{'revision':w['revision'],'proposal':p['id'],'title':p['title'],'clock':self.s['clock'],'backup':backup.name})
                self.event('世界发生变化',p['title'],'api');self.save();return True
            except Exception:
                for k,v in before.items():self.s[k]=v
                current=next(q for q in self.s['world']['proposals'] if q['id']==p['id'])
                current.update(status='blocked',note='世界校验失败，变更已回滚')
                self.save();raise

    def audit_world(self):
        structures=self.s['world']['structures'];issues=[]
        if len({s['id'] for s in structures})!=len(structures):issues.append('重复建筑ID')
        for i,s in enumerate(structures):
            if tuple(s['rect']) not in SLOTS:issues.append('建筑越出可建设空地')
            if any(overlaps(s['rect'],o['rect'],12) for o in structures[:i]):issues.append('建筑重叠')
            x,y,w,h=s['rect'];goal=(round((x+w/2)/16)/2-.5,round((y+h+24)/16)/2-1)
            if not regional_route((14.5,16.5),goal,structures):issues.append('建筑入口不可达')
        if any(v<0 for v in self.s['resources'].values()):issues.append('资源为负')
        return issues

    def world_tick_resident(self,r,index):
        from village_map import entry
        structures=self.s['world']['structures']
        site=next((s for s in structures if s['id']==r.get('world_job') and not s['built']),None)
        if r.get('region','village')=='village':
            if not site or r.get('cargo') or r.get('meeting'):return False
            goal=entry('archive',index);r['activity']='前往东林入口'
            if (r['x'],r['y'])==goal:r.update(region='eastwood',x=14.5,y=16.5,path=[])
            else:
                if not r['path'] or tuple(r['path'][-1])!=goal:r['path']=self.walk((r['x'],r['y']),goal)
                if r['path']:r['x'],r['y']=r['path'].pop(0)
            return True
        if r.get('meeting') or r.get('cargo'):
            goal=(14.5,16.5);label='返回村庄'
        elif site:
            x,y,w,h=site['rect'];goal=(round((x+w/2)/16)/2-.5,round((y+h+24)/16)/2-1);label='参与'+site['name']+'建设'
        else:goal={'wood':(12.5,10.5),'stone':(22.5,9.5),'farm':(12.5,13.5)}[r['task']];label='东林 · '+{'wood':'采集木材','stone':'采集石料','farm':'照料林地'}[r['task']]
        r['activity']=label
        if (r['x'],r['y'])!=goal:
            if not r['path'] or tuple(r['path'][-1])!=goal:r['path']=regional_route((r['x'],r['y']),goal,structures)
            if r['path']:r['x'],r['y']=r['path'].pop(0)
        elif r.get('meeting') or r.get('cargo'):
            x,y=entry('archive',index);r.update(region='village',x=x,y=y,path=[])
        elif site:
            site['progress']+=1
            if site['progress']>=45:site.update(built=True,progress=45);r['world_job']=None;self.event('东林落成',site['name']+'完工了')
        else:
            r['progress']+=1
            if r['progress']>=self.s['world']['rules']['work_ticks']:r.update(progress=0,cargo={'kind':{'wood':'wood','stone':'stone','farm':'crops'}[r['task']],'amount':self.s['world']['rules']['harvest_amount']},path=[])
        return True

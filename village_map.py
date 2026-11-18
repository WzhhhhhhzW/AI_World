"""Shared art-coordinate navigation; no routes across the river or building art."""
import heapq
import json
import math
from pathlib import Path

LAYOUT=json.loads((Path(__file__).parent/'web/assets/maps/valley-layout-v1.json').read_text(encoding='utf-8'))
STEP=LAYOUT['navigation_step']

def state_point(point):
    px,py=(round(v/STEP)*STEP for v in point)
    return px/32-.5, py/32-1

def world_point(point):
    return (point[0]+.5)*32,(point[1]+1)*32

def inside(point,rect):
    x,y=point;rx,ry,w,h=rect
    return rx<=x<=rx+w and ry<=y<=ry+h

def segment_distance(p,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy or 1)))
    return math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)

def polygon_contains(p,vertices):
    x,y=p;contained=False
    for a,b in zip(vertices,vertices[1:]+vertices[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:contained=not contained
    return contained

class VillageNavigation:
    def __init__(self):
        self.walkable=set()
        for y in range(1,LAYOUT['height']//STEP):
            for x in range(1,LAYOUT['width']//STEP):
                p=(x*STEP,y*STEP)
                if self.contains_world(p):self.walkable.add((x,y))

    def contains_world(self,p):
        nav=LAYOUT['navigation']
        if any(inside(p,r) for r in nav['obstacles']):return False
        if any(polygon_contains(p,v) for v in nav.get('blocked_polygons',[])):return False
        return any(inside(p,r) for r in nav['areas']) or any(segment_distance(p,a,b)<=line['width']/2 for line in nav['corridors'] for a,b in zip(line['points'],line['points'][1:]))

    def key(self,p):
        wx,wy=world_point(p)
        return round(wx/STEP),round(wy/STEP)

    def point(self,key):
        return state_point((key[0]*STEP,key[1]*STEP))

    def nearest(self,p):
        x,y=self.key(p)
        return self.point(min(self.walkable,key=lambda q:((q[0]-x)**2+(q[1]-y)**2,q)))

    def allowed(self,p):
        return self.key(p) in self.walkable

    def route(self,start,goal):
        a,b=self.key(start),self.key(goal)
        if b not in self.walkable:return []
        prefix=[]
        if a not in self.walkable:
            p=self.nearest(start);a=self.key(p);prefix=[list(p)]
        queue=[(0,a)];previous={a:None};cost={a:0}
        while queue:
            _,q=heapq.heappop(queue)
            if q==b:
                path=[]
                while previous[q] is not None:path.append(list(self.point(q)));q=previous[q]
                return prefix+path[::-1]
            for dx,dy in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)):
                n=q[0]+dx,q[1]+dy
                if n not in self.walkable:continue
                if dx and dy and not self.contains_world(((q[0]+dx/2)*STEP,(q[1]+dy/2)*STEP)):continue
                new_cost=cost[q]+(math.sqrt(2) if dx and dy else 1)
                if new_cost>=cost.get(n,float('inf')):continue
                cost[n]=new_cost;previous[n]=q
                heapq.heappush(queue,(new_cost+math.hypot(n[0]-b[0],n[1]-b[1]),n))
        return []

NAVIGATION=VillageNavigation()

def entry(building_id,index=0):
    values=LAYOUT['buildings'][building_id]['entrances']
    return NAVIGATION.nearest(state_point(values[index%len(values)]))

def work_position(job,index=0):
    values=LAYOUT['jobs'][job]
    return NAVIGATION.nearest(state_point(values[index%len(values)]))

def spawn_position(index=0):
    return NAVIGATION.nearest(state_point(LAYOUT['spawn'][index%len(LAYOUT['spawn'])]))

def building_geometry(building_id):
    rect=LAYOUT['buildings'][building_id]['rect']
    return dict(zip(('x','y','w','h'),(v/32 for v in rect)))

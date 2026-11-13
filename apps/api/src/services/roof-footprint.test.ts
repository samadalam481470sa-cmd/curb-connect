import { describe, expect, it, vi } from 'vitest';
import { lookupMappedRoof, mappedBuildingCandidates } from './roof-footprint';

const anchor = {lat:32.78, lon:-97.35};
const coord = (x:number,y:number) => ({
  lat:anchor.lat+y/111320,
  lon:anchor.lon+x/(111320*Math.cos(anchor.lat*Math.PI/180)),
});
const building = (id:number,x:number,y:number,w:number,h:number) => ({
  type:'way', id, tags:{building:'yes'},
  geometry:[coord(x,y),coord(x+w,y),coord(x+w,y+h),coord(x,y+h),coord(x,y)],
});

describe('Tree-obscured building-footprint finder',()=>{
  it('uses independent building polygons and computes planar ft², not imagery pixels',()=>{
    const c=mappedBuildingCandidates({elements:[building(21,-5,-5,10,10)]},anchor);
    expect(c).toHaveLength(1);
    expect(c[0]?.containsTarget).toBe(true);
    expect(c[0]?.planAreaSqFt).toBeGreaterThan(1070);
    expect(c[0]?.planAreaSqFt).toBeLessThan(1085);
    expect(c[0]?.ring).toHaveLength(4);
    expect(c[0]?.sourceUrl).toBe('https://www.openstreetmap.org/way/21');
  });
  it('ranks the closest structure without claiming to match an address',()=>{
    const c=mappedBuildingCandidates({elements:[
      building(10,28,0,12,12),building(11,-4,-4,8,8),building(12,70,0,10,10),
    ]},anchor);
    expect(c.map(v=>v.id)).toEqual(['way/11','way/10']);
    expect(c[1]?.containsTarget).toBe(false);
  });
  it('drops malformed polygons, tiny objects, oversized or faraway buildings',()=>{
    const bad={type:'way',id:12,geometry:[coord(0,0),{lat:'bad',lon:0},coord(0,1),coord(1,1)]};
    const huge=building(20,-200,-200,400,400);
    expect(mappedBuildingCandidates({elements:[
      bad,building(21,0,0,1,1),huge,building(22,75,75,10,10),
    ]},anchor)).toEqual([]);
  });
  it('posts only to the fixed Overpass endpoint with bounded coordinate query',async()=>{
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(url).toBe('https://overpass-api.de/api/interpreter');
      expect(init?.method).toBe('POST');
      expect(String(init?.body)).toContain('data=');
      expect(String(init?.body)).toContain('32.780000');
      return {ok:true,headers:new Headers(),text:async()=>JSON.stringify({
        elements:[building(7,-5,-5,10,10)],
      })};
    });
    const response=await lookupMappedRoof(anchor,fetcher as unknown as typeof fetch);
    expect(response.status).toBe('found');
    expect(response.candidates).toHaveLength(1);
  });
  it('abstains on provider outages or incomplete responses',async()=>{
    const failed=await lookupMappedRoof(anchor,(async()=>{throw Error('network');}) as typeof fetch);
    expect(failed.status).toBe('upstream_unavailable');
    const empty=await lookupMappedRoof(anchor,(async()=>({
      ok:true,headers:new Headers(),text:async()=>JSON.stringify({elements:[]}),
    })) as typeof fetch);
    expect(empty.status).toBe('no_footprint');
  });
});

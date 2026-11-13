import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoofMap } from './RoofMap';
import type { MapFacet } from './facetMath';

const post = vi.hoisted(()=>vi.fn());
vi.mock('../../../lib/session',()=>({useApi:()=>({api:{post}})}));
vi.mock('maplibre-gl',()=>{
  class FakeMap {
    private sources=new Map<string,{setData:(value:unknown)=>void}>();
    readonly dragPan={disable:vi.fn(),enable:vi.fn()};
    readonly touchZoomRotate={disable:vi.fn(),enable:vi.fn()};
    private canvas={style:{cursor:''}};
    constructor(_options:unknown) { void _options; }
    on(event:string, callback:()=>void) {
      if(event==='load') queueMicrotask(callback);
    }
    addControl() {}
    addSource(id:string) {this.sources.set(id,{setData:vi.fn()});}
    getSource(id:string) {return this.sources.get(id);}
    addLayer() {}
    setLayoutProperty() {}
    setFeatureState() {}
    getCanvas(){return this.canvas;}
    getCenter(){return {lat:32.78,lng:-97.35};}
    getZoom(){return 19;}
    project(){return {x:0,y:0};}
    queryRenderedFeatures(){return [];}
    fitBounds() {}
    flyTo() {}
    remove() {}
  }
  return {
    Map:FakeMap,NavigationControl:class {},ScaleControl:class {},
    setWorkerUrl:vi.fn(),getVersion:()=> '6.0.0',
  };
});

const ring=[
  {lon:-97.35008,lat:32.77996},
  {lon:-97.34994,lat:32.77996},
  {lon:-97.34994,lat:32.78005},
  {lon:-97.35008,lat:32.78005},
];
const candidate={
  id:'way/100',label:'Mapped home',ring,planAreaSqFt:1295,distanceMeters:0,
  containsTarget:true,sourceUrl:'https://www.openstreetmap.org/way/100',
};
async function resolveAddress(){
  fireEvent.change(screen.getByRole('textbox',{name:'Job address'}),{
    target:{value:'100 Main St Fort Worth TX'},
  });
  await waitFor(()=>expect((screen.getByRole('button',{name:'Fly to'}) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button',{name:'Fly to'}));
  await screen.findByText(/address located/);
}
async function findCandidate(){
  fireEvent.click(screen.getByRole('button',{name:'Find roof under trees'}));
  await screen.findByText(/Mapped building footprints found/);
}

beforeEach(()=>{
  post.mockReset();
  post.mockResolvedValue({
    status:'found',provider:'openstreetmap',candidates:[candidate],
    message:'Mapped building footprints found near this address.',
  });
  vi.stubGlobal('fetch',vi.fn(async()=>({
    ok:true,json:async()=>[{
      lat:'32.780000',lon:'-97.350000',display_name:'100 Main St Fort Worth Texas',
    }],
  })));
});
afterEach(()=>vi.unstubAllGlobals());

describe('roof map button actions',()=>{
  it('searches, requests the selected footprint, shows clean view, calculates an initial roof plan, and discards proposals',async()=>{
    const onAutoOutline=vi.fn(),onAutoFacet=vi.fn(),onAddressResolved=vi.fn();
    render(<RoofMap facets={[]} results={[]} selectedId={null}
      onSelect={vi.fn()} onFacetDrawn={vi.fn()}
      onAutoOutline={onAutoOutline} onAutoFacet={onAutoFacet}
      onAddressResolved={onAddressResolved}/>);
    await resolveAddress();
    expect(onAddressResolved).toHaveBeenCalledWith(
      '100 Main St Fort Worth TX',{lat:32.78,lon:-97.35});
    await findCandidate();
    expect(post).toHaveBeenCalledWith('/v1/imagery/roof-footprint',
      {lat:32.78,lon:-97.35},expect.objectContaining({schema:expect.anything()}));
    const clean=screen.getByRole('button',{name:'Show clean tree-free outline'});
    fireEvent.click(clean);
    expect(onAutoOutline).toHaveBeenCalledWith(ring);
    expect(screen.getByRole('button',{name:'Clean'}).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button',{name:'Auto-calculate roof plan size'}));
    expect(onAutoFacet).toHaveBeenCalledWith(ring);
    fireEvent.click(screen.getByRole('button',{name:'Discard suggestion'}));
    expect(screen.queryByRole('button',{name:'Auto-calculate roof plan size'})).toBeNull();
  });
  it('protects preexisting roof facets from double-counting the GIS building outline',async()=>{
    const existing:MapFacet={id:'a',name:'Front',ring,pitch:6};
    const onAutoFacet=vi.fn();
    render(<RoofMap facets={[existing]} results={[]} selectedId={null}
      onSelect={vi.fn()} onFacetDrawn={vi.fn()} onAutoFacet={onAutoFacet}/>);
    await resolveAddress();
    await findCandidate();
    const button=screen.getByRole('button',{name:'Auto-calculate roof plan size'}) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onAutoFacet).not.toHaveBeenCalled();
    expect(screen.getByText(/Existing facets are protected/)).toBeTruthy();
  });
  it('shows an actionable manual tracing fallback when no mapped building is found',async()=>{
    post.mockResolvedValue({status:'no_footprint',provider:'openstreetmap',
      message:'No usable mapped building outline was found here.',candidates:[]});
    render(<RoofMap facets={[]} results={[]} selectedId={null}
      onSelect={vi.fn()} onFacetDrawn={vi.fn()}/>);
    await resolveAddress();
    fireEvent.click(screen.getByRole('button',{name:'Find roof under trees'}));
    await screen.findByText(/No usable mapped building outline/);
    expect(screen.queryByRole('button',{name:'Auto-calculate roof plan size'})).toBeNull();
    expect((screen.getByRole('button',{name:'Trace facet'}) as HTMLButtonElement).disabled).toBe(false);
  });
});

'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import styles from './ConcreteFleetMap.module.css';

type FleetVehicle = {
  id:string; vehicleNumber:string; currentDriverId?:string|null;
  lastLatitude?:number|null; lastLongitude?:number|null; lastSpeedMph?:string|number|null;
  lastSeenAt?:string|null; fuelPercent?:string|number|null;
};
type FleetDriver = { id:string; displayName:string };
type Props = { vehicles:FleetVehicle[]; drivers:FleetDriver[] };

const START:[number,number]=[-96.797,32.7767];
function movement(vehicle:FleetVehicle) {
  if(!vehicle.lastSeenAt)return 'no_signal';
  const age=Date.now()-new Date(vehicle.lastSeenAt).getTime();
  if(!Number.isFinite(age)||age>15*60*1000)return 'no_signal';
  return Number(vehicle.lastSpeedMph??0)>2?'moving':'stopped';
}
function fleetGeoJson(vehicles:FleetVehicle[]) {
  return {
    type:'FeatureCollection' as const,
    features:vehicles.filter(v=>typeof v.lastLatitude==='number'&&typeof v.lastLongitude==='number')
      .map(v=>({
        type:'Feature' as const,
        properties:{
          id:v.id,vehicleNumber:v.vehicleNumber,driverId:v.currentDriverId??'',
          movement:movement(v),speedMph:Number(v.lastSpeedMph??0),
          fuelPercent:v.fuelPercent===null||v.fuelPercent===undefined?'':String(v.fuelPercent),
          lastSeenAt:v.lastSeenAt??'',
        },
        geometry:{type:'Point' as const,coordinates:[v.lastLongitude!,v.lastLatitude!]},
      })),
  };
}
function popupNode(props:Record<string,unknown>,driverName:string) {
  const root=document.createElement('div');
  root.className='cc-fleet-popup';
  const title=document.createElement('strong');
  title.textContent=String(props.vehicleNumber??'Mixer truck');
  const driver=document.createElement('p');
  driver.textContent='Driver: '+(driverName||'Unassigned');
  const state=document.createElement('p');
  state.textContent='Status: '+String(props.movement??'unknown').replaceAll('_',' ');
  const speed=document.createElement('p');
  speed.textContent='Speed: '+Number(props.speedMph??0).toFixed(1)+' mph';
  const fuel=document.createElement('p');
  fuel.textContent='Fuel: '+(props.fuelPercent?String(props.fuelPercent)+'%':'Not reported');
  const seen=document.createElement('small');
  seen.textContent='Last report: '+(props.lastSeenAt?new Date(String(props.lastSeenAt)).toLocaleString():'No signal');
  root.append(title,driver,state,speed,fuel,seen);
  return root;
}

export function ConcreteFleetMap({vehicles,drivers}:Props) {
  const container=useRef<HTMLDivElement>(null);
  const mapRef=useRef<MapLibreMap|null>(null);
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const driverNames=useMemo(()=>new Map(drivers.map(d=>[d.id,d.displayName])),[drivers]);
  const features=useMemo(()=>fleetGeoJson(vehicles),[vehicles]);
  const located=features.features.length;

  useEffect(()=>{
    let disposed=false;
    let map:MapLibreMap|null=null;
    void (async()=>{
      try {
        const ml=await import('maplibre-gl');
        if(disposed||!container.current)return;
        map=new ml.Map({
          container:container.current,
          center:START,
          zoom:5,
          minZoom:3,
          maxZoom:19,
          attributionControl:{compact:true},
          style:{
            version:8,
            sources:{
              aerial:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],tileSize:256,maxzoom:19,attribution:'Imagery © Esri, Maxar, Earthstar Geographics and the GIS User Community'},
              labels:{type:'raster',tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],tileSize:256,attribution:'Reference labels © Esri'},
            },
            layers:[
              {id:'aerial',type:'raster',source:'aerial'},
              {id:'labels',type:'raster',source:'labels'},
            ],
          },
        });
        mapRef.current=map;
        map.addControl(new ml.NavigationControl({showCompass:false}),'top-right');
        map.on('load',()=>{
          if(disposed||!map)return;
          map.addSource('concrete-fleet',{type:'geojson',data:{type:'FeatureCollection',features:[]} as never,cluster:true,clusterRadius:48,clusterMaxZoom:14});
          map.addLayer({
            id:'concrete-fleet-clusters',type:'circle',source:'concrete-fleet',
            filter:['has','point_count'],
            paint:{
              'circle-color':['step',['get','point_count'],'#177e83',25,'#246a9d',100,'#704d9b'],
              'circle-radius':['step',['get','point_count'],17,25,22,100,28],
              'circle-stroke-width':2,'circle-stroke-color':'#eafcff',
            },
          });
          map.addLayer({
            id:'concrete-fleet-cluster-count',type:'symbol',source:'concrete-fleet',
            filter:['has','point_count'],
            layout:{'text-field':['get','point_count_abbreviated'],'text-size':12},
            paint:{'text-color':'#ffffff'},
          });
          map.addLayer({
            id:'concrete-fleet-points',type:'circle',source:'concrete-fleet',
            filter:['!', ['has','point_count']],
            paint:{
              'circle-radius':7,
              'circle-color':['match',['get','movement'],'moving','#20c98a','stopped','#9b83e6','#d6a24b'],
              'circle-stroke-width':2,'circle-stroke-color':'#f7fbff',
            },
          });
          map.addLayer({
            id:'concrete-fleet-labels',type:'symbol',source:'concrete-fleet',
            filter:['!', ['has','point_count']],
            minzoom:13,
            layout:{'text-field':['get','vehicleNumber'],'text-offset':[0,1.25],'text-size':10,'text-allow-overlap':false},
            paint:{'text-color':'#ffffff','text-halo-color':'#101820','text-halo-width':1.5},
          });
          map.on('click','concrete-fleet-clusters',event=>{
            const found=map?.queryRenderedFeatures(event.point,{layers:['concrete-fleet-clusters']})??[];
            const clusterId=found[0]?.properties?.cluster_id;
            const source=map?.getSource('concrete-fleet') as GeoJSONSource|undefined;
            if(typeof clusterId!=='number'||!source||!map)return;
            source.getClusterExpansionZoom(clusterId,(err,zoom)=>{
              if(err||zoom===undefined||!map)return;
              const coordinates=(found[0]?.geometry as {coordinates?:[number,number]}|undefined)?.coordinates;
              if(coordinates)map.easeTo({center:coordinates,zoom});
            });
          });
          map.on('click','concrete-fleet-points',event=>{
            const feature=map?.queryRenderedFeatures(event.point,{layers:['concrete-fleet-points']})[0];
            if(!feature||!map)return;
            const props=(feature.properties??{}) as Record<string,unknown>;
            const coordinates=(feature.geometry as {coordinates?:[number,number]}).coordinates;
            if(!coordinates)return;
            const driverId=String(props.driverId??'');
            new ml.Popup({offset:12,maxWidth:'260px'})
              .setLngLat(coordinates)
              .setDOMContent(popupNode(props,driverNames.get(driverId)??''))
              .addTo(map);
          });
          map.on('mouseenter','concrete-fleet-clusters',()=>{if(map)map.getCanvas().style.cursor='pointer';});
          map.on('mouseleave','concrete-fleet-clusters',()=>{if(map)map.getCanvas().style.cursor='';});
          map.on('mouseenter','concrete-fleet-points',()=>{if(map)map.getCanvas().style.cursor='pointer';});
          map.on('mouseleave','concrete-fleet-points',()=>{if(map)map.getCanvas().style.cursor='';});
          setReady(true);
        });
      }catch{
        if(!disposed)setError('The fleet map could not load. The fleet table remains available below.');
      }
    })();
    return ()=>{
      disposed=true;
      map?.remove();
      mapRef.current=null;
    };
  },[driverNames]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!ready)return;
    (map.getSource('concrete-fleet') as GeoJSONSource|undefined)?.setData(features as never);
    if(!located)return;
    const points=features.features.map(f=>f.geometry.coordinates as [number,number]);
    if(points.length===1)map.easeTo({center:points[0],zoom:12});
    else{
      const bounds=new (map as unknown as {constructor:{}}).constructor();
      void bounds;
      const first=points[0]!;
      const min=[first[0],first[1]],max=[first[0],first[1]];
      for(const point of points){min[0]=Math.min(min[0],point[0]);min[1]=Math.min(min[1],point[1]);max[0]=Math.max(max[0],point[0]);max[1]=Math.max(max[1],point[1]);}
      map.fitBounds([[min[0],min[1]],[max[0],max[1]]],{padding:55,maxZoom:13,duration:600});
    }
  },[features,located,ready]);

  return <div className={styles.wrap}>
    <div className={styles.legend}><span><i className={styles.moving}/>Moving</span><span><i className={styles.stopped}/>Stopped</span><span><i className={styles.noSignal}/>No signal</span><span className={styles.count}>{located} trucks with GPS coordinates</span></div>
    <div className={styles.map} ref={container}/>
    {error&&<p className={styles.error}>{error}</p>}
    {ready&&located===0&&<p className={styles.empty}>No truck coordinates have arrived yet. Connect Samsara or provision a truck gateway to populate the map.</p>}
    {!ready&&!error&&<p className={styles.empty}>Loading live fleet map…</p>}
  </div>;
}

import type { BuildSpec } from './takeoff';
import type { HouseLayout } from './layout';
export type V3=[number,number,number];
export type Color3=[number,number,number];
export interface Triangle { a:V3;b:V3;c:V3;color:Color3;layer:'shell'|'roof'|'rooms'|'foundation'; }
export interface HouseMesh { triangles:Triangle[]; ridgeHeightFt:number; wallTopFt:number;
 extentFt:V3; roomCount:number; units:'feet'; schematic:true; }
const a=(r:number,g:number,b:number):Color3=>[r,g,b];
const concrete=a(.30,.41,.49),shell=a(.35,.62,.68),side=a(.27,.51,.61),
 roof=a(.11,.74,.83),roofShade=a(.13,.46,.74),partition=a(.71,.54,.85);
export function generateHouseMesh(spec:BuildSpec,layout:HouseLayout):HouseMesh {
 const L=layout.footprint.lengthFt,W=layout.footprint.widthFt;
 const height=spec.wallHeightFt*spec.stories;
 const ridgeRise=(W/2)*spec.roofPitch/12;
 const triangles:Triangle[]=[];
 const tri=(p:V3,q:V3,r:V3,color:Color3,layer:Triangle['layer'])=>{
  triangles.push({a:p,b:q,c:r,color,layer});
 };
 const quad=(p:V3,q:V3,r:V3,s:V3,color:Color3,layer:Triangle['layer'])=>{
  tri(p,q,r,color,layer);tri(p,r,s,color,layer);
 };
 // Floor and wall shell (schematic exterior with no certified openings or framing).
 quad([0,0,0],[L,0,0],[L,0,W],[0,0,W],concrete,'foundation');
 quad([0,0,0],[L,0,0],[L,height,0],[0,height,0],shell,'shell');
 quad([0,0,W],[L,0,W],[L,height,W],[0,height,W],side,'shell');
 quad([0,0,0],[0,0,W],[0,height,W],[0,height,0],shell,'shell');
 quad([L,0,0],[L,0,W],[L,height,W],[L,height,0],side,'shell');
 // Gable roof with exact plan span and entered rise per 12.
 const ridge=height+ridgeRise;
 quad([0,height,0],[L,height,0],[L,ridge,W/2],[0,ridge,W/2],roof,'roof');
 quad([0,ridge,W/2],[L,ridge,W/2],[L,height,W],[0,height,W],roofShade,'roof');
 tri([0,height,0],[0,height,W],[0,ridge,W/2],side,'roof');
 tri([L,height,0],[L,height,W],[L,ridge,W/2],shell,'roof');
 // Floor plan tiles allow the roof/shell to be hidden for a room layout overview.
 for (const floor of layout.floors){
  const y=(floor.level-1)*spec.wallHeightFt+0.08;
  for (const room of floor.rooms) {
   const c=room.kind==='bath'?a(.26,.70,.74):
    room.kind==='bedroom'||room.kind==='primary'?a(.65,.49,.85):partition;
   quad([room.x,y,room.y],[room.x+room.w,y,room.y],
        [room.x+room.w,y,room.y+room.h],[room.x,y,room.y+room.h],c,'rooms');
  }
 }
 const garage=layout.garage;
 if(garage){
  const x=garage.x,z=garage.y,gL=garage.w,gW=garage.h,gh=Math.min(9,spec.wallHeightFt);
  quad([x,0,z],[x+gL,0,z],[x+gL,0,z+gW],[x,0,z+gW],concrete,'foundation');
  quad([x,0,z],[x+gL,0,z],[x+gL,gh,z],[x,gh,z],shell,'shell');
  quad([x,0,z+gW],[x+gL,0,z+gW],[x+gL,gh,z+gW],[x,gh,z+gW],side,'shell');
  quad([x+gL,0,z],[x+gL,0,z+gW],[x+gL,gh,z+gW],[x+gL,gh,z],shell,'shell');
  quad([x,gh,z],[x+gL,gh,z],[x+gL,gh,z+gW],[x,gh,z+gW],roofShade,'roof');
 }
 return {triangles,ridgeHeightFt:ridge,wallTopFt:height,
  extentFt:[L+(garage?.w??0),ridge,W],roomCount:layout.floors.reduce((n,f)=>n+f.rooms.length,0),
  units:'feet',schematic:true};
}
export function renderTriangles(mesh:HouseMesh,mode:'exterior'|'cutaway'):Triangle[] {
 return mesh.triangles.filter(t=>mode==='exterior'?t.layer!=='rooms':
  t.layer==='foundation'||t.layer==='rooms');
}

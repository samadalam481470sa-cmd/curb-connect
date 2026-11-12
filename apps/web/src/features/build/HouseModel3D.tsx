'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BuildSpec, Takeoff } from './takeoff';
import { generateHouseMesh, renderTriangles } from './house3d';

const VERT=`#version 300 es
in vec3 aPos;
in vec3 aColor;
uniform vec3 uCenter;
uniform float uSize;
uniform float uYaw;
uniform float uTilt;
uniform float uZoom;
uniform float uAspect;
out vec3 vColor;
void main() {
 vec3 p=(aPos-uCenter)/uSize;
 float c=cos(uYaw),s=sin(uYaw);
 vec3 r=vec3(c*p.x+s*p.z,p.y,-s*p.x+c*p.z);
 float ct=cos(uTilt),st=sin(uTilt);
 vec3 q=vec3(r.x,ct*r.y-st*r.z,st*r.y+ct*r.z);
 gl_Position=vec4(q.x*uZoom/uAspect,q.y*uZoom,q.z*0.25,1.0);
 vColor=aColor;
}`;
const FRAG=`#version 300 es
precision highp float;
in vec3 vColor;
out vec4 outColor;
void main(){outColor=vec4(vColor,1.0);}`;

function shader(gl:WebGL2RenderingContext,type:number,source:string) {
 const sh=gl.createShader(type);
 if(!sh)throw Error('Cannot create a WebGL shader.');
 gl.shaderSource(sh,source);
 gl.compileShader(sh);
 if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){
  const msg=gl.getShaderInfoLog(sh)??'WebGL shader error';gl.deleteShader(sh);throw Error(msg);
 }
 return sh;
}
export function HouseModel3D({spec,takeoff}:{spec:BuildSpec;takeoff:Takeoff}) {
 const canvas=useRef<HTMLCanvasElement>(null);
 const pointer=useRef<{x:number;y:number}|null>(null);
 const [yaw,setYaw]=useState(0.7);
 const [tilt,setTilt]=useState(0.5);
 const [zoom,setZoom]=useState(1.45);
 const [mode,setMode]=useState<'exterior'|'cutaway'>('exterior');
 const [error,setError]=useState('');
 const mesh=useMemo(()=>generateHouseMesh(spec,takeoff.layout),[spec,takeoff.layout]);
 const triangles=useMemo(()=>renderTriangles(mesh,mode),[mesh,mode]);
 useEffect(()=>{
  const element=canvas.current;
  if(!element)return;
  const gl=element.getContext('webgl2',{alpha:false,antialias:true});
  if(!gl){queueMicrotask(()=>setError('WebGL2 is unavailable on this device. Use the 2D plan below.'));return;}
  let vs:WebGLShader|undefined,fs:WebGLShader|undefined,program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null;
  try{
   vs=shader(gl,gl.VERTEX_SHADER,VERT);fs=shader(gl,gl.FRAGMENT_SHADER,FRAG);
   program=gl.createProgram();
   if(!program)throw Error('Cannot create the WebGL program.');
   gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
   if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'WebGL link error');
   gl.useProgram(program);
   const packed:number[]=[];
   for(const t of triangles)for(const vertex of [t.a,t.b,t.c])packed.push(...vertex,...t.color);
   buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
   gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(packed),gl.STATIC_DRAW);
   const stride=6*Float32Array.BYTES_PER_ELEMENT;
   const pos=gl.getAttribLocation(program,'aPos'),color=gl.getAttribLocation(program,'aColor');
   gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,3,gl.FLOAT,false,stride,0);
   gl.enableVertexAttribArray(color);gl.vertexAttribPointer(color,3,gl.FLOAT,false,stride,3*4);
   const extent=mesh.extentFt;
   gl.uniform3f(gl.getUniformLocation(program,'uCenter'),extent[0]/2,extent[1]/2,extent[2]/2);
   gl.uniform1f(gl.getUniformLocation(program,'uSize'),Math.max(...extent));
   gl.uniform1f(gl.getUniformLocation(program,'uYaw'),yaw);
   gl.uniform1f(gl.getUniformLocation(program,'uTilt'),tilt);
   gl.uniform1f(gl.getUniformLocation(program,'uZoom'),zoom);
   const pixelRatio=Math.min(2,window.devicePixelRatio||1);
   const width=Math.max(1,Math.round(element.clientWidth*pixelRatio));
   const height=Math.max(1,Math.round(element.clientHeight*pixelRatio));
   element.width=width;element.height=height;gl.viewport(0,0,width,height);
   gl.uniform1f(gl.getUniformLocation(program,'uAspect'),width/height);
   gl.clearColor(.03,.07,.12,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
   gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
   gl.drawArrays(gl.TRIANGLES,0,packed.length/6);
  }catch(cause){
   const message=cause instanceof Error?cause.message:'3D preview failed';
   queueMicrotask(()=>setError(message));
  }
  return()=>{if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);
   if(vs)gl.deleteShader(vs);if(fs)gl.deleteShader(fs);};
 },[mesh,triangles,yaw,tilt,zoom]);
 const exportModel=()=>{
  const payload={schema:'fieldpro.house.schematic.v1',issuedAt:new Date().toISOString(),
   source:'contractor-entered plan dimensions',engineeringApproved:false,
   spec,summary:takeoff.summary,mesh};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='fieldpro-house-schematic.json';a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),0);
 };
 return <section aria-label="Interactive 3D house preview">
  <div className="cc-house3d-tools">
   <button type="button" className="cc-btn cc-btn--sm"
     aria-pressed={mode==='exterior'} onClick={()=>setMode('exterior')}>Exterior & roof</button>
   <button type="button" className="cc-btn cc-btn--sm"
     aria-pressed={mode==='cutaway'} onClick={()=>setMode('cutaway')}>Floor cutaway</button>
   <button type="button" className="cc-btn cc-btn--sm" onClick={()=>setYaw(v=>v+Math.PI/4)}>Rotate 45°</button>
   <button type="button" className="cc-btn cc-btn--sm" onClick={()=>setZoom(v=>Math.min(2.8,v+.2))}>Zoom +</button>
   <button type="button" className="cc-btn cc-btn--sm" onClick={()=>setZoom(v=>Math.max(.6,v-.2))}>Zoom −</button>
   <button type="button" className="cc-btn cc-btn--sm" onClick={exportModel}>Export model JSON</button>
  </div>
  <canvas ref={canvas} className="cc-house3d-canvas" aria-label="Interactive WebGL2 house design model"
    onPointerDown={e=>{pointer.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{if(!pointer.current)return;
     const dx=e.clientX-pointer.current.x,dy=e.clientY-pointer.current.y;
     pointer.current={x:e.clientX,y:e.clientY};
     setYaw(v=>v+dx*.012);setTilt(v=>Math.max(-1.2,Math.min(1.2,v+dy*.008)));
    }}
    onPointerUp={()=>{pointer.current=null;}} onPointerCancel={()=>{pointer.current=null;}}
  />
  {error&&<p className="web-denied-reason" role="alert">{error}</p>}
  <p className="web-muted web-small">Drag to orbit · {mesh.extentFt[0].toFixed(1)} ×
    {' '}{mesh.extentFt[2].toFixed(1)} ft maximum footprint including garage.
    Wall height {mesh.wallTopFt.toFixed(1)} ft · ridge height {mesh.ridgeHeightFt.toFixed(1)} ft.
    This is an editable geometric concept, not an engineering plan, permit drawing, DWG or certified BIM model.
    Roof/truss loads, openings, mechanical services, egress and building-code compliance are not validated.</p>
 </section>;
}

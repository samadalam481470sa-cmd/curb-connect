'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { measureCurbInPhoto, type Point2 } from './cameraMeasureMath';

type Stage = 'idle' | 'starting' | 'live' | 'photo';
type Step = 'reference' | 'curb';
const CORNER_LABELS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
export function CurbCameraMeasure({ onApplyLength }: { onApplyLength: (feet:number) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage,setStage] = useState<Stage>('idle');
  const [photo,setPhoto] = useState('');
  const [step,setStep] = useState<Step>('reference');
  const [corners,setCorners] = useState<Point2[]>([]);
  const [path,setPath] = useState<Point2[]>([]);
  const [refWidth,setRefWidth] = useState('8.5');
  const [refHeight,setRefHeight] = useState('11');
  const [error,setError] = useState('');
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  },[]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; requestRef.current++; stopCamera(); };
  },[stopCamera]);
  useEffect(() => {
    if(stage !== 'live' || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => setError('Camera playback blocked. Use Take Photo instead.'));
  },[stage]);
  const reset = () => {setCorners([]);setPath([]);setStep('reference');};
  const result = useMemo(() => {
    if(corners.length !== 4 || path.length < 2) return {value:null as number|null,error:''};
    try{return {value:measureCurbInPhoto(corners,Number(refWidth),Number(refHeight),path).lengthFt,error:''};}
    catch(cause){return {value:null,error:cause instanceof Error?cause.message:'Calibration failed.'};}
  },[corners,path,refWidth,refHeight]);
  async function startCamera() {
    const request = ++requestRef.current;
    stopCamera();reset();setPhoto('');setError('');
    if(!navigator.mediaDevices?.getUserMedia) {
      setError('Live camera unavailable in this browser. Use Take Photo instead.');setStage('idle');return;
    }
    setStage('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},
      });
      if (!mountedRef.current || requestRef.current !== request) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current=stream;setStage('live');
    } catch(cause) {
      if (!mountedRef.current || requestRef.current !== request) return;
      setStage('idle');
      setError(cause instanceof Error?cause.message:'Camera permission denied.');
    }
  }
  function photograph() {
    const video=videoRef.current;
    if(!video || video.videoWidth<10) {setError('Camera image not ready yet.');return;}
    const canvas=document.createElement('canvas');
    const ratio=Math.min(1,1920/Math.max(video.videoWidth,video.videoHeight));
    canvas.width=Math.round(video.videoWidth*ratio);
    canvas.height=Math.round(video.videoHeight*ratio);
    const ctx=canvas.getContext('2d');
    if(!ctx){setError('Camera capture unavailable.');return;}
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg',.85));
    requestRef.current++;stopCamera();reset();setStage('photo');setError('');
  }
  async function importPhoto(file?:File) {
    if(!file)return;
    if(!file.type.startsWith('image/')||file.size>25_000_000) {
      setError('Choose a supported image smaller than 25 MB.');return;
    }
    try {
      const bitmap=await createImageBitmap(file);
      const canvas=document.createElement('canvas');
      const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.round(bitmap.width*scale);
      canvas.height=Math.round(bitmap.height*scale);
      const context=canvas.getContext('2d');
      if(!context){bitmap.close();throw Error('Cannot load photo.');}
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      bitmap.close();
      stopCamera();setPhoto(canvas.toDataURL('image/jpeg',.85));reset();
      setStage('photo');setError('');
    } catch { setError('Could not decode photo. Try JPEG or PNG.'); }
  }
  function addPoint(e:React.MouseEvent<HTMLDivElement>) {
    const rect=e.currentTarget.getBoundingClientRect();
    const point={x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height};
    if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.y<0||point.x>1||point.y>1)return;
    if(step==='reference' && corners.length<4) {
      setCorners(list=>[...list,point]);
      if(corners.length===3)setStep('curb');
    } else if(step==='curb' && corners.length===4 && path.length<100) setPath(list=>[...list,point]);
  }
  function undo() {
    if(step==='curb' && path.length)setPath(list=>list.slice(0,-1));
    else if(step==='curb')setStep('reference');
    else setCorners(list=>list.slice(0,-1));
  }
  const coords=(list:Point2[])=>list.map(p=>String(p.x*1000)+','+String(p.y*1000)).join(' ');
  const prompt=step==='reference'?CORNER_LABELS[corners.length]??'reference complete':
    path.length?'next curb point or bend':'first curb endpoint';
  return <section className="cc-camera-measure" aria-label="Camera curb measurement">
    <p className="web-muted web-small">
      Use the camera for a <strong>calibrated photo measurement</strong>. Place a rigid rectangular
      object of known dimensions flat on the same ground plane as the curb path. Capture an image,
      tap its four corners, and trace the curb line. This corrects photo perspective
      approximately, but is not iPhone ARKit/LiDAR or a verified field survey.
    </p>
    <div className="cc-camera-toolbar">
      <button className="cc-btn cc-btn--primary" type="button" disabled={stage==='starting'}
        onClick={()=>void startCamera()}>{stage==='starting'?'Opening camera…':'Open camera'}</button>
      <button type="button" className="cc-btn" onClick={()=>fileRef.current?.click()}>
        Take Photo / Choose Image
      </button>
      <input ref={fileRef} className="cc-camera-file" type="file" accept="image/*"
        capture="environment" aria-label="Take or choose a curb photo"
        onChange={e=>{void importPhoto(e.currentTarget.files?.[0]);e.currentTarget.value='';}}/>
      {stage==='live' && <>
        <button type="button" className="cc-btn cc-btn--primary" onClick={photograph}>Capture frame</button>
        <button type="button" className="cc-btn" onClick={()=>{requestRef.current++;stopCamera();setStage('idle');}}>Close</button>
      </>}
    </div>
    {stage==='live' && <div className="cc-camera-viewport">
      <video ref={videoRef} autoPlay playsInline muted className="cc-camera-video"
        aria-label="Live rear camera preview"/>
      <span className="cc-camera-reticle" aria-hidden="true">+</span>
    </div>}
    {stage==='photo' && <div className="cc-camera-capture">
      <div className="cc-camera-toolbar">
        <button type="button" className="cc-btn cc-btn--sm"
          aria-pressed={step==='reference'} onClick={()=>setStep('reference')}>1. Reference ({corners.length}/4)</button>
        <button type="button" className="cc-btn cc-btn--sm"
          disabled={corners.length<4} aria-pressed={step==='curb'}
          onClick={()=>setStep('curb')}>2. Curb path ({path.length} points)</button>
        <button type="button" className="cc-btn cc-btn--sm" onClick={undo}>Undo</button>
        <button type="button" className="cc-btn cc-btn--sm" onClick={reset}>Reset</button>
      </div>
      <p className="web-muted web-small" role="status">
        Tap <strong>{prompt}</strong> on the image. Mark the reference corners in clockwise
        order: top-left, top-right, bottom-right, bottom-left.
      </p>
      <div className="cc-camera-photo" onClick={addPoint}
        role="img" aria-label="Photo with manually positioned curb and scale reference points">
        <img src={photo} alt="Curb photo with measurement overlays" draggable={false}/>
        <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          {corners.length>1 && <polyline points={coords(corners)} fill="none"
            stroke="#facc15" strokeWidth="3" vectorEffect="non-scaling-stroke"/>}
          {corners.length===4 && <line x1={corners[3]!.x*1000} y1={corners[3]!.y*1000}
            x2={corners[0]!.x*1000} y2={corners[0]!.y*1000}
            stroke="#facc15" strokeWidth="3" vectorEffect="non-scaling-stroke"/>}
          {path.length>1 && <polyline points={coords(path)} fill="none"
            stroke="#36e7f4" strokeWidth="4" vectorEffect="non-scaling-stroke"/>}
          {corners.map((p,i)=><circle key={'ref'+i} cx={p.x*1000} cy={p.y*1000} r="11"
            fill="#facc15" stroke="#071221" strokeWidth="3" vectorEffect="non-scaling-stroke"/>)}
          {path.map((p,i)=><circle key={'path'+i} cx={p.x*1000} cy={p.y*1000} r="11"
            fill="#36e7f4" stroke="#071221" strokeWidth="3" vectorEffect="non-scaling-stroke"/>)}
        </svg>
      </div>
      <div className="cc-form-grid">
        <label className="cc-field"><span>Reference width (inches)</span>
          <input className="cc-input" type="number" inputMode="decimal" min=".1" max="240"
            step=".1" value={refWidth} onChange={e=>setRefWidth(e.currentTarget.value)}/></label>
        <label className="cc-field"><span>Reference height (inches)</span>
          <input className="cc-input" type="number" inputMode="decimal" min=".1" max="240"
            step=".1" value={refHeight} onChange={e=>setRefHeight(e.currentTarget.value)}/></label>
      </div>
      {result.error && <p role="alert" className="web-denied-reason">{result.error}</p>}
      {result.value!==null && <div className="cc-camera-result">
        <strong>{result.value.toFixed(2)} ft</strong>
        <p>Approximate curb path length from this calibrated image. Large distances
          far from the reference can be inaccurate. Verify on site before quoting.</p>
        <button type="button" className="cc-btn cc-btn--primary"
          onClick={()=>onApplyLength(Number(result.value!.toFixed(2)))}>
          Use length in curb estimate
        </button>
      </div>}
    </div>}
    {error && <p role="alert" className="web-denied-reason">{error}</p>}
    <p className="web-muted web-small">
      Photos remain in your browser and are not automatically uploaded. The camera cannot
      reveal buried concrete depth, reinforcement or utilities. Native iPhone ARKit/LiDAR
      measurement requires a separate native iOS app integration.
    </p>
  </section>;
}

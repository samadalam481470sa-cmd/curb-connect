'use client';

import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { RouteGate } from '../../components/RouteGate';
import { ConcreteFleetMap } from './ConcreteFleetMap';
import { useApi, useSession, orgKey } from '../../lib/session';
import styles from './ConcreteCompanyWorkspace.module.css';

const SettingsSchema = z.object({ enabled: z.boolean(), companyName: z.string(), timezone: z.string() }).passthrough();
const OverviewSchema = z.object({
  settings: SettingsSchema.nullable(), canManage: z.boolean(),
  stats: z.object({ vehicles:z.number(),activeVehicles:z.number(),movingVehicles:z.number(),activeDrivers:z.number(),activeDeliveries:z.number(),openAlerts:z.number(),connectedIntegrations:z.number() }),
});
const VehicleSchema = z.object({
  id:z.string(),vehicleNumber:z.string(),status:z.string(),currentDriverId:z.string().nullable().optional(),
  lastSeenAt:z.string().nullable().optional(),lastLatitude:z.number().nullable().optional(),lastLongitude:z.number().nullable().optional(),
  lastSpeedMph:z.union([z.string(),z.number()]).nullable().optional(),fuelPercent:z.union([z.string(),z.number()]).nullable().optional(),
  engineRpm:z.number().nullable().optional(),drumRpm:z.number().nullable().optional(),telematicsProvider:z.string().optional(),
}).passthrough();
const VehiclesSchema = z.object({items:z.array(VehicleSchema),total:z.number(),limit:z.number(),offset:z.number()});
const DriverSchema = z.object({id:z.string(),employeeCode:z.string(),displayName:z.string(),phone:z.string().nullable().optional(),email:z.string().nullable().optional(),status:z.string()}).passthrough();
const DriversSchema = z.object({items:z.array(DriverSchema),total:z.number(),limit:z.number(),offset:z.number()});
const PlantSchema = z.object({id:z.string(),code:z.string(),name:z.string(),city:z.string().optional()}).passthrough();
const PlantsSchema = z.object({items:z.array(PlantSchema)});
const DeliverySchema = z.object({id:z.string(),ticketNumber:z.string(),jobName:z.string(),customerName:z.string(),status:z.string(),orderedYards:z.union([z.string(),z.number()]),scheduledAt:z.string().nullable().optional(),vehicleId:z.string().nullable().optional(),driverId:z.string().nullable().optional()}).passthrough();
const DeliveriesSchema = z.object({items:z.array(DeliverySchema),limit:z.number(),offset:z.number()});
const IntegrationSchema = z.object({id:z.string(),provider:z.string(),label:z.string(),status:z.string(),lastSyncAt:z.string().nullable().optional(),lastError:z.string().nullable().optional()}).passthrough();
const IntegrationsSchema = z.object({items:z.array(IntegrationSchema)});
const ProviderSchema = z.object({id:z.string(),name:z.string(),category:z.string(),capabilities:z.array(z.string()),auth:z.string(),docs:z.string(),state:z.string()});
const ProvidersSchema = z.object({items:z.array(ProviderSchema)});
const AlertSchema = z.object({id:z.string(),title:z.string(),message:z.string(),severity:z.string(),status:z.string(),detectedAt:z.string()}).passthrough();
const AlertsSchema = z.object({items:z.array(AlertSchema)});
const QualitySchema = z.object({id:z.string(),deliveryId:z.string(),observationType:z.string(),measuredValue:z.union([z.string(),z.number()]),unit:z.string(),result:z.string(),notes:z.string(),observedAt:z.string()}).passthrough();
const QualityListSchema = z.object({items:z.array(QualitySchema),limit:z.number(),offset:z.number()});
const MaintenanceSchema = z.object({id:z.string(),vehicleId:z.string(),workOrderNumber:z.string(),category:z.string(),priority:z.string(),status:z.string(),description:z.string(),dueAt:z.string().nullable().optional()}).passthrough();
const MaintenanceListSchema = z.object({items:z.array(MaintenanceSchema)});
const InsightsSchema = z.object({
  generatedAt:z.string(),method:z.string(),
  insights:z.array(z.object({id:z.string(),severity:z.string(),title:z.string(),message:z.string(),action:z.string()}).passthrough()),
  disclaimer:z.string(),
});

type Tab = 'overview'|'fleet'|'dispatch'|'quality'|'integrations'|'insights';
const TABS:Array<{id:Tab;label:string}> = [
  {id:'overview',label:'Overview'},{id:'fleet',label:'Fleet & Drivers'},{id:'dispatch',label:'Dispatch'},
  {id:'quality',label:'Quality & Maintenance'},{id:'integrations',label:'Integrations & Hardware'},{id:'insights',label:'AI Insights'},
];
const DELIVERY_NEXT:Record<string,string[]> = {scheduled:['batched','cancelled'],batched:['loaded','cancelled'],loaded:['dispatched','cancelled'],dispatched:['arrived','cancelled'],arrived:['pouring','completed','cancelled'],pouring:['completed','cancelled'],completed:[],cancelled:[]};
const PROVIDER_LABELS:Record<string,string> = {
  samsara:'Samsara',geotab:'Geotab MyGeotab',command_alkon:'Command Alkon Digital Fleet / TrackIt',
  jonel:'Jonel Access / FLEX API',bcmi:'BCMI API Portal',giatec:'Giatec SmartMix / MixPilot',custom_gateway:'Curb Connect Truck Gateway',
};
function freshState(lastSeenAt?:string|null,speed?:string|number|null) {
  if(!lastSeenAt)return 'No signal';
  const age=Date.now()-new Date(lastSeenAt).getTime();
  if(!Number.isFinite(age)||age>15*60*1000)return 'No signal';
  return Number(speed??0)>2?'Moving':'Stopped';
}
function fmtDate(value?:string|null) {
  if(!value)return '—';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleString():'—';
}
function numberText(value:string|number|null|undefined,suffix='') {
  if(value===null||value===undefined||value==='')return '—';
  const n=Number(value);
  return Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:1})+suffix:'—';
}

export function ConcreteCompanyWorkspace() {
  return <RouteGate routeId="concrete-company"><ConcreteCompanyContent /></RouteGate>;
}

function ConcreteCompanyContent() {
  const {api}=useApi();
  const session=useSession();
  const queryClient=useQueryClient();
  const prefix=orgKey(session.orgId,'concrete-company');
  const [tab,setTab]=useState<Tab>('overview');
  const [busy,setBusy]=useState('');
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [companyName,setCompanyName]=useState('');
  const [vehicleOffset,setVehicleOffset]=useState(0);
  const [driverOffset,setDriverOffset]=useState(0);
  const [plantCode,setPlantCode]=useState('');
  const [plantName,setPlantName]=useState('');
  const [plantCity,setPlantCity]=useState('');
  const [driverCode,setDriverCode]=useState('');
  const [driverName,setDriverName]=useState('');
  const [driverPhone,setDriverPhone]=useState('');
  const [truckNumber,setTruckNumber]=useState('');
  const [truckVin,setTruckVin]=useState('');
  const [truckPlantId,setTruckPlantId]=useState('');
  const [ticketNumber,setTicketNumber]=useState('');
  const [customerName,setCustomerName]=useState('');
  const [jobName,setJobName]=useState('');
  const [mixCode,setMixCode]=useState('');
  const [scheduledAt,setScheduledAt]=useState('');
  const [jobAddress,setJobAddress]=useState('');
  const [orderedYards,setOrderedYards]=useState('10');
  const [deliveryPlantId,setDeliveryPlantId]=useState('');
  const [deliveryVehicleId,setDeliveryVehicleId]=useState('');
  const [deliveryDriverId,setDeliveryDriverId]=useState('');
  const [provider,setProvider]=useState('samsara');
  const [integrationLabel,setIntegrationLabel]=useState('Primary fleet connection');
  const [apiToken,setApiToken]=useState('');
  const [qualityDeliveryId,setQualityDeliveryId]=useState('');
  const [qualityType,setQualityType]=useState('slump');
  const [qualityValue,setQualityValue]=useState('4');
  const [qualityUnit,setQualityUnit]=useState('in');
  const [qualityResult,setQualityResult]=useState('recorded');
  const [qualityNotes,setQualityNotes]=useState('');
  const [maintenanceVehicleId,setMaintenanceVehicleId]=useState('');
  const [maintenanceNumber,setMaintenanceNumber]=useState('');
  const [maintenanceCategory,setMaintenanceCategory]=useState('engine');
  const [maintenancePriority,setMaintenancePriority]=useState('normal');
  const [maintenanceDescription,setMaintenanceDescription]=useState('');
  const [maintenanceDueAt,setMaintenanceDueAt]=useState('');
  const [oneTimeKey,setOneTimeKey]=useState('');

  const overview=useQuery({queryKey:[...prefix,'overview'],queryFn:()=>api.get('/v1/concrete-company/overview',{schema:OverviewSchema})});
  const enabled=overview.data?.settings?.enabled===true;
  const vehicles=useQuery({queryKey:[...prefix,'vehicles',vehicleOffset],queryFn:()=>api.get('/v1/concrete-company/vehicles',{query:{limit:200,offset:vehicleOffset},schema:VehiclesSchema}),enabled});
  const drivers=useQuery({queryKey:[...prefix,'drivers',driverOffset],queryFn:()=>api.get('/v1/concrete-company/drivers',{query:{limit:200,offset:driverOffset},schema:DriversSchema}),enabled});
  const plants=useQuery({queryKey:[...prefix,'plants'],queryFn:()=>api.get('/v1/concrete-company/plants',{schema:PlantsSchema}),enabled});
  const deliveries=useQuery({queryKey:[...prefix,'deliveries'],queryFn:()=>api.get('/v1/concrete-company/deliveries',{query:{limit:100,offset:0},schema:DeliveriesSchema}),enabled});
  const integrations=useQuery({queryKey:[...prefix,'integrations'],queryFn:()=>api.get('/v1/concrete-company/integrations',{schema:IntegrationsSchema}),enabled});
  const providers=useQuery({queryKey:[...prefix,'providers'],queryFn:()=>api.get('/v1/concrete-company/providers',{schema:ProvidersSchema})});
  const alerts=useQuery({queryKey:[...prefix,'alerts'],queryFn:()=>api.get('/v1/concrete-company/alerts',{query:{limit:50,offset:0},schema:AlertsSchema}),enabled});
  const quality=useQuery({queryKey:[...prefix,'quality'],queryFn:()=>api.get('/v1/concrete-company/quality',{query:{limit:100,offset:0},schema:QualityListSchema}),enabled});
  const maintenance=useQuery({queryKey:[...prefix,'maintenance'],queryFn:()=>api.get('/v1/concrete-company/maintenance',{query:{limit:100,offset:0},schema:MaintenanceListSchema}),enabled});
  const insights=useQuery({queryKey:[...prefix,'insights'],queryFn:()=>api.get('/v1/concrete-company/insights',{schema:InsightsSchema}),enabled:enabled&&tab==='insights'});

  const plantItems=plants.data?.items??[];
  const canWrite=session.can('job:write');
  const canManageIntegrations=session.can('integration:manage');
  const canManageCompany=session.can('org:settings_update');
  const refresh=async()=>{await queryClient.invalidateQueries({queryKey:prefix});};
  const perform=async(label:string,task:()=>Promise<unknown>)=>{
    setBusy(label);setError('');setMessage('');
    try{await task();setMessage(label+' completed.');await refresh();}
    catch(cause){setError(cause instanceof Error?cause.message:'The request failed. Please try again.');}
    finally{setBusy('');}
  };
  const setup=(event:FormEvent)=>{event.preventDefault();void perform('Concrete Company setup',()=>api.put('/v1/concrete-company/settings',{enabled:true,companyName:companyName.trim(),timezone:'America/Chicago'}));};
  const addPlant=(event:FormEvent)=>{event.preventDefault();void perform('Plant creation',()=>api.post('/v1/concrete-company/plants',{code:plantCode.trim(),name:plantName.trim(),city:plantCity.trim()})).then(()=>{setPlantCode('');setPlantName('');setPlantCity('');});};
  const addDriver=(event:FormEvent)=>{event.preventDefault();void perform('Driver creation',()=>api.post('/v1/concrete-company/drivers',{employeeCode:driverCode.trim(),displayName:driverName.trim(),phone:driverPhone.trim()||undefined})).then(()=>{setDriverCode('');setDriverName('');setDriverPhone('');});};
  const addTruck=(event:FormEvent)=>{event.preventDefault();void perform('Truck registration',()=>api.post('/v1/concrete-company/vehicles',{vehicleNumber:truckNumber.trim(),vin:truckVin.trim()||undefined,plantId:truckPlantId||null})).then(()=>{setTruckNumber('');setTruckVin('');});};
  const addDelivery=(event:FormEvent)=>{event.preventDefault();void perform('Delivery scheduling',()=>api.post('/v1/concrete-company/deliveries',{
    plantId:deliveryPlantId,vehicleId:deliveryVehicleId||null,driverId:deliveryDriverId||null,ticketNumber:ticketNumber.trim(),
    customerName:customerName.trim(),jobName:jobName.trim(),jobAddress:jobAddress.trim(),mixCode:mixCode.trim(),
    scheduledAt:scheduledAt?new Date(scheduledAt).toISOString():undefined,orderedYards:Number(orderedYards),
  })).then(()=>{setTicketNumber('');setCustomerName('');setJobName('');setJobAddress('');setMixCode('');setScheduledAt('');});};
  const addIntegration=(event:FormEvent)=>{
    event.preventDefault();
    void perform('Integration registration',async()=>{
      const created=await api.post('/v1/concrete-company/integrations',{provider,label:integrationLabel.trim()}) as {id:string};
      if(apiToken.trim())await api.put('/v1/concrete-company/integrations/'+created.id+'/credentials',{apiToken:apiToken.trim()});
      if(provider==='samsara'&&apiToken.trim())await api.post('/v1/concrete-company/integrations/'+created.id+'/test');
    }).then(()=>setApiToken(''));
  };
  const testIntegration=(id:string)=>void perform('Connection test',()=>api.post('/v1/concrete-company/integrations/'+id+'/test'));
  const syncIntegration=(id:string)=>void perform('Fleet sync',()=>api.post('/v1/concrete-company/integrations/'+id+'/sync'));
  const createDeviceKey=(vehicleId:string)=>void perform('Truck gateway key',async()=>{
    const result=await api.post('/v1/concrete-company/vehicles/'+vehicleId+'/device-keys',{label:'Truck gateway'}) as {token:string};
    setOneTimeKey(result.token);
  });
  const acknowledge=(id:string)=>void perform('Alert acknowledgement',()=>api.post('/v1/concrete-company/alerts/'+id+'/acknowledge'));
  const updateDeliveryStatus=(id:string,status:string)=>void perform('Delivery status update',()=>api.patch('/v1/concrete-company/deliveries/'+id+'/status',{status}));
  const addQuality=(event:FormEvent)=>{event.preventDefault();void perform('Quality observation',()=>api.post('/v1/concrete-company/deliveries/'+qualityDeliveryId+'/quality',{
    observationType:qualityType,measuredValue:Number(qualityValue),unit:qualityUnit,result:qualityResult,notes:qualityNotes.trim(),
  })).then(()=>{setQualityNotes('');});};
  const addMaintenance=(event:FormEvent)=>{event.preventDefault();void perform('Maintenance work order',()=>api.post('/v1/concrete-company/vehicles/'+maintenanceVehicleId+'/maintenance',{
    workOrderNumber:maintenanceNumber.trim(),category:maintenanceCategory,priority:maintenancePriority,
    description:maintenanceDescription.trim(),dueAt:maintenanceDueAt?new Date(maintenanceDueAt).toISOString():undefined,
  })).then(()=>{setMaintenanceNumber('');setMaintenanceDescription('');setMaintenanceDueAt('');});};
  const updateMaintenanceStatus=(id:string,status:string)=>void perform('Maintenance status update',()=>api.patch('/v1/concrete-company/maintenance/'+id+'/status',{status}));
  const assignDriver=(vehicleId:string,driverId:string)=>void perform('Driver assignment',()=>api.patch('/v1/concrete-company/vehicles/'+vehicleId+'/driver',{driverId:driverId||null}));
  const activeTab=TABS.find(t=>t.id===tab)?.label??'Overview';

  if(overview.isPending)return <main className={styles.page}><p className={styles.muted}>Loading Concrete Company workspace…</p></main>;
  if(overview.error)return <main className={styles.page}><h1>Concrete Company</h1><p className={styles.error}>{overview.error.message}</p><button className={styles.button} onClick={()=>void overview.refetch()}>Retry</button></main>;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><div className={styles.eyebrow}>CURB CONNECT / ENTERPRISE OPERATIONS</div><h1>Concrete Company</h1>
          <p>One operating workspace for plants, mixer trucks, drivers, dispatch, quality, maintenance and connected fleet systems.</p></div>
        <div className={styles.headerMeta}><span className={styles.liveDot}/><span>{enabled?'Company workspace active':'Setup required'}</span></div>
      </header>
      {message&&<div className={styles.notice} role="status">{message}</div>}
      {error&&<div className={styles.errorBox} role="alert">{error}</div>}

      {!enabled?(
        <section className={styles.setup}>
          <div className={styles.eyebrow}>NEW BUSINESS WORKSPACE</div><h2>Activate Concrete Company</h2>
          <p>Enable a private concrete operations workspace for this Curb Connect company. Fleet records, drivers, telemetry, deliveries and integrations remain isolated to this company account.</p>
          {canManageCompany?<form onSubmit={setup} className={styles.formRow}>
            <label className={styles.field}>Company name<input value={companyName} onChange={e=>setCompanyName(e.currentTarget.value)} placeholder="Your concrete company" required maxLength={180}/></label>
            <button className={styles.primaryButton} disabled={Boolean(busy)}>{busy==='Concrete Company setup'?'Activating…':'Activate workspace'}</button>
          </form>:<p className={styles.muted}>Ask a company owner or administrator to activate this workspace.</p>}
        </section>
      ):(
        <>
          <nav className={styles.tabs} aria-label="Concrete Company areas">
            {TABS.map(item=><button key={item.id} type="button" className={tab===item.id?styles.tabActive:styles.tab} onClick={()=>setTab(item.id)}>{item.label}</button>)}
          </nav>

          {tab==='overview'&&<section className={styles.stack}>
            <div className={styles.kpis}>
              {[
                ['Total mixer trucks',overview.data.stats.vehicles,'Registered vehicles'],
                ['Moving now',overview.data.stats.movingVehicles,'Fresh GPS telemetry above 2 mph'],
                ['Active drivers',overview.data.stats.activeDrivers,'Company driver roster'],
                ['Open deliveries',overview.data.stats.activeDeliveries,'Scheduled through pouring'],
                ['Open alerts',overview.data.stats.openAlerts,'Needs dispatch or maintenance review'],
                ['Connected systems',overview.data.stats.connectedIntegrations,'Verified integrations'],
              ].map(([label,value,hint])=><article className={styles.kpi} key={String(label)}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}
            </div>
            <div className={styles.twoCol}>
              <article className={styles.panel}><h2>Operations at a glance</h2><p>Fleet status is derived from the latest timestamped telemetry. Trucks without recent reports are shown as No signal rather than assumed to be parked.</p>
                <div className={styles.statLine}><span>Active registered trucks</span><strong>{overview.data.stats.activeVehicles}</strong></div>
                <div className={styles.statLine}><span>Drivers on active roster</span><strong>{overview.data.stats.activeDrivers}</strong></div>
                <div className={styles.statLine}><span>Active deliveries</span><strong>{overview.data.stats.activeDeliveries}</strong></div>
                <button className={styles.button} onClick={()=>setTab('fleet')}>Open fleet operations</button>
              </article>
              <article className={styles.panel}><h2>Connect existing systems</h2><p>Connect telematics, concrete dispatch, batching and quality systems. Start with an existing provider before installing new truck hardware.</p>
                <div className={styles.integrationPills}><span>Samsara</span><span>Geotab</span><span>Command Alkon</span><span>Jonel</span><span>BCMI</span><span>Giatec</span></div>
                <button className={styles.button} onClick={()=>setTab('integrations')}>Manage integrations</button>
              </article>
            </div>
            <article className={styles.panel}><div className={styles.panelHeading}><div><h2>Latest operational alerts</h2><p>Actionable issues from connected vehicles and operations.</p></div><button className={styles.button} onClick={()=>setTab('quality')}>View all</button></div>
              {(alerts.data?.items??[]).slice(0,5).map(a=><div className={styles.alertRow} key={a.id}><span className={a.severity==='critical'||a.severity==='high'?styles.severityHigh:styles.severityMedium}>{a.severity}</span><div><strong>{a.title}</strong><p>{a.message}</p></div></div>)}
              {!alerts.data?.items.length&&<p className={styles.empty}>No alerts have been recorded. Alerts will appear when connected systems report issues.</p>}
            </article>
          </section>}

          {tab==='fleet'&&<section className={styles.stack}>
            <div className={styles.twoCol}>
              <article className={styles.panel}><h2>Register a mixer truck</h2><form onSubmit={addTruck} className={styles.formStack}>
                <label className={styles.field}>Truck / mixer number<input value={truckNumber} onChange={e=>setTruckNumber(e.currentTarget.value)} required maxLength={40} placeholder="Mixer 204"/></label>
                <label className={styles.field}>VIN (optional)<input value={truckVin} onChange={e=>setTruckVin(e.currentTarget.value)} maxLength={40} placeholder="Vehicle identification number"/></label>
                <label className={styles.field}>Home plant<select value={truckPlantId} onChange={e=>setTruckPlantId(e.currentTarget.value)}><option value="">Not assigned</option>{plantItems.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <button className={styles.primaryButton} disabled={!canWrite||Boolean(busy)}>Add truck</button>
              </form></article>
              <article className={styles.panel}><h2>Add a driver</h2><form onSubmit={addDriver} className={styles.formStack}>
                <label className={styles.field}>Employee / driver ID<input value={driverCode} onChange={e=>setDriverCode(e.currentTarget.value)} required maxLength={40} placeholder="DRV-001"/></label>
                <label className={styles.field}>Driver name<input value={driverName} onChange={e=>setDriverName(e.currentTarget.value)} required maxLength={180} placeholder="Driver name"/></label>
                <label className={styles.field}>Phone (optional)<input value={driverPhone} onChange={e=>setDriverPhone(e.currentTarget.value)} maxLength={40} placeholder="Phone number"/></label>
                <button className={styles.primaryButton} disabled={!canWrite||Boolean(busy)}>Add driver</button>
              </form></article>
            </div>
            <div className={styles.pagination}><button className={styles.button} disabled={driverOffset===0} onClick={()=>setDriverOffset(Math.max(0,driverOffset-200))}>Previous drivers</button><span>Drivers {driverOffset+1}–{Math.min(driverOffset+200,drivers.data?.total??0)} of {drivers.data?.total??0}</span><button className={styles.button} disabled={!drivers.data||driverOffset+200>=drivers.data.total} onClick={()=>setDriverOffset(driverOffset+200)}>Next drivers</button></div>
            <article className={styles.panel}><div className={styles.panelHeading}><div><h2>Live mixer fleet map</h2><p>Clustered GPS positions for large fleets. Select a truck marker to inspect its driver and latest telemetry.</p></div></div><ConcreteFleetMap vehicles={vehicles.data?.items??[]} drivers={drivers.data?.items??[]}/></article>
            <article className={styles.panel}><div className={styles.panelHeading}><div><h2>Fleet registry</h2><p>{vehicles.data?.total??0} registered trucks · showing {vehicles.data?.items.length??0} on this page</p></div><button className={styles.button} onClick={()=>void vehicles.refetch()}>Refresh</button></div>
              <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Truck</th><th>Driver</th><th>Movement</th><th>Speed</th><th>Fuel</th><th>Last report</th><th>Location</th><th>Gateway</th></tr></thead><tbody>
                {(vehicles.data?.items??[]).map(v=><tr key={v.id}>
                  <td><strong>{v.vehicleNumber}</strong><small>{v.telematicsProvider??'manual'} · {v.status}</small></td>
                  <td><select className={styles.inlineSelect} value={v.currentDriverId??''} onChange={e=>assignDriver(v.id,e.currentTarget.value)} disabled={!canWrite}><option value="">Unassigned</option>{(drivers.data?.items??[]).map(d=><option key={d.id} value={d.id}>{d.displayName}</option>)}</select></td>
                  <td><span className={freshState(v.lastSeenAt,v.lastSpeedMph)==='Moving'?styles.moving:freshState(v.lastSeenAt,v.lastSpeedMph)==='Stopped'?styles.stopped:styles.noSignal}>{freshState(v.lastSeenAt,v.lastSpeedMph)}</span></td>
                  <td>{numberText(v.lastSpeedMph,' mph')}</td><td>{numberText(v.fuelPercent,'%')}</td><td>{fmtDate(v.lastSeenAt)}</td>
                  <td>{v.lastLatitude!==undefined&&v.lastLatitude!==null?v.lastLatitude.toFixed(4)+', '+(v.lastLongitude?.toFixed(4)??'—'):'—'}</td>
                  <td><button className={styles.smallButton} disabled={!canManageIntegrations||Boolean(busy)} onClick={()=>createDeviceKey(v.id)}>Create key</button></td>
                </tr>)}
              </tbody></table></div>
              {!vehicles.data?.items.length&&<p className={styles.empty}>No trucks registered yet. Add a truck or connect a telematics provider to import fleet records.</p>}
              <div className={styles.pagination}><button className={styles.button} disabled={vehicleOffset===0} onClick={()=>setVehicleOffset(Math.max(0,vehicleOffset-200))}>Previous</button><span>{vehicleOffset+1}–{Math.min(vehicleOffset+200,vehicles.data?.total??0)} of {vehicles.data?.total??0}</span><button className={styles.button} disabled={!vehicles.data||vehicleOffset+200>=vehicles.data.total} onClick={()=>setVehicleOffset(vehicleOffset+200)}>Next</button></div>
            </article>
            <article className={styles.panel}><div className={styles.panelHeading}><div><h2>Concrete plants</h2><p>Plant registry used by batching and dispatch.</p></div></div>
              <form onSubmit={addPlant} className={styles.formRow}>
                <label className={styles.field}>Plant code<input value={plantCode} onChange={e=>setPlantCode(e.currentTarget.value)} required maxLength={40} placeholder="PLANT-01"/></label>
                <label className={styles.field}>Plant name<input value={plantName} onChange={e=>setPlantName(e.currentTarget.value)} required maxLength={180} placeholder="Lewisville Plant"/></label>
                <label className={styles.field}>City<input value={plantCity} onChange={e=>setPlantCity(e.currentTarget.value)} maxLength={100} placeholder="Lewisville"/></label>
                <button className={styles.primaryButton} disabled={!canWrite||Boolean(busy)}>Add plant</button>
              </form>
              <div className={styles.chips}>{plantItems.map(p=><span key={p.id}>{p.code} · {p.name}{p.city?' · '+p.city:''}</span>)}</div>
            </article>
            {oneTimeKey&&<article className={styles.keyPanel}><h2>Truck gateway key — shown once</h2><p>Install this token only in the gateway assigned to this truck. Do not share it with drivers or put it in a public ticket.</p><code>{oneTimeKey}</code><button className={styles.button} onClick={()=>void navigator.clipboard?.writeText(oneTimeKey)}>Copy key</button><button className={styles.button} onClick={()=>setOneTimeKey('')}>Close</button></article>}
          </section>}

          {tab==='dispatch'&&<section className={styles.stack}>
            <article className={styles.panel}><h2>Schedule a concrete delivery</h2><p>Create a ticket, assign a plant, mixer and driver, and track its lifecycle from batching to completed pour.</p>
              <form onSubmit={addDelivery} className={styles.formGrid}>
                <label className={styles.field}>Ticket number<input value={ticketNumber} onChange={e=>setTicketNumber(e.currentTarget.value)} required maxLength={80}/></label>
                <label className={styles.field}>Customer / contractor<input value={customerName} onChange={e=>setCustomerName(e.currentTarget.value)} maxLength={180}/></label>
                <label className={styles.field}>Jobsite / project<input value={jobName} onChange={e=>setJobName(e.currentTarget.value)} required maxLength={180}/></label>
                <label className={styles.field}>Jobsite address<input value={jobAddress} onChange={e=>setJobAddress(e.currentTarget.value)} maxLength={300}/></label>
                <label className={styles.field}>Mix code<input value={mixCode} onChange={e=>setMixCode(e.currentTarget.value)} maxLength={80} placeholder="e.g. 4000 PSI"/></label>
                <label className={styles.field}>Scheduled pour time<input type="datetime-local" value={scheduledAt} onChange={e=>setScheduledAt(e.currentTarget.value)}/></label>
                <label className={styles.field}>Ordered concrete (yd³)<input type="number" min="0.01" max="1000" step="0.01" value={orderedYards} onChange={e=>setOrderedYards(e.currentTarget.value)} required/></label>
                <label className={styles.field}>Batch plant<select value={deliveryPlantId} onChange={e=>setDeliveryPlantId(e.currentTarget.value)} required><option value="">Select plant</option>{plantItems.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className={styles.field}>Mixer truck<select value={deliveryVehicleId} onChange={e=>setDeliveryVehicleId(e.currentTarget.value)}><option value="">Unassigned</option>{(vehicles.data?.items??[]).map(v=><option key={v.id} value={v.id}>{v.vehicleNumber}</option>)}</select></label>
                <label className={styles.field}>Driver<select value={deliveryDriverId} onChange={e=>setDeliveryDriverId(e.currentTarget.value)}><option value="">Unassigned</option>{(drivers.data?.items??[]).map(d=><option key={d.id} value={d.id}>{d.displayName}</option>)}</select></label>
                <button className={styles.primaryButton} disabled={!canWrite||Boolean(busy)||plantItems.length===0}>Create delivery</button>
              </form>
            </article>
            <article className={styles.panel}><h2>Delivery board</h2><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Ticket</th><th>Jobsite</th><th>Quantity</th><th>Status</th><th>Scheduled</th></tr></thead><tbody>
              {(deliveries.data?.items??[]).map(d=><tr key={d.id}><td><strong>{d.ticketNumber}</strong><small>{d.customerName||'Customer not entered'}</small></td><td>{d.jobName}</td><td>{numberText(d.orderedYards,' yd³')}</td><td><select className={styles.inlineSelect} value={d.status} onChange={e=>updateDeliveryStatus(d.id,e.currentTarget.value)} disabled={!canWrite||Boolean(busy)}><option value={d.status}>{d.status.replaceAll('_',' ')}</option>{(DELIVERY_NEXT[d.status]??[]).map(next=><option key={next} value={next}>{next.replaceAll('_',' ')}</option>)}</select></td><td>{fmtDate(d.scheduledAt)}</td></tr>)}
            </tbody></table></div>{!deliveries.data?.items.length&&<p className={styles.empty}>No deliveries have been scheduled yet.</p>}</article>
          </section>}

          {tab==='quality'&&<section className={styles.stack}>
            <div className={styles.twoCol}>
              <article className={styles.panel}><h2>Record concrete quality test</h2><p>Attach each measurement to its delivery ticket to preserve batch-to-job traceability.</p>
                <form onSubmit={addQuality} className={styles.formStack}>
                  <label className={styles.field}>Delivery ticket<select value={qualityDeliveryId} onChange={e=>setQualityDeliveryId(e.currentTarget.value)} required><option value="">Select delivery</option>{(deliveries.data?.items??[]).map(d=><option key={d.id} value={d.id}>{d.ticketNumber} · {d.jobName}</option>)}</select></label>
                  <label className={styles.field}>Test / observation<select value={qualityType} onChange={e=>setQualityType(e.currentTarget.value)}><option value="slump">Slump</option><option value="concrete_temperature">Concrete temperature</option><option value="air_content">Air content</option><option value="unit_weight">Unit weight</option><option value="cylinder_break_7d">7-day cylinder break</option><option value="cylinder_break_28d">28-day cylinder break</option><option value="water_added">Water added</option><option value="visual">Visual observation</option></select></label>
                  <label className={styles.field}>Measured value<input type="number" step="0.001" value={qualityValue} onChange={e=>setQualityValue(e.currentTarget.value)} required/></label>
                  <label className={styles.field}>Unit<input value={qualityUnit} onChange={e=>setQualityUnit(e.currentTarget.value)} required maxLength={30}/></label>
                  <label className={styles.field}>Result<select value={qualityResult} onChange={e=>setQualityResult(e.currentTarget.value)}><option value="recorded">Recorded</option><option value="pass">Pass</option><option value="warning">Warning</option><option value="fail">Fail</option></select></label>
                  <label className={styles.field}>Notes<input value={qualityNotes} onChange={e=>setQualityNotes(e.currentTarget.value)} maxLength={1000}/></label>
                  <button className={styles.primaryButton} disabled={!canWrite||Boolean(busy)||!qualityDeliveryId}>Save quality observation</button>
                </form>
              </article>
              <article className={styles.panel}><h2>Create maintenance work order</h2><p>Track service work against a specific mixer and retain due dates and status.</p>
                <form onSubmit={addMaintenance} className={styles.formStack}>
                  <label className={styles.field}>Truck<select value={maintenanceVehicleId} onChange={e=>setMaintenanceVehicleId(e.currentTarget.value)} required><option value="">Select truck</option>{(vehicles.data?.items??[]).map(v=><option key={v.id} value={v.id}>{v.vehicleNumber}</option>)}</select></label>
                  <label className={styles.field}>Work order number<input value={maintenanceNumber} onChange={e=>setMaintenanceNumber(e.currentTarget.value)} required maxLength={80}/></label>
                  <label className={styles.field}>Category<select value={maintenanceCategory} onChange={e=>setMaintenanceCategory(e.currentTarget.value)}><option value="engine">Engine</option><option value="transmission">Transmission</option><option value="hydraulic">Hydraulic</option><option value="drum">Drum</option><option value="tires">Tires</option><option value="brakes">Brakes</option><option value="electrical">Electrical</option><option value="sensor">Sensor</option><option value="other">Other</option></select></label>
                  <label className={styles.field}>Priority<select value={maintenancePriority} onChange={e=>setMaintenancePriority(e.currentTarget.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
                  <label className={styles.field}>Description<input value={maintenanceDescription} onChange={e=>setMaintenanceDescription(e.currentTarget.value)} required maxLength={2000}/></label>
                  <label className={styles.field}>Due date<input type="datetime-local" value={maintenanceDueAt} onChange={e=>setMaintenanceDueAt(e.currentTarget.value)}/></label>
                  <button className={styles.primaryButton} disabled={!canWrite||Boolean(busy)||!maintenanceVehicleId}>Create work order</button>
                </form>
              </article>
            </div>
            <article className={styles.panel}><h2>Quality history</h2>
              {(quality.data?.items??[]).map(q=><div className={styles.alertRow} key={q.id}><span className={styles.status}>{q.result}</span><div className={styles.alertBody}><strong>{q.observationType.replaceAll('_',' ')} · {numberText(q.measuredValue,' '+q.unit)}</strong><p>{q.notes||'No notes entered.'}</p><small>{fmtDate(q.observedAt)} · Delivery {q.deliveryId}</small></div></div>)}
              {!quality.data?.items.length&&<p className={styles.empty}>No quality observations recorded yet.</p>}
            </article>
            <article className={styles.panel}><h2>Maintenance work orders</h2>
              {(maintenance.data?.items??[]).map(m=><div className={styles.integrationRow} key={m.id}><div><strong>{m.workOrderNumber} · {m.category}</strong><p>{m.description}</p><small>{m.priority} priority · due {fmtDate(m.dueAt)}</small></div><select className={styles.inlineSelect} value={m.status} onChange={e=>updateMaintenanceStatus(m.id,e.currentTarget.value)} disabled={!canWrite||Boolean(busy)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></div>)}
              {!maintenance.data?.items.length&&<p className={styles.empty}>No maintenance work orders recorded.</p>}
            </article>
            <article className={styles.panel}><h2>Operational alerts</h2>
              {(alerts.data?.items??[]).map(a=><div className={styles.alertRow} key={a.id}><span className={a.severity==='critical'||a.severity==='high'?styles.severityHigh:styles.severityMedium}>{a.severity}</span><div className={styles.alertBody}><strong>{a.title}</strong><p>{a.message}</p><small>{fmtDate(a.detectedAt)}</small></div>{a.status==='open'&&canWrite&&<button className={styles.smallButton} onClick={()=>acknowledge(a.id)} disabled={Boolean(busy)}>Acknowledge</button>}</div>)}
              {!alerts.data?.items.length&&<p className={styles.empty}>No alerts recorded.</p>}
            </article>
          </section>

          {tab==='integrations'&&<section className={styles.stack}>
            <article className={styles.panel}><h2>Connect fleet, dispatch and concrete systems</h2><p>Use the provider your company already operates. Credentials are encrypted server-side; raw API tokens are never returned to the browser after saving.</p>
              <form onSubmit={addIntegration} className={styles.formGrid}>
                <label className={styles.field}>Provider<select value={provider} onChange={e=>setProvider(e.currentTarget.value)}>{(providers.data?.items??[]).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                <label className={styles.field}>Connection label<input value={integrationLabel} onChange={e=>setIntegrationLabel(e.currentTarget.value)} required maxLength={120}/></label>
                {provider==='samsara'&&<label className={styles.field}>Samsara API token<input type="password" autoComplete="off" value={apiToken} onChange={e=>setApiToken(e.currentTarget.value)} placeholder="Paste a read-only API token"/></label>}
                <button className={styles.primaryButton} disabled={!canManageIntegrations||Boolean(busy)}>Register connection</button>
              </form>
            </article>
            <div className={styles.providerGrid}>{(providers.data?.items??[]).map(p=><article className={styles.providerCard} key={p.id}><div className={styles.providerTop}><strong>{p.name}</strong><span className={styles.status}>{p.category}</span></div><p>{p.capabilities.join(' · ')}</p><small>{p.state==='supported'?'API adapter available':p.state==='native_gateway'?'Native device-key gateway':'Vendor API access / adapter setup required'}</small>{p.docs&&<a href={p.docs} target="_blank" rel="noreferrer">Provider documentation ↗</a>}</article>)}</div>
            <article className={styles.panel}><h2>Company connections</h2>
              {(integrations.data?.items??[]).map(i=><div className={styles.integrationRow} key={i.id}><div><strong>{i.label}</strong><p>{PROVIDER_LABELS[i.provider]??i.provider} · {i.status.replaceAll('_',' ')}</p>{i.lastSyncAt&&<small>Last sync: {fmtDate(i.lastSyncAt)}</small>}{i.lastError&&<small className={styles.error}>{i.lastError}</small>}</div>
                <div className={styles.actions}>{i.provider==='samsara'&&<><button className={styles.smallButton} onClick={()=>testIntegration(i.id)} disabled={!canManageIntegrations||Boolean(busy)}>Test</button><button className={styles.smallButton} onClick={()=>syncIntegration(i.id)} disabled={!canManageIntegrations||i.status!=='connected'||Boolean(busy)}>Sync fleet</button></>}</div>
              </div>)}
              {!integrations.data?.items.length&&<p className={styles.empty}>No external systems connected yet.</p>}
            </article>
            <article className={styles.infoCard}><strong>Truck hardware connection</strong><p>Each truck can receive a unique device key. A compatible cellular gateway can read GPS, approved read-only J1939/CAN diagnostics, drum RPM/direction, water-meter pulses and concrete temperature, then post signed, idempotent telemetry batches to Curb Connect.</p><p>Never connect Curb Connect hardware to write vehicle-control commands. Hardware installation and sensor calibration must be approved by the vehicle/equipment manufacturer and fleet maintenance team.</p></article>
          </section>}

          {tab==='insights'&&<section className={styles.stack}><article className={styles.panel}><div className={styles.panelHeading}><div><h2>AI operations insights</h2><p>Operational recommendations generated from recorded fleet and delivery data.</p></div><button className={styles.button} onClick={()=>void insights.refetch()}>Refresh insights</button></div>
            {(insights.data?.insights??[]).map(item=><div className={styles.alertRow} key={item.id}><span className={item.severity==='high'?styles.severityHigh:styles.severityMedium}>{item.severity}</span><div><strong>{item.title}</strong><p>{item.message}</p><small>Recommended action: {item.action}</small></div></div>)}
            {!insights.isPending&&!insights.data?.insights.length&&<p className={styles.empty}>No rule-based issues detected in the current data. More connected vehicles and operational history improve insight coverage.</p>}
            {insights.data&&<p className={styles.disclaimer}>{insights.data.disclaimer}</p>}
          </article></section>}
        </>
      )}
      <footer className={styles.footer}>Curb Connect · Concrete Company · Tenant-isolated operational workspace · {activeTab}</footer>
    </main>
  );
}

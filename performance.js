const PERF_KEY='parcelles:performance:v1';
const MAX_SESSIONS=25;

function now(){return performance?.now?.()??Date.now();}
function safeRead(){try{const v=JSON.parse(localStorage.getItem(PERF_KEY)||'[]');return Array.isArray(v)?v:[];}catch{return[];}}
function safeWrite(rows){try{localStorage.setItem(PERF_KEY,JSON.stringify(rows.slice(0,MAX_SESSIONS)));}catch{}}

export function idleTask(fn,{timeout=1500}={}){
  if('requestIdleCallback'in window)return requestIdleCallback(()=>Promise.resolve().then(fn).catch(console.warn),{timeout});
  return setTimeout(()=>Promise.resolve().then(fn).catch(console.warn),Math.min(timeout,250));
}

export function cancelIdleTask(id){
  if('cancelIdleCallback'in window){try{cancelIdleCallback(id);return;}catch{}}
  clearTimeout(id);
}

export class PerformanceMonitor{
  constructor(buildId){
    this.buildId=buildId;
    this.startedAt=Date.now();
    this.startedPerf=now();
    this.marks={boot:0};
    this.longTasks=[];
    this.observer=null;
  }
  mark(name){this.marks[name]=Math.max(0,Math.round(now()-this.startedPerf));return this.marks[name];}
  startLongTaskObserver(){
    if(!('PerformanceObserver'in window))return;
    try{
      this.observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries()){
          this.longTasks.push({name:entry.name||'longtask',start:Math.round(entry.startTime),duration:Math.round(entry.duration)});
          if(this.longTasks.length>25)this.longTasks.shift();
        }
      });
      this.observer.observe({entryTypes:['longtask']});
    }catch{}
  }
  finish(extra={}){
    this.mark('ready');
    const nav=performance?.getEntriesByType?.('navigation')?.[0];
    const record={
      buildId:this.buildId,
      createdAt:Date.now(),
      marks:{...this.marks},
      readyMs:this.marks.ready,
      domContentLoadedMs:nav?Math.round(nav.domContentLoadedEventEnd):null,
      loadMs:nav?Math.round(nav.loadEventEnd):null,
      transferSize:nav?.transferSize||null,
      longTasks:this.longTasks.slice(-10),
      ...extra
    };
    safeWrite([record,...safeRead()]);
    return record;
  }
  snapshot(){return {buildId:this.buildId,startedAt:this.startedAt,marks:{...this.marks},longTasks:[...this.longTasks]};}
}

export function performanceHistory(){return safeRead();}
export function clearPerformanceHistory(){try{localStorage.removeItem(PERF_KEY);}catch{}}

export function resourceTimingSummary(){
  const rows=performance?.getEntriesByType?.('resource')||[];
  const normalized=rows.map(entry=>({
    name:String(entry.name||'').split('?')[0],
    duration:Math.round(entry.duration||0),
    transferSize:entry.transferSize||0,
    decodedBodySize:entry.decodedBodySize||0,
    initiatorType:entry.initiatorType||''
  })).sort((a,b)=>b.duration-a.duration);
  return {
    count:normalized.length,
    totalTransfer:normalized.reduce((sum,row)=>sum+(row.transferSize||0),0),
    slowest:normalized.slice(0,12)
  };
}

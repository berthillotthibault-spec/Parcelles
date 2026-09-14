const ERROR_KEY='parcelles:diagnostic-errors:v1';
const MAX_ERRORS=100;

function safeParse(value,fallback=[]){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:fallback;}catch{return fallback;}}
function sanitize(value,max=1200){const text=String(value??'').replace(/[\r\n]+/g,' ').trim();return text.length>max?`${text.slice(0,max)}…`:text;}

export function getRecordedErrors(){
  try{return safeParse(localStorage.getItem(ERROR_KEY),[]);}catch{return[];}
}

export function clearRecordedErrors(){
  try{localStorage.removeItem(ERROR_KEY);}catch{}
}

export function recordDiagnosticError(error={}){
  try{
    const rows=getRecordedErrors();
    const entry={
      id:`err_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      createdAt:Date.now(),
      buildId:sanitize(error.buildId||'',120),
      source:sanitize(error.source||'runtime',120),
      message:sanitize(error.message||'Erreur inconnue',500),
      stack:sanitize(error.stack||'',1800),
      filename:sanitize(error.filename||'',260),
      line:Number(error.line)||null,
      column:Number(error.column)||null
    };
    rows.unshift(entry);
    localStorage.setItem(ERROR_KEY,JSON.stringify(rows.slice(0,MAX_ERRORS)));
    return entry;
  }catch{return null;}
}

export function installErrorRecorder({buildId=''}={}){
  if(globalThis.__parcellesErrorRecorderInstalled)return;
  globalThis.__parcellesErrorRecorderInstalled=true;
  window.addEventListener('error',event=>recordDiagnosticError({
    buildId,source:'window.error',message:event.message,stack:event.error?.stack,
    filename:event.filename,line:event.lineno,column:event.colno
  }));
  window.addEventListener('unhandledrejection',event=>{
    const reason=event.reason;
    recordDiagnosticError({buildId,source:'unhandledrejection',message:reason?.message||reason,stack:reason?.stack});
  });
}

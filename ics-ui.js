// Agenda du téléphone (n° 17) : « Ajouter à mon agenda », export « Mes 30 prochains jours » (.ics avec alarmes)
// et rappels en arrière-plan par Periodic Background Sync quand le navigateur le permet.
import {buildCalendar,upcomingEvents,itemEvent,icsFileName,ICS_NOTICE} from './ics.js';
import {download,localDate} from './utils.js';

export const REMINDER_TAG='parcelles-rappels';
const TWELVE_HOURS=12*60*60*1000;
const ICS_TYPE='text/calendar;charset=utf-8';

export async function periodicReminderStatus(){
  try{
    if(!('serviceWorker'in navigator))return 'unsupported';
    const registration=await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
    if(!registration||!('periodicSync'in registration))return 'unsupported';
    const tags=await registration.periodicSync.getTags().catch(()=>[]);
    return tags.includes(REMINDER_TAG)?'active':'available';
  }catch{return 'unsupported';}
}

// Inscription silencieuse : seulement si la fonctionnalité existe, que les notifications sont permises
// et que le navigateur accorde la synchronisation périodique (application installée sur Android).
export async function registerPeriodicReminders({enabled=true}={}){
  try{
    if(!('serviceWorker'in navigator)||!('Notification'in window))return 'unsupported';
    const registration=await Promise.race([navigator.serviceWorker.ready,new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);
    if(!registration||!('periodicSync'in registration))return 'unsupported';
    if(!enabled){await registration.periodicSync.unregister(REMINDER_TAG).catch(()=>{});return 'disabled';}
    if(Notification.permission!=='granted')return 'no-permission';
    const permission=await navigator.permissions?.query({name:'periodic-background-sync'}).catch(()=>null);
    if(permission&&permission.state!=='granted')return 'denied';
    await registration.periodicSync.register(REMINDER_TAG,{minInterval:TWELVE_HOURS});
    return 'active';
  }catch(error){console.warn('[Parcelles] rappels en arrière-plan non inscrits.',error);return 'error';}
}

export function createIcsUI({store,state,modal,closeModal,toast,escapeHtml}){
  const parcelName=id=>(state().parcelles||[]).find(p=>p.id===id)?.nom||'';

  function addToAgenda(kind,id){
    const item=store.get(kind==='task'?'tasks':'interventions',id);
    if(!item)return;
    const event=itemEvent(item,kind,{parcelName:parcelName(item.parcelId||(item.parcelIds||[])[0])});
    if(!event){toast('Ajoutez d’abord une date pour l’envoyer à l’agenda.','warning');return;}
    download(icsFileName(`${kind==='task'?'tache':'travail'}-${event.summary}`),buildCalendar([event]),ICS_TYPE);
    toast('Fichier agenda téléchargé : ouvrez-le pour l’ajouter. Une modification ultérieure ne sera pas répercutée.','success');
  }

  function exportUpcoming(){
    const events=upcomingEvents(state(),{days:30});
    if(!events.length){toast('Rien de prévu dans les 30 prochains jours.','info');return;}
    download(`parcelles-30-jours-${new Date().toISOString().slice(0,10)}.ics`,buildCalendar(events,{name:'Parcelles · 30 jours'}),ICS_TYPE);
    toast(`${events.length} rappel${events.length>1?'s':''} exporté${events.length>1?'s':''}. Réimportez le fichier après une modification.`,'success');
  }

  async function openAgenda(){
    const events=upcomingEvents(state(),{days:30}),status=await periodicReminderStatus();
    const rows=events.slice(0,8).map(e=>`<li><strong>${escapeHtml(localDate(e.day))}${e.start?` · ${escapeHtml(e.start)}`:''}</strong> ${escapeHtml(e.summary)}</li>`).join('');
    const background=status==='unsupported'?'<p class="form-note">Rappels en arrière-plan : non disponibles sur cet appareil. Le fichier agenda reste la solution la plus sûre.</p>'
      :`<p class="form-note">Rappels en arrière-plan : ${status==='active'?'activés (vérification toutes les 12 h environ).':'possibles quand l’application est installée et les notifications autorisées.'}</p>${status==='active'?'':'<button type="button" class="button secondary" data-action="ics-enable-reminders">Activer les rappels en arrière-plan</button>'}`;
    modal('Mes 30 prochains jours','Travaux et tâches à faire, avec une alarme, à importer dans l’agenda du téléphone.',
      `<div class="ics-agenda">${events.length?`<p><strong>${events.length}</strong> rendez-vous dans le fichier.</p><ul class="ics-agenda-list">${rows}</ul>${events.length>8?`<p class="form-note">et ${events.length-8} autre${events.length-8>1?'s':''}.</p>`:''}`:'<div class="empty-state">Rien de prévu dans les 30 prochains jours.</div>'}<p class="form-note">${escapeHtml(ICS_NOTICE)}</p>${background}</div>`,
      `<button class="button secondary" data-action="close-modal">Fermer</button>${events.length?'<button class="button primary" data-action="ics-export-30">Télécharger le .ics</button>':''}`,'small');
  }

  async function enableReminders(){
    if(!('Notification'in window)){toast('Notifications non disponibles sur ce navigateur.','warning');return;}
    const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission().catch(()=>Notification.permission);
    if(permission!=='granted'){toast('Notifications refusées : les rappels en arrière-plan restent désactivés.','warning');return;}
    const result=await registerPeriodicReminders();
    if(result==='active'){toast('Rappels en arrière-plan activés.','success');closeModal?.();}
    else toast('Le navigateur n’autorise pas encore les rappels en arrière-plan. Installez l’application puis réessayez.','warning');
  }

  return {addToAgenda,exportUpcoming,openAgenda,enableReminders};
}

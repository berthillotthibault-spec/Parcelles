const PATHS={
  home:['M3 10.5 12 3l9 7.5','M5 9.8V21h14V9.8','M9 21v-7h6v7'],
  map:['M4 6.5 9 4l6 2.5L20 4v13.5L15 20l-6-2.5L4 20z','M9 4v13.5','M15 6.5V20'],
  parcels:['M6 4h12l2 5-2 11H6L4 9z','M4 9h16','M9 4v16','M15 4v16'],
  work:['M9 11l2 2 4-5','M5 4h14v16H5z','M8 7h6'],
  more:['M6 12h.01','M12 12h.01','M18 12h.01'],
  share:['M15 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0','M3 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0','M15 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0','M8.6 13.5l6.8 4','M15.4 6.5l-6.8 4'],
  search:['M21 21l-4.3-4.3','M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4z'],
  bell:['M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9','M10 21h4'],
  plus:['M12 5v14','M5 12h14'],
  chevron:['M9 18l6-6-6-6'],
  back:['M15 18l-6-6 6-6'],
  layers:['M12 2 3 7l9 5 9-5z','M3 12l9 5 9-5','M3 17l9 5 9-5'],
  locate:['M12 2v3','M12 19v3','M2 12h3','M19 12h3','M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'],
  tools:['M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3z'],
  filter:['M4 5h16','M7 12h10','M10 19h4'],
  star:['M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z'],
  route:['M4 6h7a4 4 0 0 1 4 4v0a4 4 0 0 0 4 4h1','M17 11l3 3-3 3','M4 6l2-2','M4 6l2 2'],
  camera:['M4 7h4l2-2h4l2 2h4v12H4z','M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  alert:['M12 3 2.8 20h18.4z','M12 9v5','M12 17h.01'],
  tractor:['M4 15h7l2-7h4l2 4h2v3','M7 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z','M18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  package:['M4 7l8-4 8 4-8 4z','M4 7v10l8 4 8-4V7','M12 11v10'],
  wallet:['M4 6h14a2 2 0 0 1 2 2v10H4z','M4 6V5a2 2 0 0 1 2-2h10v3','M15 12h5'],
  files:['M6 3h9l3 3v15H6z','M15 3v4h4','M9 12h6','M9 16h6'],
  calendar:['M5 5h14v16H5z','M8 3v4','M16 3v4','M5 9h14'],
  weather:['M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3 3 0 0 0 7 18z'],
  sparkles:['M12 2l1.3 3.7L17 7l-3.7 1.3L12 12l-1.3-3.7L7 7l3.7-1.3z','M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z','M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8z'],
  automation:['M13 2 5 14h6l-1 8 9-13h-6z'],
  users:['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
  database:['M4 6c0-2 16-2 16 0s-16 2-16 0','M4 6v12c0 2 16 2 16 0V6','M4 12c0 2 16 2 16 0'],
  settings:['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z','M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.1 3.6-.2-.1a1.8 1.8 0 0 0-2.1-.3l-.8.4a1.8 1.8 0 0 0-1 1.6v.2H9.3v-.2a1.8 1.8 0 0 0-1-1.6l-.8-.4a1.8 1.8 0 0 0-2.1.3l-.2.1-2.1-3.6.1-.1a1.8 1.8 0 0 0 .4-2l-.3-.9a1.8 1.8 0 0 0-1.5-1.2h-.2V8.7h.2a1.8 1.8 0 0 0 1.5-1.2l.3-.9a1.8 1.8 0 0 0-.4-2l-.1-.1L5.2.9l.2.1a1.8 1.8 0 0 0 2.1.3l.8-.4a1.8 1.8 0 0 0 1-1.6V-.9h4.2v.2a1.8 1.8 0 0 0 1 1.6l.8.4a1.8 1.8 0 0 0 2.1-.3l.2-.1 2.1 3.6-.1.1a1.8 1.8 0 0 0-.4 2l.3.9a1.8 1.8 0 0 0 1.5 1.2h.2v4.2h-.2a1.8 1.8 0 0 0-1.5 1.2z'],
  help:['M9.5 9a2.8 2.8 0 1 1 4.8 2c-1.3 1.2-2.3 1.7-2.3 3','M12 18h.01','M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  production:['M12 21V10','M8 14c-3.5 0-5-2-5-5 3.5 0 5 2 5 5z','M16 10c3.5 0 5-2 5-5-3.5 0-5 2-5 5z'],
  management:['M4 4h16v16H4z','M8 8h8','M8 12h8','M8 16h5'],
  plan:['M4 5h16v16H4z','M8 3v4','M16 3v4','M4 10h16','M8 14h3','M13 14h3','M8 18h3'],
  account:['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z','M4 21a8 8 0 0 1 16 0'],
  sun:['M12 3v2','M12 19v2','M3 12h2','M19 12h2','M5.6 5.6 7 7','M17 17l1.4 1.4','M18.4 5.6 17 7','M7 17l-1.4 1.4','M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  mic:['M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z','M5 11a7 7 0 0 0 14 0','M12 18v3','M9 21h6'],
  entry:['M4 4h10v16H4z','M9 12h11','M17 9l3 3-3 3'],
  close:['M6 6l12 12','M18 6 6 18'],
  ellipsis:['M6 12h.01','M12 12h.01','M18 12h.01']
};

export function icon(name,{size=20,className='ui-icon',label=''}={}){
  const paths=PATHS[name]||PATHS.more;
  const title=label?`<title>${String(label).replace(/[<&]/g,'')}</title>`:'';
  return `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="${label?'false':'true'}" focusable="false">${title}${paths.map(d=>`<path d="${d}"/>`).join('')}</svg>`;
}

// n° 35 : états vides illustrés. Petits dessins au trait (viewBox 64) colorés par currentColor, comme les icônes.
const ART={
  tractor:['M6 54h52','M32 42a10 10 0 1 0 20 0a10 10 0 1 0-20 0','M40 42a2 2 0 1 0 4 0a2 2 0 1 0-4 0','M12 46a6 6 0 1 0 12 0a6 6 0 1 0-12 0','M10 42V32h24','M34 32V16h14v18','M38 20h6v8','M16 32v-7','M24 46h8'],
  fence:['M6 52h52','M12 52V24l3-4 3 4v28','M30 52V24l3-4 3 4v28','M48 52V24l3-4 3 4v28','M18 30h12','M36 30h12','M18 42h12','M36 42h12','M24 52l1-4 2 4','M42 52l1-4 2 4'],
  cow:['M6 54h52','M14 32h26c5 0 8 3 8 8v4H14z','M4 26h10v12c0 2-1 3-3 3H7c-2 0-3-1-3-3z','M5 26l-2-4','M13 26l2-4','M7 33h.01','M11 33h.01','M18 44v8','M24 44v8','M38 44v8','M44 44v8','M48 36c4 1 5 5 4 10','M26 32c1 5 9 5 10 0','M30 44c0 3 4 3 4 0'],
  furrow:['M6 54 20 28h24l14 26z','M26 28l-6 26','M32 28v26','M38 28l6 26','M13 41h38','M32 26V14','M32 17c-5 0-8-3-8-7 5 0 8 3 8 7z','M32 17c5 0 8-3 8-7-5 0-8 3-8 7z'],
  cloud:['M18 48h28a9 9 0 0 0 0-18 13 13 0 0 0-25 4 7 7 0 0 0-3 14z','M46 8v3','M56 13l-2 2','M60 23h-3','M36 13l2 2','M40 25a7 7 0 0 1 12-6'],
  box:['M10 22 32 12l22 10-22 10z','M10 22v22l22 10 22-10V22','M32 32v22','M21 17l22 10v8','M16 40l6 3'],
  check:['M32 54a22 22 0 1 0 0-44 22 22 0 0 0 0 44z','M22 32l7 7 13-14'],
  search:['M28 42a14 14 0 1 0 0-28 14 14 0 0 0 0 28z','M38 38l14 14','M22 28h12']
};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const EMPTY_ART_NAMES=Object.freeze(Object.keys(ART));
export function emptyArt(name,size=64){
  const paths=ART[name]||ART.furrow;
  return `<svg class="empty-art" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths.map(d=>`<path d="${d}"/>`).join('')}</svg>`;
}
// Bouton d'action : {label, action, id, view, primary, write=true, attrs}. write : masqué au rôle lecture seule (CSS).
function emptyButton(a,compact){
  const attrs=Object.entries({'data-action':a.action,'data-id':a.id,'data-view':a.view,...(a.attrs||{})}).filter(([,v])=>v!==undefined&&v!==null&&v!==false).map(([k,v])=>` ${esc(k)}="${esc(v)}"`).join('');
  const cls=compact?'text-button':a.primary===false?'button secondary':'button primary';
  return `<button type="button" class="${cls} empty-action${a.write===false?'':' empty-write'}"${attrs}>${esc(a.label)}</button>`;
}
// emptyState({icon, title, text, action, compact}) : action peut être un objet ou une liste (la première est mise en avant).
// compact : une seule ligne avec un petit dessin, pour les blocs secondaires de l'accueil.
export function emptyState({icon='furrow',title='',text='',action=null,compact=false,className=''}={}){
  const actions=(Array.isArray(action)?action:action?[action]:[]).filter(a=>a&&a.label);
  const body=`${title?`<strong class="empty-title">${esc(title)}</strong>`:''}${text?`<span class="empty-text">${esc(text)}</span>`:''}`;
  const buttons=actions.length?`<span class="empty-actions">${actions.map((a,i)=>emptyButton(i?{primary:false,...a}:a,compact)).join('')}</span>`:'';
  return `<div class="empty-state empty-rich${compact?' is-compact':''}${className?` ${esc(className)}`:''}">${emptyArt(icon,compact?28:64)}<span class="empty-copy">${body}</span>${buttons}</div>`;
}

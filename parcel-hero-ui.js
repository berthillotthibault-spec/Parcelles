// n° 29 - Silhouette de parcelle dans la liste et en-tête « héros » de la fiche.
import {cachedSilhouette,rotationFrieze} from './parcel-silhouette.js';
import {escapeHtml as e,campaignFor} from './utils.js';

export function createParcelHeroUI({cultureAccent}){
  // Avatar de ligne : silhouette réelle colorée par la culture, initiales à défaut de contour.
  function avatar(p,initials){
    const color=cultureAccent(p.culture),d=cachedSilhouette(p,44);
    if(!d)return `<span class="crop-dot" style="background:${color}" aria-hidden="true">${e(initials)}</span>`;
    return `<span class="crop-dot has-shape" style="--shape:${color}" aria-hidden="true"><svg viewBox="0 0 44 44" width="44" height="44" focusable="false"><path d="${d}"/></svg></span>`;
  }
  // En-tête de fiche : grande silhouette et frise de rotation, autour du titre et du sous-titre existants.
  function mount(hero,p,data){
    if(!hero||!p)return;
    const d=cachedSilhouette(p,120);let shape=hero.querySelector('.hero-shape');
    if(d){if(!shape){shape=document.createElement('div');shape.className='hero-shape';shape.setAttribute('aria-hidden','true');hero.prepend(shape);}shape.innerHTML=`<svg viewBox="0 0 120 120" focusable="false"><path d="${d}"/></svg>`;}
    else shape?.remove();
    hero.classList.toggle('has-shape',Boolean(d));
    const frieze=rotationFrieze(p,(data?.rotations||[]),campaignFor(),3);
    let row=hero.querySelector('.hero-rotation');if(!row){row=document.createElement('ol');row.className='hero-rotation';row.setAttribute('aria-label','Rotation sur trois campagnes');hero.append(row);}
    row.innerHTML=frieze.map(c=>`<li class="${c.current?'is-current':''}${c.culture?'':' is-empty'}" style="--rot:${c.culture?cultureAccent(c.culture):'transparent'}"><small>${e(c.campaignId)}</small><strong>${e(c.culture||'Non renseignée')}</strong></li>`).join('');
  }
  return{avatar,mount};
}

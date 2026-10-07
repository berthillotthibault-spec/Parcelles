import {HOME_CARDS,HOME_SHORTCUTS,HOME_PRESETS,normalizePersonalization,moveHomeCard} from './personalization.js';

export function openPersonalization({preferences,modal,closeModal,save,toast}){
  let draft=normalizePersonalization(preferences);
  modal('Personnaliser mon espace','Un accueil adapté à votre façon de travailler.',`
    <form id="personalization-form" class="personalization-form">
      <fieldset><legend>Un point de départ</legend><p class="form-note">Choisissez un profil, puis ajustez chaque élément.</p><div class="personalization-presets">${Object.entries(HOME_PRESETS).map(([id,preset])=>`<button type="button" class="button secondary" data-preset="${id}">${preset.label}</button>`).join('')}</div></fieldset>
      <div class="home-preview" aria-label="Aperçu de votre accueil"><span class="eyebrow">Votre accueil</span><div id="home-preview-content" aria-live="polite"></div></div>
      <fieldset><legend>En haut de l’accueil</legend><label class="personalization-toggle"><input type="checkbox" name="homeNextAction">Prochaine action à réaliser</label><label class="personalization-toggle"><input type="checkbox" name="homeSummary">Repères : surface, parcelles et travaux</label></fieldset>
      <fieldset><legend>Blocs de l’accueil</legend><p class="form-note">Cochez les blocs à afficher. Les flèches changent leur ordre.</p><div id="home-card-options"></div></fieldset>
      <fieldset><legend>Mes raccourcis</legend><p class="form-note">Accédez à vos outils directement depuis l’accueil.</p><div class="shortcut-options">${HOME_SHORTCUTS.map(item=>`<label class="personalization-toggle"><input type="checkbox" name="homeShortcut" value="${item.id}">${item.label}</label>`).join('')}</div></fieldset>
      <fieldset><legend>Confort d’utilisation</legend><label class="personalization-toggle"><input type="checkbox" name="assistantDock">Afficher l’assistant IA en bas à gauche</label><p class="form-note">Seul le rond vert apparaît sur la carte. Il s’efface pendant les mesures et la consultation d’une parcelle. L’assistant reste disponible dans Plus si vous le masquez.</p><label class="personalization-toggle"><input type="checkbox" name="nativeHaptics">Vibration discrète quand je coche un travail ou une tâche</label><p class="form-note">Sur les téléphones qui le permettent. Le même réglage commande le retour haptique de l’application iPhone.</p><label class="startup-choice" for="startup-duration">Animation à l’ouverture<select id="startup-duration" name="startupDuration"><option value="3500">Standard · 3,5 secondes</option><option value="2200">Rapide · 2,2 secondes</option><option value="1200">Courte · 1,2 seconde</option><option value="0">Accès direct</option></select></label><p class="form-note">L’application s’ouvre automatiquement à la fin de cette durée, sans bouton à toucher. Le réglage système « Réduire les animations » est respecté.</p></fieldset>
    </form>`, `<button class="button secondary" data-action="close-modal">Annuler</button><button class="button primary" type="submit" form="personalization-form">Enregistrer</button>`);
  const form=document.getElementById('personalization-form');
  const preview=()=>{
    const labels=draft.homeCardOrder.filter(id=>draft.homeCards.includes(id)).map(id=>HOME_CARDS.find(item=>item.id===id).label);
    document.getElementById('home-preview-content').innerHTML=[draft.homeNextAction?'<span class="preview-wide">Prochaine action</span>':'',draft.homeSummary?'<span class="preview-wide">Repères de l’exploitation</span>':'',draft.homeShortcuts.length?`<span class="preview-wide">${draft.homeShortcuts.length} raccourci${draft.homeShortcuts.length>1?'s':''}</span>`:'',...labels.map(label=>`<span>${label}</span>`)].join('')||'<p>Un accueil épuré. Le bouton Personnaliser reste accessible.</p>';
  };
  const renderCards=()=>{
    document.getElementById('home-card-options').innerHTML=draft.homeCardOrder.map((id,index)=>{
      const item=HOME_CARDS.find(card=>card.id===id);
      return `<div class="home-card-option"><label><input type="checkbox" name="homeCard" value="${id}" ${draft.homeCards.includes(id)?'checked':''}><span><strong>${item.label}</strong><small>${item.detail}</small></span></label><div class="reorder-buttons"><button type="button" class="small-button" data-move="-1" data-card="${id}" aria-label="Monter ${item.label}" ${index===0?'disabled':''}>↑</button><button type="button" class="small-button" data-move="1" data-card="${id}" aria-label="Descendre ${item.label}" ${index===draft.homeCardOrder.length-1?'disabled':''}>↓</button></div></div>`;
    }).join('');
  };
  const render=()=>{
    for(const key of ['homeNextAction','homeSummary','assistantDock','nativeHaptics'])form.elements[key].checked=draft[key];
    form.elements.startupDuration.value=String(draft.startupDuration);
    form.querySelectorAll('[name="homeShortcut"]').forEach(input=>input.checked=draft.homeShortcuts.includes(input.value));
    renderCards();preview();
  };
  form.addEventListener('change',()=>{
    for(const key of ['homeNextAction','homeSummary','assistantDock','nativeHaptics'])draft[key]=form.elements[key].checked;
    draft.startupDuration=Number(form.elements.startupDuration.value);
    draft.homeCards=[...form.querySelectorAll('[name="homeCard"]:checked')].map(input=>input.value);
    draft.homeShortcuts=[...form.querySelectorAll('[name="homeShortcut"]:checked')].map(input=>input.value);
    preview();form.querySelectorAll('[data-preset]').forEach(button=>button.removeAttribute('aria-pressed'));
  });
  form.addEventListener('click',event=>{
    const preset=event.target.closest('[data-preset]'),move=event.target.closest('[data-move]');
    if(preset){draft=normalizePersonalization({...draft,...HOME_PRESETS[preset.dataset.preset]});render();form.querySelectorAll('[data-preset]').forEach(button=>button.setAttribute('aria-pressed',String(button===preset)));}
    if(move){draft.homeCardOrder=moveHomeCard(draft.homeCardOrder,move.dataset.card,Number(move.dataset.move));renderCards();preview();const next=form.querySelector(`[data-card="${move.dataset.card}"][data-move="${move.dataset.move}"]`);(next.disabled?next.parentElement.querySelector('button:not(:disabled)'):next)?.focus();}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const button=document.querySelector('[form="personalization-form"]');if(button.disabled)return;
    button.disabled=true;button.textContent='Enregistrement…';
    try{await save(normalizePersonalization(draft));closeModal();toast('Votre espace est personnalisé.');}
    catch(error){toast(`Enregistrement impossible : ${error.message}`,'error');}
    finally{button.disabled=false;button.textContent='Enregistrer';}
  });
  render();
}

// Gestionnaire des modes de la carte : un seul mode ou outil actif à la fois.
// Logique pure (aucun accès au DOM) : app.js fournit le nettoyage de chaque mode.
//
// Modes connus :
//  - multiple : sélection multiple de parcelles (barre sombre en bas) ;
//  - measure  : mesure de distance ou de surface (y compris le résultat affiché) ;
//  - draw     : dessin du contour d’une parcelle ;
//  - point    : placement ou déplacement d’un repère ;
//  - edit     : modification d’un contour sommet par sommet (n° 41) ;
//  - walk     : mesure en marchant au GPS (n° 50) ;
//  - split    : découpe d’une parcelle par une ligne (n° 51).
//
// Règle : entrer dans un mode quitte le précédent ; toute action extérieure au
// mode (autre outil, Couches, recherche, onglet, fiche, mode terrain, micro…)
// le quitte aussi. Un mode « modifié » (tracé non enregistré significatif) n’est
// jamais abandonné en silence : leave() demande d’abord une confirmation.

export const MAP_MODE_LABELS=Object.freeze({multiple:'Sélection multiple',measure:'Mesure',draw:'Dessin de parcelle',point:'Placement d’un repère',edit:'Modification de contour',walk:'Mesure en marchant',split:'Découpe de parcelle'});

// Actions qui appartiennent à un mode : elles ne le quittent pas.
export const MAP_MODE_ACTIONS=Object.freeze({
  multiple:Object.freeze(['map-multiple','map-multiple-cancel','map-multiple-work','map-multiple-task','map-multiple-info','map-multiple-merge']),
  measure:Object.freeze(['undo-measure-point','cancel-measure','finish-measure']),
  draw:Object.freeze(['undo-draw-point','cancel-parcel-draw','finish-parcel-draw','map-mode-keep','map-mode-discard','map-snap-toggle','draw-follow-boundary']),
  point:Object.freeze(['cancel-map-point']),
  edit:Object.freeze(['edit-contour-undo','edit-contour-save','edit-contour-cancel','edit-contour-ring','edit-contour-keep','edit-contour-discard','map-snap-toggle']),
  walk:Object.freeze(['walk-undo','walk-finish','walk-cancel','walk-keep','walk-discard']),
  split:Object.freeze(['split-undo','split-cancel','split-cut','map-snap-toggle'])
});

// Actions sans effet sur le mode en cours (affichage seulement).
export const MAP_NEUTRAL_ACTIONS=Object.freeze(['close-modal','toggle-legend','locate','map-mode-keep','map-mode-discard']);

// Seuil à partir duquel un dessin non enregistré mérite une confirmation.
export const DRAW_DIRTY_POINTS=3;
export function isDrawDirty(points){return Array.isArray(points)&&points.length>=DRAW_DIRTY_POINTS;}

// L’action `action` déclenchée pendant le mode `mode` doit-elle le quitter ?
// `insideModal` : le contrôle se trouve dans une fenêtre ouverte depuis le mode
// (ex. « Travail » de la sélection multiple) ; la fenêtre gère elle-même la suite.
export function actionLeavesMode(mode,action,{insideModal=false}={}){
  if(!mode||!action)return false;
  if(insideModal)return false;
  if(MAP_NEUTRAL_ACTIONS.includes(action))return false;
  if((MAP_MODE_ACTIONS[mode]||[]).includes(action))return false;
  return true;
}

export function createMapModes({onChange=null,onBlocked=null,onError=null}={}){
  let active=null;
  const notify=(previous,reason)=>{try{onChange?.({current:active?.name||null,previous,reason});}catch(error){onError?.(error);}};
  const runCleanup=(mode,reason)=>{try{mode.cleanup?.({reason});}catch(error){onError?.(error);}};
  const api={
    get current(){return active?.name||null;},
    is(name){return Boolean(active)&&active.name===name;},
    isDirty(){if(!active?.isDirty)return false;try{return Boolean(active.isDirty());}catch{return false;}},
    // Entre dans un mode. Le mode précédent (même s’il porte le même nom) est
    // nettoyé d’abord, sans confirmation : l’appelant a déjà utilisé leave().
    enter(name,{cleanup=null,isDirty=null}={}){
      if(!name)throw new Error('Mode de carte inconnu.');
      const previous=active;
      if(previous){active=null;runCleanup(previous,'switch');}
      active={name,cleanup,isDirty};
      notify(previous?.name||null,'enter');
      return api;
    },
    // Quitte le mode actif. Sans `force`, un mode modifié est conservé (retourne false).
    // Avec `name`, ne quitte que si ce mode est bien celui qui est actif.
    exit({name=null,force=false,reason='exit'}={}){
      if(!active)return true;
      if(name&&active.name!==name)return true;
      if(!force&&api.isDirty())return false;
      const previous=active;active=null;runCleanup(previous,reason);notify(previous.name,reason);return true;
    },
    // Le mode s’est terminé de lui-même (enregistré, annulé par la carte…) :
    // on l’oublie sans relancer son nettoyage.
    release(name){
      if(!active||(name&&active.name!==name))return false;
      const previous=active;active=null;notify(previous.name,'release');return true;
    },
    // Quitte le mode puis exécute `proceed`. Si le mode contient un tracé non
    // enregistré, `onBlocked` reçoit confirm()/cancel() et rien n’est perdu.
    leave(proceed=null,{reason='leave'}={}){
      if(!active||api.exit({reason})){proceed?.();return true;}
      const blocked=active;let settled=false;
      const confirm=()=>{if(settled)return;settled=true;if(active===blocked)api.exit({force:true,reason});proceed?.();};
      const cancel=()=>{settled=true;};
      if(onBlocked)onBlocked({mode:blocked.name,reason,confirm,cancel});
      return false;
    }
  };
  return api;
}

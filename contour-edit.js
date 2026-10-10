// n° 41 : modification d'un contour sommet par sommet (logique pure).
// Un seul anneau est modifié à la fois ; la pile d'états permet d'annuler.
import {openRing,closeRing,ringError} from './geometry-ops.js';
import {geometryAreaHa} from './utils.js';

// Anneaux modifiables d'une géométrie : [{poly, ring, label}].
export function editableRings(geometry){
  if(geometry?.type==='Polygon')return(geometry.coordinates||[]).map((r,ring)=>({poly:0,ring,label:ring?`Trou ${ring}`:'Contour'}));
  if(geometry?.type==='MultiPolygon'){
    const multi=geometry.coordinates.length>1;
    return geometry.coordinates.flatMap((poly,p)=>poly.map((r,ring)=>({poly:p,ring,label:`${multi?`Îlot ${p+1}`:'Contour'}${ring?` · trou ${ring}`:''}`})));
  }
  return[];
}

export function ringOf(geometry,ref){
  const poly=geometry.type==='Polygon'?geometry.coordinates:geometry.coordinates[ref.poly];
  return openRing(poly?.[ref.ring]||[]);
}

// Nouvelle géométrie où l'anneau `ref` est remplacé par `points` (anneau ouvert).
export function withRing(geometry,ref,points){
  const next=structuredClone(geometry),ring=closeRing(points);
  if(next.type==='Polygon')next.coordinates[ref.ring]=ring;else next.coordinates[ref.poly][ref.ring]=ring;
  return next;
}

export function moveVertex(points,index,lonlat){const pts=points.map(p=>[...p]);if(index<0||index>=pts.length)return pts;pts[index]=[lonlat[0],lonlat[1]];return pts;}
// Insère un sommet après `index` (sur le segment index → index+1).
export function insertVertex(points,index,lonlat){const pts=points.map(p=>[...p]);pts.splice(index+1,0,[lonlat[0],lonlat[1]]);return pts;}
export function removeVertex(points,index){if(points.length<=3)return null;const pts=points.map(p=>[...p]);pts.splice(index,1);return pts;}
export function midpoints(points){return points.map((p,i)=>{const q=points[(i+1)%points.length];return[(p[0]+q[0])/2,(p[1]+q[1])/2];});}

// Session de modification : géométrie de travail, anneau courant et pile d'annulation.
export function createContourEdit(geometry){
  const rings=editableRings(geometry);
  if(!rings.length)throw new Error('Cette parcelle n’a pas de contour modifiable.');
  return{original:structuredClone(geometry),geometry:structuredClone(geometry),rings,current:0,stack:[]};
}
export function currentRing(edit){return ringOf(edit.geometry,edit.rings[edit.current]);}

// Applique une opération sur l'anneau courant. Refuse (ok:false) un contour invalide.
export function applyRingChange(edit,op,index,lonlat){
  const pts=currentRing(edit);
  const next=op==='move'?moveVertex(pts,index,lonlat):op==='insert'?insertVertex(pts,index,lonlat):op==='remove'?removeVertex(pts,index):null;
  if(!next)return{ok:false,error:op==='remove'?'Un contour doit garder au moins 3 sommets.':'Opération inconnue.'};
  const error=ringError(next);
  if(error)return{ok:false,error};
  edit.stack.push(edit.geometry);
  edit.geometry=withRing(edit.geometry,edit.rings[edit.current],next);
  return{ok:true};
}
export function undoEdit(edit){if(!edit.stack.length)return false;edit.geometry=edit.stack.pop();return true;}
export function nextRing(edit){edit.current=(edit.current+1)%edit.rings.length;return edit.rings[edit.current];}
export function isEditDirty(edit){return Boolean(edit?.stack.length)&&JSON.stringify(edit.geometry)!==JSON.stringify(edit.original);}

// Contrôle final de tous les anneaux.
export function editError(edit){for(const ref of edit.rings){const e=ringError(ringOf(edit.geometry,ref));if(e)return e;}return null;}

const ha=v=>(Math.round(v*100)/100).toFixed(2).replace('.',',');
// « 5,42 ha → 5,57 ha, +0,15 ha »
export function areaChangeLabel(beforeHa,afterHa){
  const d=Math.round((afterHa-beforeHa)*100)/100;
  return`${ha(beforeHa)} ha → ${ha(afterHa)} ha, ${d>0?'+':d<0?'−':'±'}${ha(Math.abs(d))} ha`;
}
export function editAreas(edit){return{before:geometryAreaHa(edit.original),after:geometryAreaHa(edit.geometry)};}

// Surface déclarée après modification : suivie si elle correspondait au contour (±1 %
// ou 0,02 ha), conservée sinon (surface PAC ou cadastrale saisie à la main).
export function nextSurfaceHa(declared,beforeHa,afterHa){
  const d=Number(declared);
  if(declared===null||declared===undefined||declared===''||!Number.isFinite(d))return Number(afterHa.toFixed(4));
  return Math.abs(d-beforeHa)<=Math.max(0.02,beforeHa*0.01)?Number(afterHa.toFixed(4)):d;
}

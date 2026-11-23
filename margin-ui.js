// n° 85 — affichage commun du moteur de marge (Pilotage, rapport, fiche Économie).
// Un montant inconnu s’affiche « — », jamais 0 €.
import {escapeHtml as e,formatNumber,campaignFor} from './utils.js';
import {MARGIN_RULES,previousCampaign} from './pilotage.js';
import {icon} from './ui.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
export const euro=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${n0.format(v)} €`;
const STATUS={connu:'Connu',partiel:'Partiel',inconnu:'Inconnu',ignoré:'Ignoré (travaux chiffrés)',absent:'Non saisi'};

/** « Marge 18 400 € · fiable à 72 % (5 travaux sans coût) ». */
export function marginHeadline(model){
  const t=model.total;
  return t.margin===null?`Marge non calculable · ${model.reliability.label}`:`Marge ${euro(t.margin)} · ${model.reliability.label}`;
}

export function marginSummaryHtml(model){
  const t=model.total,pct=Math.max(0,Math.min(100,t.reliability)),level=t.reliability>=80?'is-good':t.reliability>=50?'is-mid':'is-low';
  const detail=model.reliability.detail||'';
  // n° 10.40 — tuile entière cliquable (le bouton « Pourquoi ? » recouvre la tuile), libellé en sur-titre,
  // valeur absente « À compléter » + raison courte au lieu de « — ».
  const tile=(key,label,value,{hero=false,note='',missing='',negative=false}={})=>`<div class="preview-stat stat-tile${hero?' is-hero':''}${value===null?' is-missing':''}"><strong class="${negative?'negative':''}">${value===null?'À compléter':kpiValue(value)}</strong><small>${e(label)}${explainButton('margin',label,{key,campaign:model.campaign})}</small>${value===null?(missing?`<span class="stat-note">${e(missing)}</span>`:''):note?`<span class="stat-note">${e(note)}</span>`:''}</div>`;
  const productMissing=t.withoutProduct?`${t.withoutProduct} parcelle${t.withoutProduct>1?'s':''} sans rendement ni prix`:'Rendement ou prix à saisir';
  const product=t.productArea?t.product:null;
  const tiles=[
    tile('margin','Marge prévisionnelle',t.margin,{hero:true,negative:t.margin!==null&&t.margin<0,note:t.marginHa!==null?`${euro(t.marginHa)}/ha`:'',missing:`Produit inconnu : ${productMissing.charAt(0).toLowerCase()}${productMissing.slice(1)}`}),
    tile('realized','Charges réalisées',t.realized+t.forfait,{note:t.forfait?'dont forfait':''}),
    tile('engaged','Charges engagées',t.engaged,{note:'travaux prévus'}),
    tile('product','Produit attendu',product,{missing:productMissing,note:t.withoutProduct?`${t.withoutProduct} parcelle${t.withoutProduct>1?'s':''} sans rendement`:''})
  ].join('');
  const title=t.margin===null?'Marge non calculable':`Marge fiable à ${t.reliability} %`;
  const text=t.margin===null?`Fiable à ${t.reliability} %${detail?` · ${detail}`:''}.`:detail?`À compléter : ${detail}.`:'Toutes les données de la campagne sont renseignées.';
  return `<div class="margin-model"><div class="margin-headline callout ${level}" role="status"><strong>${e(title)}</strong><span>${e(text)}</span>
<div class="margin-gauge" role="img" aria-label="Fiabilité ${t.reliability} %"><span style="width:${pct}%"></span></div></div>
<div class="preview-summary kpi-bento">${tiles}</div>${accessTilesHtml(model.campaign)}</div>`;
}

/** Valeur de tuile : chiffre et unité séparés (unité en petit). */
export function kpiValue(v,unit='€'){
  return `${e(n0.format(v))}<span class="stat-unit">\u202f${e(unit)}</span>`;
}

// n° 10.40 — accès du Pilotage déplacés du pied de fenêtre vers une rangée de tuiles dans le corps.
const ACCESS=[
  ['open-crop-margins','Marges par culture','€/ha et prix d’équilibre','chart'],
  ['open-simulator','Et si…','Prix, rendement, charges','sparkles'],
  ['print-pilotage-report','Rapport PDF','À imprimer ou partager','files'],
  ['open-dossier','Dossier','Pièces de la campagne','archive'],
  ['open-stock','Stocks','Valeurs et alertes','package']
];
export function accessTilesHtml(campaign){
  const prev=previousCampaign(campaign),current=campaignFor();
  const item=(action,title,sub,ic,extra='')=>`<button type="button" class="access-tile" data-action="${action}"${extra}><span class="access-icon">${icon(ic,{size:20})}</span><span class="access-text"><strong>${e(title)}</strong><small>${e(sub)}</small></span></button>`;
  return `<nav class="kpi-access" aria-label="Aller plus loin">${ACCESS.map(([a,t,s,ic])=>item(a,t,s,ic,a==='open-stock'?'':` data-campaign="${e(campaign)}"`)).join('')}${prev?item('pilotage-campaign',`← ${prev}`,'Campagne précédente','history',` data-campaign="${e(prev)}"`):''}${campaign!==current?item('pilotage-campaign','Campagne actuelle',current,'calendar',` data-campaign="${e(current)}"`):''}</nav>`;
}

// n° 110 — bouton (i) « Pourquoi ? » partagé par les écrans ; le clic est traité par explain-ui.js
// (module différé chargé par LAZY_TRIGGERS ['[data-explain]'] de lazy-modules.js).
export function explainButton(kind,label,data={}){
  return `<button type="button" class="why-button" data-explain="${e(kind)}"${Object.entries(data).map(([k,v])=>` data-${k}="${e(v)}"`).join('')} aria-label="Pourquoi ? ${e(label)}" title="Pourquoi ?"><span aria-hidden="true">i</span></button>`;
}

export function marginRulesHtml(){
  return `<details class="margin-rules"><summary>Comment la marge est calculée</summary><ul>${MARGIN_RULES.map(r=>`<li>${e(r)}</li>`).join('')}</ul></details>`;
}

/** Lignes de complétude d’une parcelle (connu / partiel / inconnu). */
export function marginLinesHtml(row){
  return `<ul class="margin-lines">${row.lines.map(l=>`<li class="is-${e(l.status)}"><span>${e(l.label)}</span><strong>${e(euro(l.status==='inconnu'||l.status==='absent'?null:l.value))}</strong><small>${e(STATUS[l.status]||l.status)}${l.missing?` · ${l.missing} sans coût`:''}</small></li>`).join('')}</ul><p class="form-note">Fiabilité de la parcelle : ${row.reliability} %${row.ignoredManual?` · charges manuelles (${e(euro(row.ignoredManual))}) non appliquées car des travaux sont chiffrés`:''}.</p>`;
}

export function cultureRowsHtml(model){
  return model.byCulture.map(c=>`<div class="list-row"><div><strong>${e(c.culture)}</strong><small>${formatNumber(c.area)} ha · produit ${e(euro(c.productHa))}/ha · charges ${e(euro(c.costHa))}/ha · fiable à ${c.reliability} %</small></div><strong class="${c.margin!==null&&c.margin<0?'negative':''}">${c.marginHa===null?'—':`${e(euro(c.marginHa))}/ha`}</strong></div>`).join('');
}

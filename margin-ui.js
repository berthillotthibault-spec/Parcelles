// n° 85 — affichage commun du moteur de marge (Pilotage, rapport, fiche Économie).
// Un montant inconnu s’affiche « — », jamais 0 €.
import {escapeHtml as e,formatNumber} from './utils.js';
import {MARGIN_RULES} from './pilotage.js';

const n0=new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0});
export const euro=v=>v===null||v===undefined||!Number.isFinite(v)?'—':`${n0.format(v)} €`;
const STATUS={connu:'Connu',partiel:'Partiel',inconnu:'Inconnu',ignoré:'Ignoré (travaux chiffrés)',absent:'Non saisi'};

/** « Marge 18 400 € · fiable à 72 % (5 travaux sans coût) ». */
export function marginHeadline(model){
  const t=model.total;
  return t.margin===null?`Marge non calculable · ${model.reliability.label}`:`Marge ${euro(t.margin)} · ${model.reliability.label}`;
}

export function marginSummaryHtml(model){
  const t=model.total,level=t.reliability>=80?'is-good':t.reliability>=50?'is-mid':'is-low';
  return `<div class="margin-model"><p class="margin-headline ${level}"><strong>${e(marginHeadline(model))}</strong></p>
<div class="preview-summary"><div class="preview-stat"><strong>${e(euro(t.realized+t.forfait))}</strong><small>charges réalisées${t.forfait?' (dont forfait)':''}</small></div><div class="preview-stat"><strong>${e(euro(t.engaged))}</strong><small>charges engagées (prévues)</small></div><div class="preview-stat"><strong>${e(euro(t.productArea?t.product:null))}</strong><small>produit attendu${t.withoutProduct?` (${t.withoutProduct} parcelle${t.withoutProduct>1?'s':''} sans rendement)`:''}</small></div><div class="preview-stat"><strong class="${t.margin!==null&&t.margin<0?'negative':''}">${e(euro(t.margin))}</strong><small>marge prévisionnelle${t.marginHa!==null?` · ${e(euro(t.marginHa))}/ha`:''}</small></div></div>
<div class="margin-gauge" role="img" aria-label="Fiabilité ${t.reliability} %"><span style="width:${Math.max(0,Math.min(100,t.reliability))}%"></span></div></div>`;
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

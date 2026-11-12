import test from 'node:test';
import assert from 'node:assert/strict';
import {olympicMean,parcelCostDrift,farmCostDrift,postFor} from './cost-drift.js';
import {olympicAverage} from './nitrogen.js';

const CUR='2026/27';
const parcel=(id,extra={})=>({id,nom:`Parcelle ${id}`,surfaceHa:10,culture:'Blé tendre',...extra});
const rot=(parcelId,campaignId,culture='Blé tendre')=>({id:`r-${parcelId}-${campaignId}`,parcelId,campaignId,culture});
const work=(parcelId,campaignId,type,cost,extra={})=>({id:`w-${parcelId}-${campaignId}-${type}-${cost}-${Math.random()}`,parcelId,campaignId,type,cost,status:'Terminé',date:'2025-01-01',...extra});
// Campagne passée : 10 ha, coûts en euros totaux.
function history(parcelId,campaigns,{fongi=1000,semis=800}={}){
  return campaigns.flatMap(c=>[work(parcelId,c,'Fongicide',fongi),work(parcelId,c,'Semis',semis)]);
}
const PAST=['2025/26','2024/25','2023/24','2022/23','2021/22'];

test('moyenne olympique : sans min ni max dès 5 valeurs, égale à olympicAverage', ()=>{
  const v=[52,70,61,65,58];
  assert.equal(olympicMean(v),(58+61+65)/3);
  assert.equal(Math.round(olympicMean(v)*10)/10,olympicAverage(v).value);
  assert.equal(olympicMean([4,6]),5);
  assert.equal(olympicMean([4]),null);
  assert.equal(olympicMean([]),null);
});

test('moins de 2 campagnes : référence insuffisante, aucune référence inventée', ()=>{
  const state={parcelles:[parcel('a')],rotations:[rot('a','2025/26')],interventions:[...history('a',['2025/26']),work('a',CUR,'Fongicide',2000)]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  assert.equal(r.status,'reference-insuffisante');
  assert.equal(r.refEurPerHa,null);
  assert.deepEqual(r.posts,[]);
  assert.match(r.why[0],/Moins de 2 campagnes de blé tendre comparables : pas de référence/);
  assert.equal(r.totalEurPerHa,200);
});

test('repli sur les parcelles de même culture de l’exploitation', ()=>{
  const state={parcelles:[parcel('a'),parcel('b'),parcel('c',{culture:'Maïs'})],
    rotations:[rot('b','2025/26'),rot('b','2024/25'),rot('c','2025/26','Maïs'),rot('c','2024/25','Maïs')],
    interventions:[...history('b',['2025/26','2024/25']),...history('c',['2025/26','2024/25'],{fongi:9000}),work('a',CUR,'Fongicide',1000),work('a',CUR,'Semis',800)]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  assert.equal(r.refCampaigns,2);
  assert.equal(r.refEurPerHa,180);
  assert.equal(r.status,'ok');
  assert.match(r.why[0],/exploitation/);
});

test('dérive détectée sur la parcelle, poste par poste, message chiffré', ()=>{
  const state={parcelles:[parcel('a',{economicsByCampaign:{[CUR]:{yield:70,yieldUnit:'q/ha',salePrice:20}}})],
    rotations:PAST.map(c=>rot('a',c)),
    interventions:[...history('a',PAST),work('a',CUR,'Fongicide',1600),work('a',CUR,'Semis',800)]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  assert.equal(r.status,'derive');
  assert.equal(r.refCampaigns,5);
  assert.equal(r.totalEurPerHa,240);
  const f=r.posts.find(p=>p.post==='fongicides');
  assert.equal(f.deltaEurPerHa,60);
  assert.equal(f.deltaPct,0.6);
  // Prix d'équilibre : 240 €/ha / 7 t/ha ; rendement : 240 / 200 €/t = 1,2 t/ha = 12 q/ha.
  assert.equal(r.breakEvenPrice,34);
  assert.equal(r.breakEvenYield,12);
  assert.equal(r.yieldUnit,'q/ha');
  assert.match(r.message,/240 €\/ha engagés, \+33 % sur votre moyenne \(poste fongicides \+60 €\/ha\)/);
  assert.ok(r.why.some(w=>/Aides non comptées/.test(w)));
});

test('unités t/ha et aides déduites', ()=>{
  const state={preferences:{pacAidsHa:{decoupled:40}},parcelles:[parcel('a',{economicsByCampaign:{[CUR]:{yield:8,yieldUnit:'t/ha',salePrice:200}}})],
    rotations:[],interventions:[work('a',CUR,'Semis',2000)]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  assert.equal(r.yieldUnit,'t/ha');
  // (200 − 40) / 8 = 20 €/t ; 160 / 200 = 0,8 t/ha.
  assert.equal(r.breakEvenPrice,20);
  assert.equal(r.breakEvenYield,0.8);
  assert.ok(!r.why.some(w=>/Aides non comptées/.test(w)));
});

test('rendement nul ou absent : prix d’équilibre null, jamais Infinity ni NaN', ()=>{
  const state={parcelles:[parcel('a',{economicsByCampaign:{[CUR]:{yield:0,salePrice:0}}})],interventions:[work('a',CUR,'Semis',800)]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  assert.equal(r.breakEvenPrice,null);
  assert.equal(r.breakEvenYield,null);
  assert.ok(!/Infinity|NaN/.test(JSON.stringify(r)+r.message));
});

test('rendement attendu : moyenne olympique de l’historique de la parcelle', ()=>{
  const eco=Object.fromEntries(PAST.map((c,i)=>[c,{yield:[60,70,80,90,100][i],yieldUnit:'q/ha'}]));
  const state={parcelles:[parcel('a',{economicsByCampaign:eco})],rotations:PAST.map(c=>rot('a',c)),interventions:[work('a',CUR,'Semis',1600)]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  // 160 €/ha / 8 t/ha.
  assert.equal(r.breakEvenPrice,20);
});

test('travaux annulés, observations et supprimés exclus', ()=>{
  const state={parcelles:[parcel('a')],rotations:PAST.map(c=>rot('a',c)),
    interventions:[...history('a',PAST),work('a',CUR,'Fongicide',1000),work('a',CUR,'Semis',800),
      work('a',CUR,'Fongicide',5000,{status:'Annulé'}),work('a',CUR,'Fongicide',5000,{status:'Annulée'}),
      work('a',CUR,'Observation',5000),work('a',CUR,'Semis',5000,{deletedAt:'2026-01-01'})]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  assert.equal(r.totalEurPerHa,180);
  assert.equal(r.status,'ok');
});

test('seuils 15 % et 10 €/ha respectés', ()=>{
  // Fongicides : 100 -> 114 €/ha (+14 %), sous le seuil. Labour : 20 -> 29 €/ha (+45 % mais +9 €/ha).
  const state={parcelles:[parcel('a')],rotations:PAST.map(c=>rot('a',c)),
    interventions:[...history('a',PAST,{fongi:1000,semis:2000}),...PAST.map(c=>work('a',c,'Labour',200)),
      work('a',CUR,'Fongicide',1140),work('a',CUR,'Semis',2000),work('a',CUR,'Labour',290)]};
  assert.deepEqual(farmCostDrift(state,{campaign:CUR}),[]);
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  assert.equal(r.status,'ok');
  // À 16 % et +16 €/ha, la dérive remonte.
  state.interventions.push(work('a',CUR,'Fongicide',20));
  const d=farmCostDrift(state,{campaign:CUR});
  assert.equal(d.length,1);
  assert.equal(d[0].post,'fongicides');
});

test('farmCostDrift trié par enjeu (écart × surface)', ()=>{
  const state={parcelles:[parcel('a',{surfaceHa:5}),parcel('b',{surfaceHa:50})],
    rotations:[...PAST.map(c=>rot('a',c)),...PAST.map(c=>rot('b',c))],
    interventions:[...history('a',PAST,{fongi:500,semis:400}),work('a',CUR,'Fongicide',1000),work('a',CUR,'Semis',400),
      ...history('b',PAST,{fongi:5000,semis:4000}),work('b',CUR,'Fongicide',6500),work('b',CUR,'Semis',4000)]};
  const d=farmCostDrift(state,{campaign:CUR});
  // a : +100 €/ha × 5 ha = 500 ; b : +30 €/ha × 50 ha = 1500.
  assert.deepEqual(d.map(x=>x.parcelId),['b','a']);
  assert.equal(d[0].stake,1500);
  assert.match(d[0].why,/poste fongicides 130 €\/ha contre 100 €\/ha/);
});

test('état vide -> []', ()=>{
  assert.deepEqual(farmCostDrift({}),[]);
  assert.deepEqual(farmCostDrift(null),[]);
  assert.equal(parcelCostDrift({},'x'),null);
});

test('postes : catégorie de travail ou type de produit', ()=>{
  assert.equal(postFor({type:'Pulvérisation',productType:'Herbicide'}),'herbicides');
  assert.equal(postFor({type:'Traitement'}),'traitement');
  assert.equal(postFor({type:'Épandage engrais'}),'fertilisation');
  assert.equal(postFor({type:'Labour'}),'travail du sol');
  assert.equal(postFor({type:'Moisson'}),'récolte');
  assert.equal(postFor({type:'Clôture'}),'autre');
});

test('unité de rendement absente : t/ha, comme le reste de l’application', ()=>{
  const state={parcelles:[parcel('a',{economicsByCampaign:{[CUR]:{yield:7,salePrice:200}}})],interventions:[work('a',CUR,'Semis',1400)]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  // 140 €/ha / 7 t/ha = 20 €/t ; 140 / 200 €/t = 0,7 t/ha.
  assert.equal(r.yieldUnit,'t/ha');
  assert.equal(r.breakEvenPrice,20);
  assert.equal(r.breakEvenYield,0.7);
});

test('seuil jugé sur la valeur brute : +14,6 % ne devient pas une dérive par arrondi', ()=>{
  const state={parcelles:[parcel('a')],rotations:PAST.map(c=>rot('a',c)),
    interventions:[...history('a',PAST,{fongi:1000,semis:2000}),work('a',CUR,'Fongicide',1146),work('a',CUR,'Semis',2000)]};
  const r=parcelCostDrift(state,'a',{campaign:CUR});
  assert.equal(r.posts.find(p=>p.post==='fongicides').deltaPct,0.15);
  assert.equal(r.status,'ok');
  assert.deepEqual(farmCostDrift(state,{campaign:CUR}),[]);
});

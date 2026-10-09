import test from 'node:test';
import assert from 'node:assert/strict';
import {legendGroups,legendLine,legendStyle,groupBounds,DIMMED_OPACITY} from './map-legend.js';

const sq=(x,y,d=.01)=>({type:'Polygon',coordinates:[[[x,y],[x+d,y],[x+d,y+d],[x,y+d],[x,y]]]});
const parcels=[{id:'a',culture:'Maïs',surfaceHa:20.1,geometry:sq(5,46)},{id:'b',culture:'Maïs',surfaceHa:18.1,geometry:sq(5.1,46.1)},{id:'c',culture:'Blé',surfaceHa:5.4,geometry:sq(4.9,45.9)},{id:'d',culture:'Maïs',deletedAt:'x',surfaceHa:99}];

test('totaux par catégorie : nombre et surface, supprimées exclues', () => {
  const groups=legendGroups(parcels,p=>({label:p.culture,color:'#e0873a'}));
  assert.equal(groups.length,2);
  assert.deepEqual({...groups[0],color:undefined},{label:'Maïs',color:undefined,count:2,ha:38.2,ids:['a','b']});
  assert.equal(legendLine(groups[0]),'Maïs · 2 parcelles · 38,2 ha');
  assert.equal(legendLine(groups[1]),'Blé · 1 parcelle · 5,4 ha');
});

test('surface absente : calculée depuis la géométrie', () => {
  const [group]=legendGroups([{id:'x',geometry:sq(5,46)}],()=>({label:'Sans culture'}));
  assert.ok(group.ha>50&&group.ha<100,String(group.ha));
});

test('isolement : les autres passent à 15 % d’opacité, la catégorie garde son style', () => {
  const style={opacity:1,fillOpacity:.3,color:'#000'};
  assert.equal(legendStyle(style,{focus:null,label:'Maïs'}),style);
  assert.equal(legendStyle(style,{focus:'Maïs',label:'Maïs'}),style);
  const dim=legendStyle(style,{focus:'Maïs',label:'Blé'});
  assert.equal(dim.opacity,DIMMED_OPACITY);assert.ok(Math.abs(dim.fillOpacity-.3*DIMMED_OPACITY)<1e-9);
});

test('emprise de la catégorie pour cadrer la carte', () => {
  const b=groupBounds(parcels,['a','b']).flat();[46,5,46.11,5.11].forEach((v,i)=>assert.ok(Math.abs(b[i]-v)<1e-9));
  assert.equal(groupBounds(parcels,[]),null);
});

// Mes données › Exporter › Parcelles (n° 49) : Shapefile ZIP, KML (Google Earth) et ISOXML parcellaire.
import {exportableParcels,parcelShapefileZip,parcelsKml,parcelsIsoxmlZip} from './parcel-formats.js';
import {download,downloadBlob} from './utils.js';

export function createParcelFormatsUI({state,toast,colorFor=()=>'#778579'}){
  const day=()=>new Date().toISOString().slice(0,10);
  const parcels=()=>{const list=exportableParcels(state());if(!list.length)toast('Aucune parcelle avec contour à exporter.','warning');return list;};
  const done=(list,format)=>toast(`${list.length} parcelle${list.length>1?'s':''} exportée${list.length>1?'s':''} en ${format}.`,'success');
  async function run(format){
    const list=parcels();if(!list.length)return;
    try{
      if(format==='shp'){downloadBlob(`parcelles-${day()}-shp.zip`,await parcelShapefileZip(list));done(list,'Shapefile');}
      else if(format==='kml'){download(`parcelles-${day()}.kml`,parcelsKml(list,{name:`Parcelles ${day()}`,colorFor}),'application/vnd.google-earth.kml+xml;charset=utf-8');done(list,'KML');}
      else if(format==='isoxml'){downloadBlob(`parcelles-${day()}-isoxml.zip`,await parcelsIsoxmlZip(list));done(list,'ISOXML');}
    }catch(error){toast(`Export impossible : ${error.message}`,'error');}
  }
  return {run};
}

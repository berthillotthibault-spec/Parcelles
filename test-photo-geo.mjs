import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readJpegExif,stripJpegMetadata,hasJpegMetadata,choosePhotoLocation,parcelForPhoto,beforeAfter,photoTagCounts,normalizePhotoTags,PHOTO_TAGS} from './photo-geo.js';

// Construit un JPEG minimal avec un bloc EXIF (IFD0 -> GPS + Exif), en petit ou grand boutisme.
function jpegWithExif({le=true,lat=[46,20,24],latRef='N',lon=[5,7,48],lonRef='E',dir=123.4,date='2026:05:12 09:30:00',make='MarqueX'}={}){
  const bytes=[];const w16=v=>le?bytes.push(v&255,v>>8&255):bytes.push(v>>8&255,v&255);const w32=v=>le?bytes.push(v&255,v>>>8&255,v>>>16&255,v>>>24&255):bytes.push(v>>>24&255,v>>>16&255,v>>>8&255,v&255);
  const extra=[];let extraOffset=0;const data=[];
  // Disposition : en-tête(8) | IFD0 (4 entrées) | IFD Exif (1) | IFD GPS (6) | données
  const ifd0At=8,ifd0Len=2+4*12+4,exifAt=ifd0At+ifd0Len,exifLen=2+12+4,gpsAt=exifAt+exifLen,gpsLen=2+6*12+4;let dataAt=gpsAt+gpsLen;
  const blobs=[];const put=arr=>{const at=dataAt;blobs.push(arr);dataAt+=arr.length;return at;};
  const rat=(vals)=>{const out=[];for(const v of vals){const den=1000,num=Math.round(v*den);const tmp=[];const p32=x=>le?tmp.push(x&255,x>>>8&255,x>>>16&255,x>>>24&255):tmp.push(x>>>24&255,x>>>16&255,x>>>8&255,x&255);p32(num);p32(den);out.push(...tmp);}return out;};
  const str=s=>[...Buffer.from(s+'\0','latin1')];
  const makeAt=put(str(make)),dateAt=put(str(date)),latAt=put(rat(lat)),lonAt=put(rat(lon)),dirAt=put(rat([dir]));
  bytes.push(...(le?[0x49,0x49]:[0x4D,0x4D]));w16(42);w32(ifd0At);
  const entry=(tag,type,count,value)=>{w16(tag);w16(type);w32(count);if(type===2&&count<=4||type===3){if(type===3){w16(value);w16(0);}else w32(value);}else w32(value);};
  w16(4);entry(0x010F,2,make.length+1,makeAt);entry(0x0112,3,1,6);entry(0x8769,4,1,exifAt);entry(0x8825,4,1,gpsAt);w32(0);
  w16(1);entry(0x9003,2,date.length+1,dateAt);w32(0);
  const ref=c=>le?(c.charCodeAt(0)):(c.charCodeAt(0)*16777216);
  w16(6);entry(1,2,2,ref(latRef));entry(2,5,3,latAt);entry(3,2,2,ref(lonRef));entry(4,5,3,lonAt);entry(0x10,2,2,ref('T'));entry(0x11,5,1,dirAt);w32(0);
  for(const b of blobs)bytes.push(...b);
  const app1=[0x45,0x78,0x69,0x66,0,0,...bytes],len=app1.length+2;
  const comment=[...Buffer.from('auteur')],clen=comment.length+2;
  return new Uint8Array([0xFF,0xD8,0xFF,0xE0,0,4,0,0,0xFF,0xE1,len>>8,len&255,...app1,0xFF,0xFE,clen>>8,clen&255,...comment,0xFF,0xDA,0,2,1,2,3,0xFF,0xD9]);
}

test('readJpegExif lit GPS, cap et date (II et MM)', () => {
  for(const le of [true,false]){
    const r=readJpegExif(jpegWithExif({le}));
    assert.ok(Math.abs(r.latitude-(46+20/60+24/3600))<1e-6,`lat ${le}`);
    assert.ok(Math.abs(r.longitude-(5+7/60+48/3600))<1e-6);
    assert.equal(r.heading,123);assert.equal(r.orientation,6);
    assert.equal(new Date(r.takenAt).getFullYear(),2026);
    assert.equal(Object.keys(r).includes('make'),false);
  }
  const sw=readJpegExif(jpegWithExif({latRef:'S',lonRef:'W'}).buffer);
  assert.ok(sw.latitude<0&&sw.longitude<0);
});

test('readJpegExif reste sûr sur des données invalides', () => {
  assert.equal(readJpegExif(new Uint8Array([1,2,3])),null);
  assert.equal(readJpegExif(new Uint8Array([0xFF,0xD8,0xFF,0xDA,0,2])),null);
  const broken=jpegWithExif().slice(0,40);assert.doesNotThrow(()=>readJpegExif(broken));
  const zero=readJpegExif(jpegWithExif({lat:[0,0,0],lon:[0,0,0]}));assert.equal(zero.latitude,null);
});

test('stripJpegMetadata retire EXIF et commentaires, garde l\'image', () => {
  const src=jpegWithExif();assert.equal(hasJpegMetadata(src),true);
  const out=stripJpegMetadata(src);
  assert.equal(hasJpegMetadata(out),false);assert.equal(readJpegExif(out),null);
  assert.deepEqual([...out.slice(0,2)],[0xFF,0xD8]);assert.deepEqual([...out.slice(-2)],[0xFF,0xD9]);
  assert.ok(!Buffer.from(out).includes(Buffer.from('MarqueX'))&&!Buffer.from(out).includes(Buffer.from('auteur')));
  const png=new Uint8Array([0x89,0x50]);assert.equal(stripJpegMetadata(png),png);
});

test('choosePhotoLocation : EXIF, puis position fraîche de moins de 30 s', () => {
  const now=1e9;
  assert.equal(choosePhotoLocation({exif:{latitude:46,longitude:5,heading:90},fresh:{latitude:1,longitude:1}}).locationSource,'exif');
  const g=choosePhotoLocation({fresh:{latitude:46,longitude:5,accuracy:7.6,heading:181.2,timestamp:now-5000},now});
  assert.deepEqual(g,{latitude:46,longitude:5,accuracy:8,heading:181,locationSource:'gps'});
  assert.equal(choosePhotoLocation({fresh:{latitude:46,longitude:5,timestamp:now-60000},now}),null);
  assert.equal(choosePhotoLocation({fresh:{latitude:46,longitude:5,heading:-1,timestamp:now},now}).heading,null);
  assert.equal(choosePhotoLocation({}),null);
});

test('parcelForPhoto rattache à la parcelle contenant le point ou toute proche', () => {
  const sq=(id,x)=>({id,geometry:{type:'Polygon',coordinates:[[[x,46],[x+.004,46],[x+.004,46.003],[x,46.003],[x,46]]]}});
  const parcels=[sq('a',5),sq('b',5.01)];
  assert.equal(parcelForPhoto({latitude:46.001,longitude:5.002},parcels).id,'a');
  assert.equal(parcelForPhoto({latitude:46.001,longitude:5.0042,accuracy:10},parcels).id,'a');
  assert.equal(parcelForPhoto({latitude:46.001,longitude:5.007},parcels),null);
  assert.equal(parcelForPhoto(null,parcels),null);
});

test('avant/après et étiquettes', () => {
  const d=n=>Date.UTC(2026,4,n);
  const photos=[{id:'3',capturedAt:d(20),tags:['Maladie']},{id:'1',capturedAt:d(1),tags:['Maladie','Eau']},{id:'2',capturedAt:d(10),tags:['Eau']}];
  const ba=beforeAfter(photos);assert.equal(ba.before.id,'1');assert.equal(ba.after.id,'3');assert.equal(ba.days,19);
  assert.equal(beforeAfter(photos,{tag:'Eau'}).after.id,'2');
  assert.equal(beforeAfter([photos[0]]),null);
  assert.equal(beforeAfter([{capturedAt:d(1)},{capturedAt:d(1)+3600e3}]),null);
  assert.deepEqual(photoTagCounts(photos),[['Eau',2],['Maladie',2]]);
  assert.deepEqual(normalizePhotoTags(['Eau',' Eau ','',null,'Maladie']),['Eau','Maladie']);
  assert.ok(PHOTO_TAGS.includes('Dégât gibier'));
});

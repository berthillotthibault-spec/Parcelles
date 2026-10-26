// Facturation (vague 13) : exports, en logique pure et sans réseau. Chargé à la demande.
// - Factur-X / ZUGFeRD : XML CII (profil EN 16931) d’une facture, d’un acompte ou d’un avoir émis, et
//   contrôle de sa structure (ordre des éléments, champs obligatoires, cohérence des montants).
//   Limite : le XML n’est pas incorporé dans un PDF/A-3 (conversion PDF/A trop lourde sans bibliothèque) ;
//   on remet le PDF lisible et le XML en deux fichiers séparés, que la plateforme de dématérialisation
//   ou le logiciel du comptable sait rapprocher.
// - Journal des ventes façon FEC (ventes, acomptes, avoirs, encaissements, lettrage) et export CSV
//   détaillé par ligne pour le comptable, alignés sur les comptes de accounting-export.js.
// - QR code de virement SEPA (EPC069-12) avec l’encodeur déjà présent (qr.js).
import {normalize} from './utils.js';
import {accountingPlan,toCsv} from './accounting-export.js';
import {qrSvg} from './qr.js';
import {ACCOUNTING_TYPES,DOC_LABELS,STATUS_LABELS,VAT_EXEMPTIONS,amountLine,dateFr,docTypeOf,documentTotals,ibanValid,invoiceBalance,invoiceHtml,invoiceSettings,issuedSeller,invoiceStatus,invoices,fingerprintOk,lineKind,lineTotal,paymentsOf,round2} from './invoices.js';

const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const text=v=>String(v??'').trim();
const inPeriod=(d,from,to)=>!!d&&(!from||d>=from)&&(!to||d<=to);
const xmlEsc=v=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const amt=v=>round2(v||0).toFixed(2);
const qtyStr=v=>String(Math.round((v+Number.EPSILON)*10000)/10000);
const ymd=d=>String(d||'').replace(/-/g,'').slice(0,8);

// ---------- Factur-X (CII, profil EN 16931) ----------
export const FACTURX_PROFILE='urn:cen.eu:en16931:2017';
export const FACTURX_FILE='factur-x.xml';
const TYPE_CODES={facture:'380',acompte:'386',avoir:'381'};
// Unités UN/ECE (recommandation 20).
export const UNIT_CODES={h:'HUR',ha:'HAR','m³':'MTQ',t:'TNE',L:'LTR',forfait:'LS',u:'C62',j:'DAY',km:'KMT','m²':'MTK',m:'MTR',kg:'KGM',lot:'LO',mois:'MON'};
// Cadre de facturation de la réforme française (BT-23) : biens, services ou mixte ; « 1 » facture
// ordinaire, « 4 » facture définitive après acompte (acomptes déduits).
const PROCESS={biens:'B',services:'S',mixte:'M'};
// Adresse libre (« 1 route du Sougey\n01340 Montrevel ») → lignes, code postal, ville, pays.
export function splitAddress(value){
  const rows=String(value||'').split(/\r?\n|,\s*/).map(text).filter(Boolean);let postcode='',city='',country='FR';
  const at=rows.findIndex(r=>/^(?:F-)?\d{5}\s+\S/.test(r));
  if(at>=0){const m=rows[at].match(/^(?:F-)?(\d{5})\s+(.+)$/);postcode=m[1];city=m[2];rows.splice(at,1);}
  const last=rows[rows.length-1]||'';if(/^(france)$/i.test(last))rows.pop();
  else if(/^[A-Z]{2}$/.test(last)){country=last;rows.pop();}
  return{lines:rows.slice(0,3),postcode,city,country};
}
// Catégorie de TVA EN 16931 d’un taux et d’un motif d’exonération.
export function vatCategory(rate,exemption,regime='normal'){
  const r=Number(rate)||0;
  if(r>0)return{code:'S',rate:r};
  const key=exemption||(regime==='franchise'?'franchise':regime==='remboursement-forfaitaire'?'forfaitaire':'');
  const ex=VAT_EXEMPTIONS[key];
  if(!ex)return{code:'Z',rate:0};
  return{code:ex.category,rate:ex.category==='O'?null:0,reason:ex.mention,reasonCode:ex.vatex};
}
// Montant d’une ligne pour le XML : un avoir s’exprime en positif (type 381) ; une ligne négative
// (acompte déduit) garde un prix positif et une quantité négative (règle BR-27).
function xmlLine(l,sign){
  const q=num(l.quantity)??0,p=num(l.unitPrice)??0,total=round2(sign*(lineTotal(l)??0));
  let quantity=sign*q,price=p;if(price<0){price=-price;quantity=-quantity;}
  const gross=round2(quantity*price),allowance=round2(gross-total);
  return{quantity,price,total,allowance:Math.abs(allowance)>=0.005&&l.discountPct?allowance:0};
}
// fc : identifiant fiscal (BT-32, schéma FC), à défaut de n° de TVA (franchise en base, BR-E-02).
const party=(tag,{name,siren,vat,fc='',address,email})=>{
  const a=splitAddress(address);
  return`<ram:${tag}><ram:Name>${xmlEsc(name)}</ram:Name>${siren?`<ram:SpecifiedLegalOrganization><ram:ID schemeID="0002">${xmlEsc(siren)}</ram:ID></ram:SpecifiedLegalOrganization>`:''}<ram:PostalTradeAddress>${a.postcode?`<ram:PostcodeCode>${xmlEsc(a.postcode)}</ram:PostcodeCode>`:''}${a.lines[0]?`<ram:LineOne>${xmlEsc(a.lines[0])}</ram:LineOne>`:''}${a.lines[1]?`<ram:LineTwo>${xmlEsc(a.lines[1])}</ram:LineTwo>`:''}${a.lines[2]?`<ram:LineThree>${xmlEsc(a.lines[2])}</ram:LineThree>`:''}${a.city?`<ram:CityName>${xmlEsc(a.city)}</ram:CityName>`:''}<ram:CountryID>${a.country}</ram:CountryID></ram:PostalTradeAddress>${email?`<ram:URIUniversalCommunication><ram:URIID schemeID="EM">${xmlEsc(email)}</ram:URIID></ram:URIUniversalCommunication>`:''}${vat?`<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xmlEsc(vat)}</ram:ID></ram:SpecifiedTaxRegistration>`:''}${fc?`<ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">${xmlEsc(fc)}</ram:ID></ram:SpecifiedTaxRegistration>`:''}</ram:${tag}>`;
};
const dateTime=(tag,d)=>`<ram:${tag}><udt:DateTimeString format="102">${ymd(d)}</udt:DateTimeString></ram:${tag}>`;
const taxBlock=(c,tag='ApplicableTradeTax',{calculated=null,basis=null,dueCode=''}={})=>`<ram:${tag}>${calculated!==null?`<ram:CalculatedAmount>${amt(calculated)}</ram:CalculatedAmount>`:''}<ram:TypeCode>VAT</ram:TypeCode>${c.reason&&calculated!==null?`<ram:ExemptionReason>${xmlEsc(c.reason)}</ram:ExemptionReason>`:''}${basis!==null?`<ram:BasisAmount>${amt(basis)}</ram:BasisAmount>`:''}<ram:CategoryCode>${c.code}</ram:CategoryCode>${c.reasonCode&&calculated!==null?`<ram:ExemptionReasonCode>${c.reasonCode}</ram:ExemptionReasonCode>`:''}${dueCode?`<ram:DueDateTypeCode>${dueCode}</ram:DueDateTypeCode>`:''}${c.rate!==null&&c.rate!==undefined?`<ram:RateApplicablePercent>${qtyStr(c.rate)}</ram:RateApplicablePercent>`:''}</ram:${tag}>`;
const allowanceCharge=(charge,amount,reason,c)=>`<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>${charge}</udt:Indicator></ram:ChargeIndicator><ram:ActualAmount>${amt(amount)}</ram:ActualAmount><ram:Reason>${xmlEsc(reason)}</ram:Reason>${taxBlock(c,'CategoryTradeTax')}</ram:SpecifiedTradeAllowanceCharge>`;

// Problèmes empêchant l’export (document non émis, type sans valeur comptable…).
export function facturXProblems(state,doc){
  const p=[],t=docTypeOf(doc);
  if(!ACCOUNTING_TYPES.has(t))p.push(`${DOC_LABELS[t]} : pas de Factur-X (document sans valeur comptable).`);
  if(doc.status==='brouillon'||!doc.number)p.push('Émettez le document avant d’exporter son Factur-X.');
  if(!(doc.lines||[]).some(amountLine))p.push('Aucune ligne facturée.');
  if(fingerprintOk(doc)===false)p.push('Document modifié depuis son émission (empreinte différente) : vérifiez-le avant tout export.');
  return p;
}
export function facturXml(state,doc){
  const problems=facturXProblems(state,doc);if(problems.length)throw Error(problems[0]);
  const t=docTypeOf(doc),s=issuedSeller(state,doc),sign=t==='avoir'?-1:1,tot=documentTotals(doc);
  const regime=s.vatRegime||'normal',nature=doc.operationNature||s.operationNature||'services';
  const cat=(rate,ex)=>vatCategory(rate,Number(rate)===0?ex||doc.vatExemption:'',regime);
  const notes=[[`${s.legalName}${s.legalForm?` · ${s.legalForm}`:''}${s.capital&&!/capital/i.test(s.legalForm||'')?` au capital de ${s.capital}`:''}${s.rcs?` · RCS ${String(s.rcs).replace(/^RCS\s*/i,'')}`:''}`,'REG']];
  if(t!=='avoir'){notes.push([s.penalty,'PMD']);notes.push([/40\s*€|40 euros/.test(s.penalty||'')?'Indemnité forfaitaire pour frais de recouvrement : 40 €.':'Indemnité forfaitaire pour frais de recouvrement : 40 € (client professionnel).','PMT']);notes.push([s.escompte?`Escompte : ${s.escompte}`:'Pas d’escompte pour paiement anticipé.','AAB']);}
  if(t==='avoir'&&doc.creditOfNumber)notes.push([`Avoir sur la facture ${doc.creditOfNumber}.`,'AAI']);
  if(doc.note)notes.push([doc.note,'AAI']);
  let lineNo=0;
  const items=(doc.lines||[]).filter(amountLine).map(l=>{
    const x=xmlLine(l,sign),c=cat(l.vatRate,l.vatExemption);lineNo+=1;
    const name=text(l.label)||'Prestation',desc=[text(l.description),l.date?`Réalisé le ${dateFr(l.date)}`:''].filter(Boolean).join(' · ');
    return`<ram:IncludedSupplyChainTradeLineItem><ram:AssociatedDocumentLineDocument><ram:LineID>${lineNo}</ram:LineID></ram:AssociatedDocumentLineDocument><ram:SpecifiedTradeProduct>${l.itemId?`<ram:SellerAssignedID>${xmlEsc(l.itemId)}</ram:SellerAssignedID>`:''}<ram:Name>${xmlEsc(name)}</ram:Name>${desc?`<ram:Description>${xmlEsc(desc)}</ram:Description>`:''}</ram:SpecifiedTradeProduct><ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${qtyStr(x.price)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement><ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${UNIT_CODES[l.unit]||'C62'}">${qtyStr(x.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery><ram:SpecifiedLineTradeSettlement>${taxBlock(c)}${x.allowance?`<ram:SpecifiedTradeAllowanceCharge><ram:ChargeIndicator><udt:Indicator>false</udt:Indicator></ram:ChargeIndicator><ram:CalculationPercent>${qtyStr(l.discountPct)}</ram:CalculationPercent><ram:ActualAmount>${amt(x.allowance)}</ram:ActualAmount><ram:Reason>Remise</ram:Reason></ram:SpecifiedTradeAllowanceCharge>`:''}<ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amt(x.total)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement></ram:IncludedSupplyChainTradeLineItem>`;
  }).join('');
  const groups=tot.parTaux||[];
  const debits=!!s.vatOnDebits&&nature!=='biens',dueCode=nature==='biens'?'':debits?'5':'72';
  const taxes=groups.map(g=>{const c=cat(g.rate,g.exemption);return taxBlock(c,'ApplicableTradeTax',{calculated:sign*g.tax,basis:sign*g.base,dueCode:c.code==='S'?dueCode:''});}).join('');
  const charges=groups.filter(g=>g.discount).map(g=>allowanceCharge(false,sign*g.discount,doc.discount?.type==='pct'?`Remise ${String(doc.discount.value).replace('.',',')} %`:'Remise',cat(g.rate,g.exemption))).join('')
    +groups.filter(g=>g.charge).map(g=>allowanceCharge(true,sign*g.charge,text(doc.shipping?.label)||'Frais',cat(g.rate,g.exemption))).join('');
  const lineTotalSum=round2((doc.lines||[]).filter(amountLine).reduce((a,l)=>a+xmlLine(l,sign).total,0));
  const allowanceTotal=round2(sign*tot.discount),chargeTotal=round2(sign*tot.shipping),basis=round2(sign*tot.ht),tax=round2(sign*tot.tva),grand=round2(sign*tot.ttc);
  const iban=text(s.iban).replace(/\s/g,''),means=iban?`<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>58</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${xmlEsc(iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${s.bic?`<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${xmlEsc(s.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>`:''}</ram:SpecifiedTradeSettlementPaymentMeans>`:'';
  const period=doc.periodStart||doc.periodEnd?`<ram:BillingSpecifiedPeriod>${doc.periodStart?dateTime('StartDateTime',doc.periodStart):''}${doc.periodEnd?dateTime('EndDateTime',doc.periodEnd):''}</ram:BillingSpecifiedPeriod>`:'';
  const terms=t==='avoir'?`<ram:SpecifiedTradePaymentTerms><ram:Description>${xmlEsc(`Avoir à imputer sur la facture ${doc.creditOfNumber||''} ou à rembourser.`)}</ram:Description></ram:SpecifiedTradePaymentTerms>`:`<ram:SpecifiedTradePaymentTerms><ram:Description>${xmlEsc((doc.installments||[]).length?doc.installments.map((p,i)=>`Échéance ${i+1} : ${amt(p.amount)} EUR le ${dateFr(p.date)}`).join(' ; '):`À régler au plus tard le ${dateFr(doc.dueDate)}.`)}</ram:Description>${doc.dueDate?dateTime('DueDateDateTime',doc.dueDate):''}</ram:SpecifiedTradePaymentTerms>`;
  const sellerSiren=text(s.siret).replace(/\s/g,'').slice(0,9),buyerSiren=text(doc.clientSiren).slice(0,9),codes=new Set(groups.map(g=>cat(g.rate,g.exemption).code));
  // Catégorie O (hors champ, remboursement forfaitaire) : aucun n° de TVA du vendeur ni de l’acheteur (BR-O-02).
  // Sans n° de TVA, le SIRET du vendeur sert d’identifiant fiscal (BR-E-02 en franchise en base).
  const outOfScope=codes.has('O'),sellerVat=outOfScope?'':text(s.vatNumber),sellerFc=sellerVat?'':text(s.siret).replace(/\s/g,'');
  // Livraison intracommunautaire (K) : pays de livraison toujours écrit, à défaut celui de l’acheteur (BR-IC-12).
  const ship=doc.deliveryAddress&&normalize(doc.deliveryAddress)!==normalize(doc.clientAddress)?party('ShipToTradeParty',{name:doc.clientName,address:doc.deliveryAddress}):codes.has('K')?party('ShipToTradeParty',{name:doc.clientName,address:doc.clientAddress}):'';
  const deposit=(doc.lines||[]).some(l=>lineKind(l)==='deduction'&&l.source?.type==='deposit');
  const delivery=doc.deliveryDate||((doc.lines||[]).map(l=>l.date).filter(Boolean).sort().pop()||'');
  const xml=`<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"><rsm:ExchangedDocumentContext><ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${PROCESS[nature]||'S'}${deposit?'4':'1'}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${FACTURX_PROFILE}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext><rsm:ExchangedDocument><ram:ID>${xmlEsc(doc.number)}</ram:ID><ram:TypeCode>${TYPE_CODES[t]}</ram:TypeCode>${dateTime('IssueDateTime',doc.issueDate)}${notes.filter(([c])=>text(c)).map(([c,code])=>`<ram:IncludedNote><ram:Content>${xmlEsc(c)}</ram:Content><ram:SubjectCode>${code}</ram:SubjectCode></ram:IncludedNote>`).join('')}</rsm:ExchangedDocument><rsm:SupplyChainTradeTransaction>${items}<ram:ApplicableHeaderTradeAgreement>${doc.reference?`<ram:BuyerReference>${xmlEsc(doc.reference)}</ram:BuyerReference>`:''}${party('SellerTradeParty',{name:s.legalName,siren:sellerSiren,vat:sellerVat,fc:sellerFc,address:s.address,email:s.email})}${party('BuyerTradeParty',{name:doc.clientName,siren:buyerSiren,vat:outOfScope?'':doc.clientVat,address:doc.clientAddress,email:doc.clientEmail})}${doc.quoteNumber?`<ram:ContractReferencedDocument><ram:IssuerAssignedID>${xmlEsc(doc.quoteNumber)}</ram:IssuerAssignedID></ram:ContractReferencedDocument>`:''}</ram:ApplicableHeaderTradeAgreement><ram:ApplicableHeaderTradeDelivery>${ship}${delivery?`<ram:ActualDeliverySupplyChainEvent>${dateTime('OccurrenceDateTime',delivery)}</ram:ActualDeliverySupplyChainEvent>`:''}</ram:ApplicableHeaderTradeDelivery><ram:ApplicableHeaderTradeSettlement><ram:PaymentReference>${xmlEsc(doc.number)}</ram:PaymentReference><ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>${means}${taxes}${period}${charges}${terms}<ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${amt(lineTotalSum)}</ram:LineTotalAmount><ram:ChargeTotalAmount>${amt(chargeTotal)}</ram:ChargeTotalAmount><ram:AllowanceTotalAmount>${amt(allowanceTotal)}</ram:AllowanceTotalAmount><ram:TaxBasisTotalAmount>${amt(basis)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="EUR">${amt(tax)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${amt(grand)}</ram:GrandTotalAmount><ram:TotalPrepaidAmount>0.00</ram:TotalPrepaidAmount><ram:DuePayableAmount>${amt(grand)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>${t==='avoir'&&doc.creditOfNumber?`<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>${xmlEsc(doc.creditOfNumber)}</ram:IssuerAssignedID></ram:InvoiceReferencedDocument>`:''}</ram:ApplicableHeaderTradeSettlement></rsm:SupplyChainTradeTransaction></rsm:CrossIndustryInvoice>
`;
  return xml;
}

// ---------- Lecture minimale du XML (contrôle de structure, sans DOM) ----------
// Arbre {name, attrs, children, text} ; erreur si balises mal imbriquées.
export function parseXml(xml){
  const root={name:'#root',attrs:{},children:[],text:''},stack=[root],re=/<\?[^?]*\?>|<!--[\s\S]*?-->|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;let m,pos=0;
  while((m=re.exec(xml))){
    if(m.index!==pos)throw Error(`XML mal formé près de la position ${pos}.`);pos=re.lastIndex;
    if(m[5]!==undefined){if(m[5].trim())stack[stack.length-1].text+=m[5].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');continue;}
    if(!m[2])continue;
    if(m[1]){const top=stack.pop();if(!top||top.name!==m[2])throw Error(`Balise fermante inattendue : ${m[2]}.`);continue;}
    const attrs={};for(const a of (m[3]||'').matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g))attrs[a[1]]=a[2];
    const node={name:m[2],attrs,children:[],text:''};stack[stack.length-1].children.push(node);if(!m[4])stack.push(node);
  }
  if(pos!==xml.length)throw Error('XML incomplet.');
  if(stack.length!==1)throw Error(`Balise non fermée : ${stack[stack.length-1].name}.`);
  return root;
}
const kids=(n,name)=>(n?.children||[]).filter(c=>c.name===name);
const kid=(n,name)=>kids(n,name)[0]||null;
const path=(n,...names)=>names.reduce((x,name)=>x&&kid(x,name),n);
const val=(n,...names)=>{const x=path(n,...names);return x?x.text.trim():null;};
const money=v=>v===null?null:Number(v);
// Ordre imposé par le schéma CII (D16B) dans les conteneurs principaux.
const ORDER={
  'rsm:CrossIndustryInvoice':['rsm:ExchangedDocumentContext','rsm:ExchangedDocument','rsm:SupplyChainTradeTransaction'],
  'rsm:ExchangedDocument':['ram:ID','ram:Name','ram:TypeCode','ram:IssueDateTime','ram:CopyIndicator','ram:LanguageID','ram:IncludedNote'],
  'rsm:SupplyChainTradeTransaction':['ram:IncludedSupplyChainTradeLineItem','ram:ApplicableHeaderTradeAgreement','ram:ApplicableHeaderTradeDelivery','ram:ApplicableHeaderTradeSettlement'],
  'ram:IncludedSupplyChainTradeLineItem':['ram:AssociatedDocumentLineDocument','ram:SpecifiedTradeProduct','ram:SpecifiedLineTradeAgreement','ram:SpecifiedLineTradeDelivery','ram:SpecifiedLineTradeSettlement'],
  'ram:SpecifiedLineTradeSettlement':['ram:ApplicableTradeTax','ram:BillingSpecifiedPeriod','ram:SpecifiedTradeAllowanceCharge','ram:SpecifiedTradeSettlementLineMonetarySummation'],
  'ram:ApplicableHeaderTradeAgreement':['ram:BuyerReference','ram:SellerTradeParty','ram:BuyerTradeParty','ram:SellerTaxRepresentativeTradeParty','ram:BuyerOrderReferencedDocument','ram:ContractReferencedDocument'],
  'ram:ApplicableHeaderTradeDelivery':['ram:ShipToTradeParty','ram:ActualDeliverySupplyChainEvent','ram:DespatchAdviceReferencedDocument'],
  'ram:ApplicableHeaderTradeSettlement':['ram:CreditorReferenceID','ram:PaymentReference','ram:TaxCurrencyCode','ram:InvoiceCurrencyCode','ram:PayeeTradeParty','ram:SpecifiedTradeSettlementPaymentMeans','ram:ApplicableTradeTax','ram:BillingSpecifiedPeriod','ram:SpecifiedTradeAllowanceCharge','ram:SpecifiedTradePaymentTerms','ram:SpecifiedTradeSettlementHeaderMonetarySummation','ram:InvoiceReferencedDocument'],
  'ram:ApplicableTradeTax':['ram:CalculatedAmount','ram:TypeCode','ram:ExemptionReason','ram:BasisAmount','ram:CategoryCode','ram:ExemptionReasonCode','ram:DueDateTypeCode','ram:RateApplicablePercent'],
  'ram:SellerTradeParty':['ram:ID','ram:GlobalID','ram:Name','ram:SpecifiedLegalOrganization','ram:PostalTradeAddress','ram:URIUniversalCommunication','ram:SpecifiedTaxRegistration'],
  'ram:BuyerTradeParty':['ram:ID','ram:GlobalID','ram:Name','ram:SpecifiedLegalOrganization','ram:PostalTradeAddress','ram:URIUniversalCommunication','ram:SpecifiedTaxRegistration'],
  'ram:PostalTradeAddress':['ram:PostcodeCode','ram:LineOne','ram:LineTwo','ram:LineThree','ram:CityName','ram:CountryID'],
  'ram:SpecifiedTradeSettlementHeaderMonetarySummation':['ram:LineTotalAmount','ram:ChargeTotalAmount','ram:AllowanceTotalAmount','ram:TaxBasisTotalAmount','ram:TaxTotalAmount','ram:RoundingAmount','ram:GrandTotalAmount','ram:TotalPrepaidAmount','ram:DuePayableAmount']
};
function orderErrors(node,errors){
  const order=ORDER[node.name];
  if(order){let last=-1;for(const c of node.children){const i=order.indexOf(c.name);if(i<0){errors.push(`${node.name} : élément inattendu ${c.name}.`);continue;}if(i<last)errors.push(`${node.name} : ${c.name} est mal placé.`);last=i;}}
  for(const c of node.children)orderErrors(c,errors);
}
const close=(a,b)=>a!==null&&b!==null&&Math.abs(a-b)<0.011;
// Contrôle structurel et arithmétique (règles BR-xx et BR-CO-xx principales d’EN 16931).
export function validateFacturX(xml){
  const errors=[];let root;
  try{root=parseXml(String(xml||''));}catch(error){return{ok:false,errors:[error.message]};}
  const inv=kid(root,'rsm:CrossIndustryInvoice');if(!inv)return{ok:false,errors:['Racine rsm:CrossIndustryInvoice absente.']};
  orderErrors(inv,errors);
  if(val(inv,'rsm:ExchangedDocumentContext','ram:GuidelineSpecifiedDocumentContextParameter','ram:ID')!==FACTURX_PROFILE)errors.push('BT-24 : profil EN 16931 attendu.');
  const doc=kid(inv,'rsm:ExchangedDocument'),tx=kid(inv,'rsm:SupplyChainTradeTransaction');
  if(!val(doc,'ram:ID'))errors.push('BT-1 : numéro de facture absent.');
  if(!['380','381','386','384','389'].includes(val(doc,'ram:TypeCode')))errors.push('BT-3 : code de type invalide.');
  if(!/^\d{8}$/.test(val(doc,'ram:IssueDateTime','udt:DateTimeString')||''))errors.push('BT-2 : date d’émission invalide.');
  const agr=kid(tx,'ram:ApplicableHeaderTradeAgreement'),set=kid(tx,'ram:ApplicableHeaderTradeSettlement');
  for(const [tag,bt] of [['ram:SellerTradeParty','BT-27'],['ram:BuyerTradeParty','BT-44']]){const p=kid(agr,tag);if(!val(p,'ram:Name'))errors.push(`${bt} : nom ${tag==='ram:SellerTradeParty'?'du vendeur':'de l’acheteur'} absent.`);if(!val(p,'ram:PostalTradeAddress','ram:CountryID'))errors.push(`${tag} : pays absent.`);}
  if(val(set,'ram:InvoiceCurrencyCode')!=='EUR')errors.push('BT-5 : devise EUR attendue.');
  const lines=kids(tx,'ram:IncludedSupplyChainTradeLineItem');if(!lines.length)errors.push('BG-25 : au moins une ligne.');
  let sumLines=0;const cats=new Set();
  for(const l of lines){
    const id=val(l,'ram:AssociatedDocumentLineDocument','ram:LineID'),total=money(val(l,'ram:SpecifiedLineTradeSettlement','ram:SpecifiedTradeSettlementLineMonetarySummation','ram:LineTotalAmount'));
    if(!id)errors.push('BT-126 : identifiant de ligne absent.');if(!val(l,'ram:SpecifiedTradeProduct','ram:Name'))errors.push(`BT-153 : désignation absente (ligne ${id}).`);
    const price=money(val(l,'ram:SpecifiedLineTradeAgreement','ram:NetPriceProductTradePrice','ram:ChargeAmount')),q=money(val(l,'ram:SpecifiedLineTradeDelivery','ram:BilledQuantity'));
    if(price===null||price<0)errors.push(`BR-27 : prix net absent ou négatif (ligne ${id}).`);
    if(!path(l,'ram:SpecifiedLineTradeDelivery','ram:BilledQuantity')?.attrs?.unitCode)errors.push(`BT-130 : unité absente (ligne ${id}).`);
    const allowance=kids(kid(l,'ram:SpecifiedLineTradeSettlement'),'ram:SpecifiedTradeAllowanceCharge').reduce((a,c)=>a+(money(val(c,'ram:ActualAmount'))||0)*(val(c,'ram:ChargeIndicator','udt:Indicator')==='true'?-1:1),0);
    if(total===null)errors.push(`BT-131 : montant de ligne absent (ligne ${id}).`);else{sumLines+=total;if(price!==null&&q!==null&&!close(round2(q*price-allowance),total))errors.push(`BR-LINE : quantité × prix ≠ montant (ligne ${id}).`);}
    const c=val(l,'ram:SpecifiedLineTradeSettlement','ram:ApplicableTradeTax','ram:CategoryCode');if(!c)errors.push(`BT-151 : catégorie de TVA absente (ligne ${id}).`);else cats.add(c);
  }
  const sum=kid(set,'ram:SpecifiedTradeSettlementHeaderMonetarySummation'),g=k=>money(val(sum,k));
  if(!sum)errors.push('BG-22 : totaux absents.');
  else{
    const linesSum=g('ram:LineTotalAmount'),charge=g('ram:ChargeTotalAmount')||0,allowance=g('ram:AllowanceTotalAmount')||0,basis=g('ram:TaxBasisTotalAmount'),tax=g('ram:TaxTotalAmount')??0,grand=g('ram:GrandTotalAmount'),prepaid=g('ram:TotalPrepaidAmount')||0,due=g('ram:DuePayableAmount');
    if(!close(round2(sumLines),linesSum))errors.push('BR-CO-10 : somme des lignes ≠ total des lignes.');
    const ac=kids(set,'ram:SpecifiedTradeAllowanceCharge'),sumAc=flag=>round2(ac.filter(c=>val(c,'ram:ChargeIndicator','udt:Indicator')===flag).reduce((a,c)=>a+(money(val(c,'ram:ActualAmount'))||0),0));
    if(!close(sumAc('false'),allowance))errors.push('BR-CO-11 : somme des remises ≠ total des remises.');
    if(!close(sumAc('true'),charge))errors.push('BR-CO-12 : somme des frais ≠ total des frais.');
    if(!close(round2(linesSum-allowance+charge),basis))errors.push('BR-CO-13 : base HT ≠ lignes − remises + frais.');
    const taxes=kids(set,'ram:ApplicableTradeTax');if(!taxes.length)errors.push('BG-23 : ventilation de TVA absente.');
    if(!close(round2(taxes.reduce((a,x)=>a+(money(val(x,'ram:CalculatedAmount'))||0),0)),tax))errors.push('BR-CO-14 : somme des TVA ≠ TVA totale.');
    if(!close(round2(taxes.reduce((a,x)=>a+(money(val(x,'ram:BasisAmount'))||0),0)),basis))errors.push('BR-CO-SUM : somme des bases ≠ base HT.');
    for(const x of taxes){const c=val(x,'ram:CategoryCode'),r=money(val(x,'ram:RateApplicablePercent')),b=money(val(x,'ram:BasisAmount')),v=money(val(x,'ram:CalculatedAmount'));
      if(c==='S'&&r!==null&&b!==null&&!close(round2(b*r/100),v))errors.push(`BR-S-09 : TVA ${r} % mal calculée.`);
      if(['E','AE','K','G','O'].includes(c)&&!val(x,'ram:ExemptionReason')&&!val(x,'ram:ExemptionReasonCode'))errors.push(`BR-${c}-10 : motif d’exonération absent.`);
      if(c!=='S'&&v)errors.push(`BR-${c}-09 : TVA non nulle en catégorie ${c}.`);
      if(!cats.has(c)&&!kids(set,'ram:SpecifiedTradeAllowanceCharge').some(a=>val(a,'ram:CategoryTradeTax','ram:CategoryCode')===c))errors.push(`BR-CO-18 : catégorie ${c} sans ligne.`);}
    for(const c of cats)if(!taxes.some(x=>val(x,'ram:CategoryCode')===c))errors.push(`BR-CO-18 : catégorie ${c} absente de la ventilation.`);
    if(!close(round2(basis+tax),grand))errors.push('BR-CO-15 : TTC ≠ HT + TVA.');
    if(!close(round2(grand-prepaid),due))errors.push('BR-CO-16 : net à payer incohérent.');
    if(due>0&&!val(set,'ram:SpecifiedTradePaymentTerms','ram:DueDateDateTime','udt:DateTimeString')&&!val(set,'ram:SpecifiedTradePaymentTerms','ram:Description'))errors.push('BR-CO-25 : échéance ou conditions de paiement absentes.');
    if(cats.has('S')&&!val(kid(agr,'ram:SellerTradeParty'),'ram:SpecifiedTaxRegistration','ram:ID'))errors.push('BR-S-02 : n° de TVA du vendeur absent.');
    if(cats.has('K')&&!val(kid(agr,'ram:BuyerTradeParty'),'ram:SpecifiedTaxRegistration','ram:ID'))errors.push('BR-IC-02 : n° de TVA de l’acheteur absent (livraison intracommunautaire).');
  }
  const regs=tag=>kids(kid(agr,tag),'ram:SpecifiedTaxRegistration').map(r=>({scheme:kid(r,'ram:ID')?.attrs?.schemeID||'',id:val(r,'ram:ID')})).filter(r=>r.id);
  if(cats.has('E')&&!regs('ram:SellerTradeParty').length)errors.push('BR-E-02 : identifiant fiscal du vendeur absent (n° de TVA ou immatriculation fiscale).');
  if(cats.has('O')&&[...regs('ram:SellerTradeParty'),...regs('ram:BuyerTradeParty')].some(r=>r.scheme==='VA'))errors.push('BR-O-02 : catégorie O (hors champ) : ni n° de TVA du vendeur, ni n° de TVA de l’acheteur.');
  if(cats.has('K')){const del=kid(tx,'ram:ApplicableHeaderTradeDelivery');
    if(!val(del,'ram:ShipToTradeParty','ram:PostalTradeAddress','ram:CountryID'))errors.push('BR-IC-12 : pays de livraison absent (livraison intracommunautaire).');
    if(!val(del,'ram:ActualDeliverySupplyChainEvent','ram:OccurrenceDateTime','udt:DateTimeString')&&!path(set,'ram:BillingSpecifiedPeriod'))errors.push('BR-IC-11 : date de livraison ou période de facturation absente (livraison intracommunautaire).');}
  return{ok:!errors.length,errors};
}
export function facturXFileName(doc){return`${DOC_LABELS[docTypeOf(doc)]} ${doc.number||'brouillon'} - factur-x.xml`.replace('’',"'").replace(/[\\/:*?"<>|\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();}

// ---------- Journal des ventes façon FEC ----------
export const FEC_HEADERS=['JournalCode','JournalLib','EcritureNum','EcritureDate','CompteNum','CompteLib','CompAuxNum','CompAuxLib','PieceRef','PieceDate','EcritureLib','Debit','Credit','EcritureLet','DateLet','ValidDate','Montantdevise','Idevise'];
export const FEC_DISCLAIMER='Journal préparatoire pour votre comptable, au format des colonnes du FEC : ce n’est pas le FEC légal de l’entreprise (produit par son logiciel comptable). Comptes indicatifs à faire valider.';
export const BILLING_ACCOUNTS={client:'411',deposit:'4191',vat:'44571',discount:'709',shipping:'7085',bank:'512',cash:'530'};
const clientAux=doc=>{const base=doc.clientId?String(doc.clientId):normalize(doc.clientName).replace(/[^a-z0-9]/g,'');return`C${base.replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,16)||'DIVERS'}`;};
const lettre=i=>{let s='',n=i;do{s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)-1;}while(n>=0);return s.padStart(2,'A');};
// Écritures équilibrées : facture (411 au débit, produits, TVA collectée au crédit), acompte (4191 au lieu
// des produits), acompte déduit sur la facture de solde (4191 au débit), avoir (sens inversé), encaissements.
export function billingJournal(state,{from='',to='',salesAccount=null}={}){
  const plan=accountingPlan(state),sales=salesAccount||plan.prestations?.account||'7060',entries=[],warnings=[];let seq=0;
  const docs=invoices(state).filter(i=>i.status!=='brouillon'&&ACCOUNTING_TYPES.has(docTypeOf(i))&&i.number).sort((a,b)=>String(a.issueDate).localeCompare(String(b.issueDate))||String(a.number).localeCompare(String(b.number)));
  const settled=new Map();
  for(const d of docs){
    if(d.docType==='avoir')continue;const b=invoiceBalance(state,d);
    if(b.due<=0.005&&b.overpaid<=0.005&&!b.legacy)settled.set(d.id,b.lastPayment||d.issueDate);
    else if(b.legacy)settled.set(d.id,d.paidAt);
  }
  const letters=new Map([...settled.keys()].map((id,i)=>[id,lettre(i)]));
  const byId=new Map(docs.map(x=>[x.id,x]));
  const depositPosting=(l,v)=>{const dep=l.source?.type==='deposit'?byId.get(l.source.id):null,g=(dep?.totals?.parTaux||dep?.totals?.byRate||[]).find(x=>x.base&&Number(x.rate)===Number(l.vatRate));
    if(!g)return v;const exact=-round2(g.base);return Math.abs(exact-v)>0.004&&Math.abs(exact-v)<=0.05?exact:v;};
  const push=(entry,rows)=>{const debit=round2(rows.reduce((a,r)=>a+r.debit,0)),credit=round2(rows.reduce((a,r)=>a+r.credit,0));if(Math.abs(debit-credit)>0.005)warnings.push(`Écriture ${entry.piece} déséquilibrée (${debit} / ${credit}) : vérifiez-la.`);entries.push({...entry,rows});};
  const side=(account,label,amount,extra={})=>amount>=0?{account,label,debit:round2(amount),credit:0,...extra}:{account,label,debit:0,credit:round2(-amount),...extra};
  for(const d of docs){
    if(!inPeriod(d.issueDate,from,to))continue;const t=docTypeOf(d),tot=documentTotals(d),aux=clientAux(d),frozen=num(d.totals?.ttc);
    if(frozen!==null&&Math.abs(frozen-tot.ttc)>0.005)warnings.push(`${d.number} : total recalculé (${tot.ttc}) différent du total émis (${frozen}).`);
    const letter=t==='avoir'?letters.get(d.creditOf)||'':letters.get(d.id)||'',dateLet=letter?(t==='avoir'?settled.get(d.creditOf):settled.get(d.id)):'';
    const rows=[side(BILLING_ACCOUNTS.client,`Client ${d.clientName}`,tot.ttc,{aux,auxLabel:d.clientName,letter,dateLet})];
    const byAccount=new Map();
    const add=(k,v)=>byAccount.set(k,round2((byAccount.get(k)||0)+v));
    for(const l of (d.lines||[]).filter(amountLine)){const v=lineTotal(l);if(v===null)continue;
      // Acompte déduit : 4191 soldé du montant HT exact de l’acompte. La déduction reprend ce montant à l’identique ;
      // un écart reste possible sur une facture de solde émise avant ce correctif (centime repris sur la déduction) : il reste en ventes.
      if(lineKind(l)==='deduction'){const posted=depositPosting(l,v);add(BILLING_ACCOUNTS.deposit,posted);if(posted!==v)add(l.account||sales,round2(v-posted));continue;}
      add(t==='acompte'?BILLING_ACCOUNTS.deposit:(l.account||sales),v);}
    for(const [account,v] of byAccount)rows.push(side(account,account===BILLING_ACCOUNTS.deposit?(t==='acompte'?'Acompte reçu':'Acompte déduit'):'Ventes',-v));
    if(tot.discount)rows.push(side(BILLING_ACCOUNTS.discount,'Remise accordée',tot.discount));
    if(tot.shipping)rows.push(side(BILLING_ACCOUNTS.shipping,text(d.shipping?.label)||'Frais facturés',-tot.shipping));
    for(const r of tot.byRate)if(r.tax)rows.push(side(BILLING_ACCOUNTS.vat,`TVA collectée ${String(r.rate).replace('.',',')} %`,-r.tax));
    seq+=1;push({journal:'VT',journalLabel:'Ventes',num:seq,date:d.issueDate,piece:d.number,label:`${DOC_LABELS[t]} ${d.number} ${d.clientName||''}`.trim()},rows);
  }
  for(const d of docs){
    if(d.docType==='avoir')continue;const letter=letters.get(d.id)||'',dateLet=letter?settled.get(d.id):'';
    for(const p of paymentsOf(d)){
      const amount=p.legacy?invoiceBalance(state,d).net:p.amount;if(!inPeriod(p.date,from,to)||!amount)continue;
      const comp=p.method==='compensation',bank=p.method==='especes'?BILLING_ACCOUNTS.cash:BILLING_ACCOUNTS.bank;
      const rows=[side(comp?BILLING_ACCOUNTS.client:bank,comp?`Compensation ${p.reference||''}`.trim():p.method==='especes'?'Caisse':'Banque',amount,comp?{aux:clientAux(d),auxLabel:d.clientName}:{}),side(BILLING_ACCOUNTS.client,`Client ${d.clientName}`,-amount,{aux:clientAux(d),auxLabel:d.clientName,letter,dateLet})];
      seq+=1;push({journal:comp?'OD':'BQ',journalLabel:comp?'Opérations diverses':'Banque',num:seq,date:p.date,piece:d.number,label:`${amount<0?'Remboursement':'Règlement'} ${d.number}${p.reference?` · ${p.reference}`:''}`},rows);
    }
  }
  return{entries,warnings,disclaimer:FEC_DISCLAIMER};
}
const fecDec=v=>v?String(round2(v).toFixed(2)).replace('.',','):'0,00';
export function fecTable(journal){
  const out=[];
  for(const e of journal.entries)for(const r of e.rows)out.push([e.journal,e.journalLabel,String(e.num),ymd(e.date),r.account,r.label,r.aux||'',r.auxLabel||'',e.piece,ymd(e.date),e.label,fecDec(r.debit),fecDec(r.credit),r.letter||'',r.letter?ymd(r.dateLet):'',ymd(e.date),'','']);
  return out;
}
// Fichier texte séparé par des barres verticales (comme un FEC), sans BOM.
export function billingFecText(state,options={}){
  const clean=v=>String(v??'').replace(/[|\r\n\t]+/g,' ');
  return[FEC_HEADERS,...fecTable(billingJournal(state,options))].map(r=>r.map(clean).join('|')).join('\r\n');
}

// ---------- CSV détaillé (une ligne par ligne de facture) ----------
export const LINE_HEADERS=['Date','Numéro','Type','Client','SIREN client','TVA client','Désignation','Compte','Quantité','Unité','PU HT','Remise %','Taux TVA','Montant HT','Échéance','Statut','Encaissé','Reste dû','Facture d’origine','Devis'];
export function billingLinesCsv(state,{from='',to='',salesAccount=null}={}){
  const plan=accountingPlan(state),sales=salesAccount||plan.prestations?.account||'7060',rows=[];
  const docs=invoices(state).filter(i=>i.status!=='brouillon'&&inPeriod(i.issueDate,from,to)).sort((a,b)=>String(a.issueDate).localeCompare(String(b.issueDate))||String(a.number).localeCompare(String(b.number)));
  for(const d of docs){
    const t=docTypeOf(d),b=t==='avoir'?null:invoiceBalance(state,d),status=STATUS_LABELS[invoiceStatus(d,state)]||'';
    (d.lines||[]).filter(amountLine).forEach((l,i)=>rows.push([d.issueDate,d.number,DOC_LABELS[t],d.clientName,d.clientSiren||'',d.clientVat||'',l.label,lineKind(l)==='deduction'||t==='acompte'?BILLING_ACCOUNTS.deposit:l.account||sales,l.quantity??'',l.unit||'',l.unitPrice??'',l.discountPct||'',l.vatRate??'',lineTotal(l)??'',d.dueDate||'',status,b&&!i?b.paid:'',b&&!i?b.due:'',d.creditOfNumber||'',d.quoteNumber||'']));
    const tot=documentTotals(d);
    if(tot.discount)rows.push([d.issueDate,d.number,DOC_LABELS[t],d.clientName,d.clientSiren||'',d.clientVat||'','Remise globale',BILLING_ACCOUNTS.discount,'','','','','',-tot.discount,d.dueDate||'',status,'','',d.creditOfNumber||'',d.quoteNumber||'']);
    if(tot.shipping)rows.push([d.issueDate,d.number,DOC_LABELS[t],d.clientName,d.clientSiren||'',d.clientVat||'',text(d.shipping?.label)||'Frais',BILLING_ACCOUNTS.shipping,'','','','',d.shipping?.vatRate??'',tot.shipping,d.dueDate||'',status,'','',d.creditOfNumber||'',d.quoteNumber||'']);
  }
  return toCsv(LINE_HEADERS,rows);
}

// ---------- QR code de virement SEPA (EPC069-12, version 002) ----------
// Seulement pour un reste dû positif en euros et un IBAN valide ; jamais pour un avoir.
export function epcPayload(state,doc,{amount=null}={}){
  const s={...invoiceSettings(state),...(doc.seller||{})},iban=text(s.iban).replace(/\s/g,'').toUpperCase(),t=docTypeOf(doc);
  if(t==='avoir'||t==='devis')return null;if(!iban||!ibanValid(iban))return null;
  const due=amount!==null?round2(amount):doc.status==='brouillon'?documentTotals(doc).ttc:invoiceBalance(state,doc).due;
  if(!(due>=0.01&&due<=999999999.99))return null;
  const name=text(s.legalName).replace(/[\r\n]+/g,' ').slice(0,70),ref=`${DOC_LABELS[t]} ${doc.number||''}`.replace('’',"'").trim().slice(0,140);
  return['BCD','002','1','SCT',text(s.bic).replace(/\s/g,'').toUpperCase(),name,iban,`EUR${due.toFixed(2)}`,'','',ref].join('\n');
}
export function epcQrSvg(state,doc,options={}){const p=epcPayload(state,doc,options);return p?qrSvg(p,{label:'QR code de virement SEPA'}):'';}
// Document imprimable avec le QR de virement (si le modèle l’active et qu’un IBAN valide est saisi).
export function invoiceHtmlWithQr(state,doc,{assetBase=''}={}){
  const s=invoiceSettings(state),qr=s.template?.showQr?epcQrSvg(state,doc):'';
  return invoiceHtml(state,doc,{assetBase,qrSvg:qr});
}

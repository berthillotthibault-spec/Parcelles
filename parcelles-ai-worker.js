const MODEL="gemini-3.8-flash";

export default{
 async fetch(r,e){
  if(r.method==="OPTIONS")return new Response(null,{headers:cors()});
  if(r.method!=="POST")return out({error:"POST uniquement"},405);
  try{
   const b=await r.json();
   if(!b.message)return out({error:"Message manquant"},400);
   const prompt=`Tu es l'assistant IA de Parcelles — Le Sougey.
Réponds en français, clairement et pratiquement.
N'invente jamais les données de l'exploitation.
Données:
${JSON.stringify(b.context||{})}

Question:
${b.message}`;
   const x=await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
     method:"POST",
     headers:{
      "Content-Type":"application/json",
      "x-goog-api-key":e.GEMINI_API_KEY
     },
     body:JSON.stringify({
      contents:[{role:"user",parts:[{text:prompt}]}],
      generationConfig:{temperature:.4,maxOutputTokens:1200}
     })
    }
   );
   const d=await x.json();
   if(!x.ok)return out({error:d?.error?.message||"Erreur Gemini"},x.status);
   const reply=d?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
   return out({reply:reply||"Aucune réponse reçue."});
  }catch(err){
   return out({error:err.message||"Erreur Worker"},500);
  }
 }
};

function cors(){
 return {
  "Access-Control-Allow-Origin":"https://berthillotthibault-spec.github.io",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type"
 };
}

function out(data,status=200){
 return new Response(JSON.stringify(data),{
  status,
  headers:{"Content-Type":"application/json",...cors()}
 });
}

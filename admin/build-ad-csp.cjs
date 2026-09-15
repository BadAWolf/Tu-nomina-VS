// Static hosting: authorize exact first-party script bytes, then propagate trust
// to scripts they create. Never publish a fixed, reusable CSP nonce.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const pages=['convenio-2026.html','derechos-vigilante.html','guia-nomina-vigilante.html','preguntas-frecuentes.html'];
function build(){
 for(const page of pages){
  const file=path.join(root,page);let html=fs.readFileSync(file,'utf8');const hashes=[];
  html=html.replace(/<script\b([^>]*\bsrc="([^"]+)"[^>]*)>/g,(_,attrs,src)=>{
   const relative=src.split('?')[0];
   if(!/^[a-z0-9-]+\.js$/.test(relative))throw Error('Unexpected script in editorial page: '+src);
   const hash='sha256-'+crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('base64');
   hashes.push("'"+hash+"'");attrs=attrs.replace(/\s+integrity="[^"]*"/g,'');
   return '<script'+attrs+' integrity="'+hash+'">';
  });
  // The four static guides contain no account forms or user-supplied HTML.
  // AdSense creates its own cross-origin resource tree. The calculator and legal
  // pages keep their existing policy without eval or advertising origins.
  const policy="script-src "+[...new Set(hashes)].join(' ')+" 'strict-dynamic' 'unsafe-eval'; script-src-attr 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";
  html=html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/,(_,a,b)=>a+policy+b);
  fs.writeFileSync(file,html);
 }
}
module.exports=build;
if(require.main===module)build();

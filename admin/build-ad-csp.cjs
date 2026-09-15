// Static hosting: authorize exact first-party script bytes, then propagate trust
// to scripts they create. Never publish a fixed, reusable CSP nonce.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const pages=['index.html','convenio-2026.html','derechos-vigilante.html','guia-nomina-vigilante.html','preguntas-frecuentes.html'];
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
  // Script execution is limited to these exact files and their dependency tree.
  // AdSense needs dynamic cross-origin resources; legal pages do not load it.
  const resources=page==='index.html'?"default-src 'self'; connect-src 'self' https:; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https:; font-src 'self' https: data:; frame-src https:; ":'';
  const policy=resources+"script-src "+[...new Set(hashes)].join(' ')+" 'strict-dynamic' 'unsafe-eval'; script-src-attr 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests";
  html=html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(">)/,(_,a,b)=>a+policy+b);
  fs.writeFileSync(file,html);
 }
}
module.exports=build;
if(require.main===module)build();

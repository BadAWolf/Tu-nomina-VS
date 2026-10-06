/* Vista previa al compartir enlaces (WhatsApp, Telegram, redes). */
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const image='https://calculadoravigilante.com/og-image.png';

test('Every indexable page shares its own title, description and URL with the preview image',()=>{
 let pages=0;
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){
  const w=new JSDOM(fs.readFileSync(path.join(root,file),'utf8')).window,d=w.document;try{
   if(d.querySelector('meta[name="robots"][content*="noindex"]'))continue;
   const og=name=>d.querySelector('meta[property="'+name+'"]')?.content;
   assert.equal(og('og:url'),d.querySelector('link[rel="canonical"]').href,file);
   assert.ok(og('og:title')&&og('og:description'),file);
   assert.equal(og('og:image'),image,file);
   assert.equal(og('og:image:width'),'1200',file);assert.equal(og('og:image:height'),'630',file);
   assert.ok(og('og:image:alt'),file);
   assert.equal(d.querySelector('meta[name="twitter:card"]').content,'summary_large_image',file);
   pages++;
  }finally{w.close();}
 }
 assert.equal(pages,10);
});

test('The preview image is a 1200 x 630 PNG small enough for WhatsApp',()=>{
 const png=fs.readFileSync(path.join(root,'og-image.png'));
 assert.equal(png.toString('ascii',1,4),'PNG');
 assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
 assert.ok(png.length<300*1024,'WhatsApp may skip previews above 300 KB');
});

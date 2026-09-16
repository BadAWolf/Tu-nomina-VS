const fs=require('node:fs'),path=require('node:path');
module.exports=function(w){
 for(const file of ['security.js','install.js','calculation-rules.js','vacation-pluses.js','calculator.js','baja.js','index-script-1.js'])w.eval(fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
};

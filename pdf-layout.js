/* Shared print identity. All values come from the existing calculator results. */
(function () {
  'use strict';
  const C = {
    ORO:[33,99,79], ORO2:[40,118,92], ORObg:[238,246,237], OROline:[185,212,180],
    TXT:[33,62,51], TXT2:[61,85,74], MUT:[89,107,96],
    VER:[33,99,79], ROJ:[165,56,56], AZU:[50,98,134],
    LIN:[223,229,221], SURF:[247,248,245]
  };
  function clean(value) {
    return String(value).replace(/[\u2010-\u2015\u2212]/g, '-').replace(/\u202f|\u00a0/g, ' ')
      .replace(/\u2713/g, '').replace(/\u2192/g, '>');
  }
  function logo(doc, x, y, size) {
    const s = size / 64;
    doc.setFillColor(...C.ORO); doc.roundedRect(x,y,size,size,size*.22,size*.22,'F');
    function line(points, color, width, closed) {
      doc.setDrawColor(...color); doc.setLineWidth(width*s); doc.setLineCap('round'); doc.setLineJoin('round');
      doc.lines(points.slice(1).map((p,i)=>[(p[0]-points[i][0])*s,(p[1]-points[i][1])*s]),x+points[0][0]*s,y+points[0][1]*s,[1,1],'S',closed);
    }
    line([[32,10],[51,17],[49,36],[42,47],[32,54],[22,47],[15,36],[13,17]], [247,246,242],3,true);
    line([[25,23],[39,23]], [247,246,242],3,false);
    line([[25,29],[33,29]], [247,246,242],3,false);
    line([[24,37],[30,43],[41,32]], [197,223,185],3.5,false);
  }
  function create(options) {
    const doc = new window.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
    const W=210, H=297, M=18, A=W-2*M, bottom=265;
    let y=0;
    doc.setProperties({title:clean(options.title)+' - Nómina Vigilante',author:'Nómina Vigilante',creator:'calculadoravigilante.com',subject:'Estimación orientativa'});
    function font(size, weight='normal', color=C.TXT) {
      doc.setFont('helvetica',weight); doc.setFontSize(size); doc.setTextColor(...color);
    }
    function header(title, continuation, compact=false) {
      doc.setFillColor(...C.SURF); doc.rect(0,0,W,35,'F');
      logo(doc,M,10,14);
      font(14,'bold'); doc.text('Nómina Vigilante',M+19,16);
      font(8,'normal',C.MUT); doc.text('Tu trabajo cuenta. Tu nómina, clara.',M+19,22);
      font(7.5,'normal',C.MUT); doc.text(options.date,W-M,16,{align:'right'});
      doc.text('calculadoravigilante.com',W-M,22,{align:'right'});
      doc.setDrawColor(...C.LIN); doc.setLineWidth(.3); doc.line(M,35,W-M,35);
      font(compact?15:19,'bold');
      const lines=doc.splitTextToSize(clean(title),A);
      doc.text(lines,M,compact?43:47); y=(compact?43:47)+(lines.length-1)*8+(compact?7:9);
      if(continuation) {font(8,'normal',C.MUT);doc.text('Continuación del desglose',M,y);y+=8;}
    }
    function ensure(height) {
      if(y+height>bottom) {doc.addPage();header(options.title,true);}
    }
    function section(text) {
      ensure(20);font(9,'bold',C.ORO);doc.text(clean(text).toUpperCase(),M,y);y+=3;
      doc.setDrawColor(...C.LIN);doc.setLineWidth(.3);doc.line(M,y,W-M,y);y+=6;
    }
    function calendarSheet() {
      header('Tu cuadrante y tu nómina',false,true);
      y=options.calendar(doc,y,M,A,W,C);
      const gap=10,width=(A-gap)/2,start=y,limit=bottom-27;
      const shortLabels={'Categoría profesional':'Categoría','Tipo de jornada':'Jornada','Años de antigüedad':'Antigüedad','Horas del cuadrante (incluye vacaciones)':'Horas con vacaciones','Vacaciones disfrutadas':'Vacaciones','Jornada computable del mes':'Jornada computable','Pagas extra prorrateadas':'Pagas prorrateadas','Retención IRPF aplicada':'IRPF'};
      function heading(text){return {heading:clean(text).toUpperCase(),height:7};}
      function row(item){
        font(8,item.total?'bold':'normal');
        const lines=doc.splitTextToSize(clean(item.label),width-25);
        font(8,'bold');const values=doc.splitTextToSize(clean(item.value),23);
        return {...item,lines,values,height:Math.max(lines.length,values.length)*3.8+(item.total?3:1)};
      }
      function detail(key,value){
        font(7.5);const lines=doc.splitTextToSize(clean((shortLabels[key]||key)+': '+value),width);
        return {lines,detail:true,height:lines.length*3.5+1};
      }
      const columns=[[],[]];
      options.blocks.forEach((block,i)=>{
        const column=columns[Math.min(i,1)];if(block.title)column.push(heading(block.title));
        block.rows.forEach(item=>column.push(row(item)));
      });
      // These amounts and rates already appear in the calendar totals or payroll rows.
      const repeated=new Set(['Horas del cuadrante (incluye vacaciones)','Horas trabajadas (sin vacaciones)','Horas nocturnas','Horas fin de semana / festivo','Jornada computable del mes','Retención IRPF aplicada']);
      const details=[heading('Datos del cálculo'),...Object.entries(options.data).filter(([key])=>!repeated.has(key)).map(([key,value])=>detail(key,value))];
      const height=items=>items.reduce((sum,item)=>sum+item.height,0);
      // Use the space under deductions for the inputs if they remain readable.
      const inlineDetails=start+height(columns[1])+5+height(details)<=limit;
      if(inlineDetails)columns[1].push({height:5},...details);
      const pages=[start,start];
      function drawColumn(items,column){
        let page=1,cy=start;const x=M+column*(width+gap);
        items.forEach(item=>{
          const pageLimit=page===1?limit:bottom;
          if(cy+item.height>pageLimit){
            page++;if(page>doc.getNumberOfPages()){doc.addPage();header('Tu cuadrante y tu nómina',true);}
            else doc.setPage(page);
            cy=66;
          }
          if(item.heading){font(8.5,'bold',C.ORO);doc.text(item.heading,x,cy);doc.setDrawColor(...C.LIN);doc.line(x,cy+2,x+width,cy+2);}
          else if(item.detail){font(7.5,'normal',C.MUT);doc.text(item.lines,x,cy);}
          else if(item.lines){
            if(item.total){doc.setFillColor(...C.SURF);doc.roundedRect(x-1,cy-3,width+2,item.height-1,1,1,'F');}
            font(8,item.total?'bold':'normal',C.TXT2);doc.text(item.lines,x,cy);
            font(8,'bold',item.negative?C.ROJ:item.exempt?C.AZU:C.ORO);doc.text(item.values,x+width,cy,{align:'right'});
          }
          cy+=item.height;
        });
        pages[column]=page===1?cy:limit;doc.setPage(1);
      }
      drawColumn(columns[0],0);drawColumn(columns[1],1);
      y=Math.max(...pages)+3;
      doc.setFillColor(...C.ORObg);doc.setDrawColor(...C.OROline);doc.roundedRect(M,y,A,21,3,3,'FD');
      font(9,'bold',C.ORO);doc.text('NETO ESTIMADO A COBRAR',M+5,y+8);
      font(7.5,'normal',C.MUT);doc.text('Según tu horario y los datos introducidos',M+5,y+15);
      font(23,'bold',C.ORO);doc.text(clean(options.net),W-M-5,y+14,{align:'right'});
      if(!inlineDetails){
        doc.addPage();header('Datos de tu nómina');
        Object.entries(options.data).forEach(([key,value])=>{
          font(9,'normal',C.MUT);const left=doc.splitTextToSize(clean(key),65);
          font(9,'bold',C.TXT2);const right=doc.splitTextToSize(clean(value),A-76);
          const height=Math.max(left.length,right.length)*4.6+1;ensure(height);
          font(9,'normal',C.MUT);doc.text(left,M,y);font(9,'bold',C.TXT2);doc.text(right,M+76,y);y+=height;
        });
      }
    }
    if(options.calendar)calendarSheet();
    else {
    header(options.title);
    // The result stays together and is visible before the detail.
    doc.setFillColor(...C.ORObg);doc.setDrawColor(...C.OROline);doc.roundedRect(M,y,A,28,3,3,'FD');
    font(9,'bold',C.ORO);doc.text(clean(options.netLabel),M+6,y+9);
    font(8,'normal',C.MUT);doc.text('Importe estimado según los datos introducidos',M+6,y+18);
    font(25,'bold',C.ORO);doc.text(clean(options.net),W-M-6,y+18,{align:'right'});y+=33;
    section('Datos del cálculo');
    Object.entries(options.data).forEach(([key,value])=>{
      font(9,'normal',C.MUT);const left=doc.splitTextToSize(clean(key),65);
      font(9,'bold',C.TXT2);const right=doc.splitTextToSize(clean(value),A-76);
      const height=Math.max(left.length,right.length)*4.6+.9;
      ensure(height);font(9,'normal',C.MUT);doc.text(left,M,y);
      font(9,'bold',C.TXT2);doc.text(right,M+76,y);y+=height;
    });
    y+=5;
    options.blocks.forEach(block=>{
      if(block.title) section(block.title);
      block.rows.forEach(row=>{
        font(row.total?10:9,row.total?'bold':'normal');
        const lines=doc.splitTextToSize(clean(row.label),A-48);
        const height=Math.max(1,lines.length)*4.6+(row.total?5:1.5);
        ensure(height);
        if(row.total) {doc.setFillColor(...C.SURF);doc.roundedRect(M-2,y-4,A+4,height-1,1,1,'F');}
        font(row.total?10:9,row.total?'bold':'normal',C.TXT2);doc.text(lines,M,y);
        font(row.total?10:9,'bold',row.negative?C.ROJ:row.exempt?C.AZU:C.ORO);
        doc.text(clean(row.value),W-M,y,{align:'right'});y+=height;
      });
      y+=5;
    });
    }
    const count=doc.getNumberOfPages();
    for(let page=1;page<=count;page++) {
      doc.setPage(page);doc.setDrawColor(...C.LIN);doc.setLineWidth(.3);doc.line(M,274,W-M,274);
      font(7,'normal',C.MUT);
      doc.text('Estimación orientativa. No sustituye la nómina oficial ni el asesoramiento laboral.',M,279);
      doc.textWithLink('Convenio estatal de empresas de seguridad 2026-2030 - BOE de 18/04/2026.',M,283,{url:'https://www.boe.es/buscar/doc.php?id=BOE-A-2026-8569'});
      font(7,'bold',C.ORO);doc.text('calculadoravigilante.com',M,289);
      font(7,'normal',C.MUT);doc.text(page+' / '+count,W-M,289,{align:'right'});
    }
    return doc;
  }
  window.VigilantePDF = Object.freeze({create});
})();

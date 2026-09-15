(function(){
  function listo(){
    var b=document.getElementById("menu-btn"), p=document.getElementById("menu-panel"),
        o=document.getElementById("menu-overlay"), x=document.getElementById("menu-cerrar");
    if(!b||!p||!o) return;
    function abrir(){ p.classList.add("abierto"); o.classList.add("abierto"); document.body.style.overflow="hidden"; }
    function cerrar(){ p.classList.remove("abierto"); o.classList.remove("abierto"); document.body.style.overflow=""; }
    b.addEventListener("click",abrir);
    o.addEventListener("click",cerrar);
    if(x) x.addEventListener("click",cerrar);
    document.addEventListener("keydown",function(e){ if(e.key==="Escape") cerrar(); });
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",listo); else listo();
})();

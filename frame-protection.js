/* GitHub Pages cannot set frame-ancestors. Keep interactive pages out of frames. */
(function(){
  'use strict';
  if(window.self===window.top)return;
  document.documentElement.style.display='none';
  window.stop();
})();

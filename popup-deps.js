
// Lightweight dependency popup helper
// Usage (on Apps page, before calling /api/deploy-start):
//   const ok = await window.showDepsPopup(envId, objectId);
//   if (!ok) return; // user canceled
(function(){
  async function showDepsPopup(envId, objectId){
    try{
      if(!envId || !objectId) return true; // nothing to validate
      const res = await fetch('/api/validate/install-apps/' + encodeURIComponent(envId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{ app_name: String(objectId) }])
      });
      if(!res.ok) return true; // don't block on API error
      const miss = await res.json();
      if(Array.isArray(miss) && miss.length){
        var listHtml = miss.map(function(m){
          return '<li><code>' + (m.id||'') + '</code> &ge; <strong>' + (m.version||'') + '</strong></li>';
        }).join('');
        if (window.Swal && typeof window.Swal.fire === 'function'){
          var r = await window.Swal.fire({
            title: 'Dependências detectadas',
            html: '<p>Para atualizar <code>' + objectId + '</code> neste ambiente, são necessários os componentes abaixo (ou versões superiores):</p><ul style="text-align:left">' + listHtml + '</ul><p>Deseja continuar mesmo assim?</p>',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Continuar',
            cancelButtonText: 'Cancelar'
          });
          return !!r.isConfirmed;
        }else{
          var plain = miss.map(function(m){ return ' - ' + (m.id||'') + ' >= ' + (m.version||''); }).join('\n');
          return confirm('Foram identificadas dependências necessárias:\n' + plain + '\n\nDeseja continuar mesmo assim?');
        }
      }
      return true; // no dependencies missing
    }catch(e){
      console.warn('showDepsPopup: falha de validação', e);
      return true; // don't block on unexpected error
    }
  }
  window.showDepsPopup = showDepsPopup;
})();

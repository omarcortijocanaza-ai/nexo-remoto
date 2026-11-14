(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NexoCalidad=api;})(globalThis,function(){
  'use strict';
  // Calidad del vídeo GPU según la red (plan «Internet», V4 y V5). Todo aquí es puro: el cliente
  // le pasa muestras de getStats() y aplica lo que se decida; las pruebas le pasan secuencias.

  // Peldaños de bitrate en kbps. El servidor acepta exactamente estos (lib/perfil-gpu.js).
  const ESCALERA=[1500,2500,4000,6000,8000,10000];
  const ALTURAS=[720,900,1080];
  const FPS=[30,45,60];
  // Techos que el usuario elige en «Uso de datos».
  const TECHOS=[2500,6000,10000];
  const ESPERA_ENTRE_CAMBIOS_MS=20000; // cada cambio reinicia el codificador (≈ 0,5 s de corte)
  const MUESTRAS_CONGESTION=2;
  const MUESTRAS_SANAS=12; // a 2,5 s por muestra: 30 s seguidos sin problemas

  // «lan» si se entra por una dirección privada o de la propia PC; cualquier otra (el túnel o el
  // dominio) es «remoto». Se decide una vez al cargar la página.
  function clasificarRed(hostname){
    const h=String(hostname||'').toLowerCase().replace(/^\[|\]$/g,'');
    if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h==='::1')return'lan';
    const o=h.split('.').map(Number);
    if(o.length===4&&o.every(n=>Number.isInteger(n)&&n>=0&&n<=255)){
      if(o[0]===127||o[0]===10)return'lan';
      if(o[0]===172&&o[1]>=16&&o[1]<=31)return'lan';
      if(o[0]===192&&o[1]===168)return'lan';
      if(o[0]===169&&o[1]===254)return'lan';
    }
    return'remoto';
  }

  // Preferencia del usuario para una red: { fps, height, techo }. Lo inválido toma el valor por defecto.
  function preferenciaPorDefecto(red){return red==='lan'?{fps:45,height:1080,techo:10000}:{fps:30,height:1080,techo:6000}}
  function normalizarPreferencia(valor,red){
    const base=preferenciaPorDefecto(red),v=valor&&typeof valor==='object'?valor:{};
    return{fps:FPS.includes(Number(v.fps))?Number(v.fps):base.fps,height:ALTURAS.includes(Number(v.height))?Number(v.height):base.height,techo:TECHOS.includes(Number(v.techo))?Number(v.techo):base.techo};
  }

  // Perfil con el que se empieza: lo elegido, y por Internet un bitrate prudente (4 Mbps) que la
  // adaptación sube si la red aguanta.
  function perfilInicial(red,pref){
    const p=normalizarPreferencia(pref,red);
    return{fps:p.fps,height:p.height,kbps:red==='lan'?p.techo:Math.min(4000,p.techo)};
  }

  function bajar(actual){
    const i=ESCALERA.indexOf(actual.kbps);
    if(i>0)return{...actual,kbps:ESCALERA[i-1]};
    const h=ALTURAS.indexOf(actual.height);
    if(h>0)return{...actual,height:ALTURAS[h-1]};
    if(actual.fps>30)return{...actual,fps:30};
    return null;
  }

  // Primero se recupera la imagen (altura y FPS elegidos) y luego los bits, hasta el techo.
  function subir(actual,pref){
    if(actual.height<pref.height){const h=ALTURAS.find(a=>a>actual.height);return{...actual,height:Math.min(h,pref.height)};}
    if(actual.fps<pref.fps)return{...actual,fps:pref.fps};
    const siguiente=ESCALERA.find(k=>k>actual.kbps);
    if(siguiente&&siguiente<=pref.techo)return{...actual,kbps:siguiente};
    return null;
  }

  // Recorta un perfil al techo y a lo elegido (cuando el usuario cambia algo a mano).
  function ajustarAPreferencia(actual,pref){
    const kbps=ESCALERA.includes(actual.kbps)?Math.min(actual.kbps,pref.techo):pref.techo;
    return{fps:Math.min(actual.fps,pref.fps),height:Math.min(actual.height,pref.height),kbps};
  }

  // Adaptador con memoria entre muestras. `muestra` recibe los contadores acumulados de
  // inbound-rtp y devuelve el perfil nuevo o null. La pérdida se mide por ventana (entre
  // muestras): la acumulada desde el inicio reaccionaba tarde y no se recuperaba nunca.
  function crearAdaptador({ahora=()=>Date.now()}={}){
    let previo=null,congestion=0,sanas=0,ultimoCambio=-Infinity;
    function reiniciar(){previo=null;congestion=0;sanas=0;}
    function muestra({perdidos,recibidos,rttMs,jitterMs},actual,pref){
      const p=Number(perdidos)||0,r=Number(recibidos)||0;
      let perdida=null;
      if(previo&&r>=previo.r&&p>=previo.p){const dp=p-previo.p,dr=r-previo.r;if(dp+dr>0)perdida=dp*100/(dp+dr);}
      previo={p,r};
      const rtt=Number(rttMs)||0,jitter=Number(jitterMs)||0;
      if(perdida===null){congestion=0;sanas=0;return{perfil:null,perdida:null};}
      const congestionada=perdida>3||rtt>300||jitter>60;
      const sana=perdida<0.5&&rtt>0&&rtt<150&&jitter<30;
      congestion=congestionada?congestion+1:0;
      sanas=sana?sanas+1:0;
      if(ahora()-ultimoCambio<ESPERA_ENTRE_CAMBIOS_MS)return{perfil:null,perdida};
      let perfil=null;
      if(congestion>=MUESTRAS_CONGESTION)perfil=bajar(actual);
      else if(sanas>=MUESTRAS_SANAS)perfil=subir(actual,pref);
      if(perfil){ultimoCambio=ahora();congestion=0;sanas=0;}
      return{perfil,perdida};
    }
    return{muestra,reiniciar,marcarCambio:()=>{ultimoCambio=ahora();congestion=0;sanas=0;}};
  }

  return{ESCALERA,ALTURAS,FPS,TECHOS,ESPERA_ENTRE_CAMBIOS_MS,clasificarRed,preferenciaPorDefecto,normalizarPreferencia,perfilInicial,bajar,subir,ajustarAPreferencia,crearAdaptador};
});

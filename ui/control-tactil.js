(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NexoTactil=api;})(globalThis,function(){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  // La cámara sólo transforma la imagen local. Nunca cambia monitor ni resolución.
  function crearCamara(rect,ratio,cambio=()=>{}){
    let z=1,x=0,y=0,ultimoBox=null;
    // DOMRect expone sus medidas en el prototipo: expandirlo con {...r} las pierde.
    function box(){const r=rect(),w=Math.min(r.width,r.height*ratio());return{left:r.left,top:r.top,width:r.width,height:r.height,w,h:w/ratio()};}
    function set(s){const b=box();z=clamp(s.z,1,4);x=clamp(s.x,-Math.max(0,(b.w*z-b.width)/2),Math.max(0,(b.w*z-b.width)/2));y=clamp(s.y,-Math.max(0,(b.h*z-b.height)/2),Math.max(0,(b.h*z-b.height)/2));ultimoBox=b;cambio({z,x,y});}
    function punto(p){const b=box();return{x:clamp(.5+(p.x-b.left-b.width/2-x)/(b.w*z),0,1),y:clamp(.5+(p.y-b.top-b.height/2-y)/(b.h*z),0,1)};}
    function posicion(p){const b=box();return{x:b.width/2+x+(p.x-.5)*b.w*z,y:b.height/2+y+(p.y-.5)*b.h*z};}
    function gesto(inicio,centro,distancia,actual,nuevaDistancia){const b=box(),nz=clamp(inicio.z*nuevaDistancia/Math.max(1,distancia),1,4),k=nz/inicio.z;set({z:nz,x:actual.x-b.left-b.width/2-(centro.x-b.left-b.width/2-inicio.x)*k,y:actual.y-b.top-b.height/2-(centro.y-b.top-b.height/2-inicio.y)*k});}
    function mostrar(p){const b=box(),q=posicion(p);set({z,x:x+clamp(q.x,24,b.width-24)-q.x,y:y+clamp(q.y,24,b.height-24)-q.y});}
    function ajustar(conservar=false){const b=box();set({z:conservar&&ultimoBox&&b.w?z*ultimoBox.w/b.w:z,x,y});}
    return{box,punto,posicion,gesto,set,mostrar,estado:()=>({z,x,y}),reset:()=>set({z:1,x:0,y:0}),ajustar};
  }

  function crearGestos(o){
    const dedos=new Map(),now=o.now||(()=>performance.now()),raf=o.raf||requestAnimationFrame,caf=o.caf||cancelAnimationFrame;
    let uno=null,dos=null,bloqueado=false,largo=0,frame=0,inercia=0,acX=0,acY=0,ancla=null,cursor={x:.5,y:.5},sujeto=false,toqueDoble=null,parejaTap=null,ultimoTap=null;
    const pos=e=>({x:e.clientX,y:e.clientY});
    const remoto=p=>o.remoto(o.camara.punto(p));
    const pintar=()=>o.cursor?.(cursor,o.modo()==='trackpad');
    function parar(){caf(inercia);inercia=0;caf(frame);frame=0;acX=acY=0;o.cancelarScroll?.();}
    function emitir(){frame=0;if(acX||acY){o.scroll(acX,acY,ancla);acX=acY=0;}}
    function acumular(dx,dy){acX+=dx;acY+=dy;if(!frame)frame=raf(emitir);}
    function soltar(){if(sujeto){o.pointer('up',cursor);sujeto=false;o.sujeto?.(false);}}
    function cancelar(){clearTimeout(largo);parar();if(uno?.drag)o.pointer('up',uno.ultimoRemoto);soltar();uno=dos=null;toqueDoble=parejaTap=ultimoTap=null;dedos.clear();bloqueado=false;}
    function arrastre(){parar();if(sujeto)soltar();else{sujeto=true;o.pointer('dragstart',cursor);o.sujeto?.(true);}pintar();}
    function pareja(){const[a,b]=[...dedos.values()];return{c:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},d:Math.hypot(a.x-b.x,a.y-b.y)};}
    function down(e){
      parar();dedos.set(e.pointerId,pos(e));
      if(dedos.size>1){clearTimeout(largo);if(uno?.drag)o.pointer('up',uno.ultimoRemoto);soltar();bloqueado=true;if(dedos.size===2){const p=pareja();dos={...p,s:o.camara.estado()};parejaTap={t:now(),c:p.c,puntos:new Map(dedos),valido:Boolean(uno&&now()-uno.t<=140&&uno.viaje<10),salida:null};}else{dos=null;parejaTap=null;toqueDoble=null;}uno=null;ultimoTap=null;return;}
      if(bloqueado)return;
      const p=pos(e),r=o.modo()==='trackpad'?{...cursor}:remoto(p),t=now();ancla={...r};
      uno={inicio:p,ultimo:p,r,ultimoRemoto:r,t,ultimoT:t,viaje:0,vx:0,vy:0,estado:'pendiente',drag:false,armado:o.modo()==='trackpad'&&ultimoTap&&t-ultimoTap.t<320&&Math.hypot(p.x-ultimoTap.p.x,p.y-ultimoTap.p.y)<35};ultimoTap=null;
      largo=setTimeout(()=>{if(uno&&uno.estado==='pendiente'&&!sujeto){if(uno.armado){uno.estado='cursor';uno.drag=true;o.pointer('dragstart',uno.r);}else{uno.estado='largo';o.pointer('tap',r,{button:'right'});}}},650);
    }
    function move(e){
      if(!dedos.has(e.pointerId))return;dedos.set(e.pointerId,pos(e));
      if(parejaTap){const origen=parejaTap.puntos.get(e.pointerId);if(origen&&Math.hypot(e.clientX-origen.x,e.clientY-origen.y)>10){parejaTap.valido=false;toqueDoble=null;}}
      if(dedos.size===2&&dos){const p=pareja();o.camara.gesto(dos.s,dos.c,dos.d,p.c,p.d);pintar();return;}
      if(bloqueado||!uno)return;
      const p=pos(e),t=now(),dx=p.x-uno.ultimo.x,dy=p.y-uno.ultimo.y,dt=Math.max(1,t-uno.ultimoT),total=Math.hypot(p.x-uno.inicio.x,p.y-uno.inicio.y),modo=o.modo();
      uno.viaje=Math.max(uno.viaje,total);
      let comenzo=false;
      if(uno.estado==='pendiente'&&total>=6){comenzo=true;clearTimeout(largo);uno.estado=modo==='navigate'?'scroll':modo==='direct'?'drag':'cursor';uno.eje=Math.abs(p.x-uno.inicio.x)>Math.abs(p.y-uno.inicio.y)*1.6?'x':Math.abs(p.y-uno.inicio.y)>Math.abs(p.x-uno.inicio.x)*1.6?'y':'libre';if(uno.estado==='drag'||uno.armado){o.pointer('dragstart',uno.r);uno.drag=true;}}
      if(uno.estado==='scroll'){
        const ganancia=o.sensibilidad?.()||1.2,primero=comenzo;
        let sx=-(primero?p.x-uno.inicio.x:dx)*ganancia,sy=-(primero?p.y-uno.inicio.y:dy)*ganancia;
        if(uno.eje==='x')sy=0;if(uno.eje==='y')sx=0;
        acumular(sx,sy);uno.vx=clamp(uno.vx*.6+sx/dt*.4,-3,3);uno.vy=clamp(uno.vy*.6+sy/dt*.4,-3,3);
      }else if(uno.estado==='cursor'){
        const b=o.camara.box(),z=o.camara.estado().z;
        const delta=o.vector(dx/(b.w*z),dy/(b.h*z));cursor={x:clamp(cursor.x+delta.x*1.25,0,1),y:clamp(cursor.y+delta.y*1.25,0,1)};
        uno.ultimoRemoto={...cursor};o.revelar?.(cursor);o.pointer('move',cursor,{},!sujeto);pintar();
      }else if(uno.estado==='drag'){uno.ultimoRemoto=remoto(p);o.pointer('move',uno.ultimoRemoto,{},true);}
      uno.ultimo=p;uno.ultimoT=t;
    }
    function up(e,cancelado=false){
      if(!dedos.has(e.pointerId))return;dedos.delete(e.pointerId);clearTimeout(largo);
      if(bloqueado){dos=null;if(parejaTap){const origen=parejaTap.puntos.get(e.pointerId);if(cancelado||(origen&&Math.hypot(e.clientX-origen.x,e.clientY-origen.y)>10))parejaTap.valido=false;if(parejaTap.salida===null)parejaTap.salida=now();}
        if(!dedos.size){bloqueado=false;const p=parejaTap;parejaTap=null;if(p&&p.valido&&now()-p.t<260&&now()-p.salida<140){if(toqueDoble&&now()-toqueDoble.t<380&&Math.hypot(p.c.x-toqueDoble.c.x,p.c.y-toqueDoble.c.y)<50){o.camara.reset();pintar();toqueDoble=null;}else toqueDoble={t:now(),c:p.c};}else toqueDoble=null;}return;}
      if(!uno)return;const u=uno;uno=null;
      if(u.drag)o.pointer('up',o.modo()==='trackpad'?cursor:remoto(pos(e)));
      if(cancelado){parar();soltar();return;}
      if(u.estado==='pendiente'&&now()-u.t<340&&u.viaje<6&&!sujeto){o.pointer('tap',u.r);ultimoTap={t:now(),p:pos(e)};toqueDoble=null;}
      if(u.estado==='scroll'){
        caf(frame);frame=0;emitir();if(now()-u.ultimoT>80)return;
        let vx=u.vx,vy=u.vy,antes=now();const anchor={...ancla};
        function tick(t){const dt=Math.min(32,Math.max(0,t-antes));antes=t;const f=Math.exp(-dt/180);vx*=f;vy*=f;if(Math.hypot(vx,vy)<.025)return;o.scroll(vx*dt,vy*dt,anchor);inercia=raf(tick);}
        if(Math.hypot(vx,vy)>.1)inercia=raf(tick);
      }
    }
    return{down,move,up,cancelar,parar,arrastre,cursor:()=>({...cursor}),pintar,clicDerecho:()=>o.pointer('tap',cursor,{button:'right'}),sujeto:()=>sujeto};
  }
  return{crearCamara,crearGestos};
});

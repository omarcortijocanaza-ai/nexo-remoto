'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {crearCamara,crearGestos}=require('../ui/control-tactil');
function prueba(t,modo='navigate'){
  let tiempo=0,id=0;const callbacks=new Map(),eventos=[];
  const camara=crearCamara(()=>({left:0,top:0,width:800,height:450}),()=>16/9);
  const g=crearGestos({camara,modo:()=>modo,remoto:p=>p,vector:(x,y)=>({x,y}),now:()=>tiempo,raf:f=>{callbacks.set(++id,f);return id;},caf:i=>callbacks.delete(i),pointer:(a,p,extra)=>eventos.push({a,p:{...p},extra}),scroll:(x,y,p)=>eventos.push({a:'scroll',x,y,p:{...p}})});
  t.after(()=>g.cancelar());
  return{g,camara,eventos,e:(i,x,y)=>({pointerId:i,clientX:x,clientY:y}),avanzar(ms=16){tiempo+=ms;const q=[...callbacks.values()];callbacks.clear();q.forEach(f=>f(tiempo));},tiempo:ms=>tiempo+=ms};
}
test('cámara: ampliar mantiene el punto bajo los dedos y convierte clics inversamente',()=>{
  const c=crearCamara(()=>({left:10,top:20,width:800,height:450}),()=>16/9),p={x:310,y:220},antes=c.punto(p);
  c.gesto(c.estado(),p,100,p,200);const despues=c.punto(p);
  assert.ok(Math.abs(antes.x-despues.x)<1e-8);assert.ok(Math.abs(antes.y-despues.y)<1e-8);
  const q=c.posicion(despues);assert.ok(Math.abs(q.x+10-p.x)<1e-8);c.reset();assert.deepEqual(c.estado(),{z:1,x:0,y:0});
});
test('cámara acepta DOMRect con medidas no enumerables como las del navegador',()=>{
  const rect=Object.create({left:0,top:0,width:800,height:450});
  let cambio;const c=crearCamara(()=>rect,()=>16/9,s=>cambio=s);c.reset();
  assert.ok(Number.isFinite(cambio.x)&&Number.isFinite(cambio.y));assert.deepEqual(c.punto({x:400,y:225}),{x:.5,y:.5});
});
test('cámara: respeta límites, barras negras y reajuste al cambiar tamaño',()=>{
  const c=crearCamara(()=>({left:0,top:0,width:400,height:800}),()=>16/9);
  c.set({z:9,x:99999,y:99999});assert.equal(c.estado().z,4);assert.equal(c.estado().x,600);assert.equal(c.estado().y,50);
  assert.equal(c.punto({x:0,y:0}).x,0);c.reset();assert.equal(c.estado().y,0);
});
test('dos dedos amplían y encuadran sin emitir clic, scroll ni arrastre',t=>{
  const h=prueba(t),{g,e}=h;g.down(e(1,300,200));g.down(e(2,500,200));g.move(e(2,600,220));g.up(e(2,600,220));g.move(e(1,350,200));g.up(e(1,350,200));
  assert.ok(h.camara.estado().z>1);assert.equal(h.eventos.length,0);
});
test('teclado conserva el tamaño de lectura al reducir el espacio visible y al cerrarse',()=>{
  let alto=450;const c=crearCamara(()=>({left:0,top:0,width:800,height:alto}),()=>16/9);
  c.reset();const antes=c.box().w*c.estado().z;alto=250;c.ajustar(true);assert.ok(Math.abs(c.box().w*c.estado().z-antes)<1e-8);
  alto=450;c.ajustar(true);assert.equal(c.estado().z,1);
});
test('segundo dedo libera un arrastre remoto y no transforma el dedo restante en clic',t=>{
  const h=prueba(t,'direct'),{g,e}=h;g.down(e(1,100,100));g.move(e(1,130,100));g.down(e(2,250,100));g.up(e(1,130,100));g.up(e(2,250,100));
  assert.deepEqual(h.eventos.map(x=>x.a),['dragstart','move','up']);
});
test('scroll conserva el destino inicial, acumula el umbral y se detiene al tocar',t=>{
  const h=prueba(t),{g,e}=h;g.down(e(1,200,100));h.tiempo(10);g.move(e(1,200,103));h.tiempo(10);g.move(e(1,200,120));h.avanzar();g.up(e(1,200,120));h.avanzar();
  const scrolls=h.eventos.filter(x=>x.a==='scroll');assert.ok(scrolls.length);assert.equal(scrolls[0].y,-24);assert.ok(scrolls.every(s=>s.p.x===.25&&s.p.y===100/450));
  g.down(e(2,200,120));const n=h.eventos.length;h.avanzar(50);assert.equal(h.eventos.length,n);
});
test('scroll no produce inercia si se mantuvo quieto antes de soltar',t=>{
  const h=prueba(t),{g,e}=h;g.down(e(1,200,100));h.tiempo(16);g.move(e(1,200,140));h.avanzar();h.tiempo(100);g.up(e(1,200,140));const n=h.eventos.length;h.avanzar(50);assert.equal(h.eventos.length,n);
});
test('touchpad mueve relativamente, toca para clic y suelta arrastre al cancelar',t=>{
  const h=prueba(t,'trackpad'),{g,e}=h;g.down(e(1,20,20));g.move(e(1,100,20));g.up(e(1,100,20));assert.ok(g.cursor().x>.5);assert.equal(g.cursor().y,.5);
  g.down(e(1,700,300));g.up(e(1,700,300));assert.equal(h.eventos.at(-1).a,'tap');assert.equal(h.eventos.at(-1).p.x,g.cursor().x);
  g.arrastre();g.down(e(1,200,100));g.move(e(1,250,110));g.cancelar();assert.equal(h.eventos.at(-1).a,'up');assert.equal(g.sujeto(),false);
});
test('tercer dedo y pointercancel nunca generan un clic fantasma',t=>{
  const h=prueba(t),{g,e}=h;for(let i=1;i<=3;i++)g.down(e(i,100*i,100));for(let i=1;i<=3;i++)g.up(e(i,100*i,100),true);assert.equal(h.eventos.length,0);
  g.down(e(1,200,100));g.up(e(1,200,100),true);assert.equal(h.eventos.length,0);
});
function toqueDos(h,x=300){const{g,e}=h;g.down(e(1,x,150));h.tiempo(25);g.down(e(2,x+100,150));h.tiempo(50);g.up(e(1,x,150));h.tiempo(20);g.up(e(2,x+100,150));}
test('doble toque con dos dedos restablece cámara sin clics remotos',t=>{
  const h=prueba(t);h.camara.set({z:3,x:100,y:50});toqueDos(h);h.tiempo(120);toqueDos(h);
  assert.deepEqual(h.camara.estado(),{z:1,x:0,y:0});assert.equal(h.eventos.length,0);
});
test('un toque de dos dedos, dos lentos o dos distantes no restablecen el zoom',t=>{
  const h=prueba(t);h.camara.set({z:2,x:0,y:0});toqueDos(h);assert.equal(h.camara.estado().z,2);h.tiempo(500);toqueDos(h);assert.equal(h.camara.estado().z,2);h.tiempo(100);toqueDos(h,500);assert.equal(h.camara.estado().z,2);
});
test('un pellizco no se confunde con el doble toque de restablecer',t=>{
  const h=prueba(t);h.camara.set({z:2,x:0,y:0});toqueDos(h);h.tiempo(80);const{g,e}=h;g.down(e(1,300,150));g.down(e(2,400,150));g.move(e(2,440,150));g.up(e(1,300,150));g.up(e(2,440,150));assert.ok(h.camara.estado().z>2);
});
test('touchpad arrastra con doble toque y movimiento, sin botones flotantes',t=>{
  const h=prueba(t,'trackpad'),{g,e}=h;g.down(e(1,100,100));g.up(e(1,100,100));h.tiempo(100);g.down(e(1,100,100));g.move(e(1,140,110));g.up(e(1,140,110));
  assert.deepEqual(h.eventos.map(e=>e.a),['tap','dragstart','move','up']);assert.equal(h.eventos.at(-1).p.x,g.cursor().x);
});

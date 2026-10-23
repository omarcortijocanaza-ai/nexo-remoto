/* Panel de NEXO · apariencia antes del primer pintado.
 * El servidor del panel pone en <html> data-tema (uno de los cinco) y data-pref (auto | claro | oscuro)
 * leyéndolos de .nexo-apariencia.json. Este script va en <head>, sin async ni defer, y por eso se ejecuta
 * ANTES de pintar: resuelve «auto» con prefers-color-scheme y fija data-modo (claro | oscuro) para que
 * nunca se vea un destello del tema equivocado. Después panel.js lo reutiliza para cambiar al instante,
 * sin recargar, cuando el dueño elige otra apariencia. Archivo aparte porque la política de seguridad
 * del panel (script-src 'self') no permite scripts en línea. */
(function () {
  'use strict';
  var raiz = document.documentElement;
  var TEMAS = ['cabina', 'nativa', 'reymuerto', 'cianotipo', 'bloque'];
  var oscuro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function modoEfectivo(pref) {
    if (pref === 'claro' || pref === 'oscuro') return pref;
    return oscuro && oscuro.matches ? 'oscuro' : 'claro';
  }

  function aplicar() {
    var modo = modoEfectivo(raiz.getAttribute('data-pref'));
    raiz.setAttribute('data-modo', modo);
    // Las vistas previas de la vista «Apariencia» llevan su propio data-modo (las variables de cada
    // tema cuelgan de [data-tema][data-modo]); se mantienen al día con el modo efectivo.
    var previas = document.querySelectorAll('.vp');
    for (var i = 0; i < previas.length; i++) previas[i].setAttribute('data-modo', modo);
    return modo;
  }

  // Valores de reserva si el servidor no inyectó nada (por ejemplo, abriendo el HTML suelto).
  if (TEMAS.indexOf(raiz.getAttribute('data-tema')) < 0) raiz.setAttribute('data-tema', 'reymuerto');
  if (['auto', 'claro', 'oscuro'].indexOf(raiz.getAttribute('data-pref')) < 0) raiz.setAttribute('data-pref', 'auto');
  aplicar();

  function alCambiarElSistema() {
    if (raiz.getAttribute('data-pref') === 'auto') aplicar();
  }
  if (oscuro) {
    if (oscuro.addEventListener) oscuro.addEventListener('change', alCambiarElSistema);
    else if (oscuro.addListener) oscuro.addListener(alCambiarElSistema);
  }

  window.NEXO_TEMA = {
    temas: TEMAS,
    // Cambia tema y preferencia de modo al instante. Devuelve el modo efectivo.
    poner: function (tema, pref) {
      if (TEMAS.indexOf(tema) >= 0) raiz.setAttribute('data-tema', tema);
      if (['auto', 'claro', 'oscuro'].indexOf(pref) >= 0) raiz.setAttribute('data-pref', pref);
      return aplicar();
    },
    refrescarPrevias: aplicar,
  };

  // Las vistas previas existen sólo cuando el cuerpo ya se leyó.
  document.addEventListener('DOMContentLoaded', aplicar);
})();

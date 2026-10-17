'use strict';

// Ajustes que el panel de NEXO guarda en `<estado>\.nexo-settings.json` y que el
// lanzador lee al arrancar. Una variable de entorno explícita (NEXO_MODE,
// NEXO_GPU, NEXO_MIC_DEVICE) siempre gana sobre el archivo: así una prueba o un
// servicio pueden forzar un valor sin que el panel lo pise.
//
// El panel (Go, native/tray/ajustes.go) valida con las mismas reglas.

const path = require('path');
const { readJsonSafe } = require('./safe');

const NOMBRE_ARCHIVO = '.nexo-settings.json';
const MODOS = ['both', 'local', 'remote'];
const POR_DEFECTO = Object.freeze({ modo: 'both', gpu: true, micDispositivo: 'CABLE Input' });
const MAX_MIC = 80;

// Devuelve siempre un objeto completo y válido: lo ausente o inválido toma el valor por defecto.
function normalizar(crudo) {
  const origen = crudo && typeof crudo === 'object' ? crudo : {};
  const modo = MODOS.includes(origen.modo) ? origen.modo : POR_DEFECTO.modo;
  const gpu = typeof origen.gpu === 'boolean' ? origen.gpu : POR_DEFECTO.gpu;
  const mic = typeof origen.micDispositivo === 'string' ? origen.micDispositivo.trim().slice(0, MAX_MIC) : '';
  return { modo, gpu, micDispositivo: mic || POR_DEFECTO.micDispositivo };
}

function leerAjustes(stateDir) {
  return normalizar(readJsonSafe(path.join(stateDir, NOMBRE_ARCHIVO), {}));
}

// Variables de entorno que el lanzador debe añadir a sus hijos según los ajustes,
// respetando las que ya estén definidas en el entorno.
function entornoDeAjustes(ajustes, entorno = process.env) {
  const extra = {};
  if (entorno.NEXO_GPU === undefined && ajustes.gpu === false) extra.NEXO_GPU = '0';
  if (entorno.NEXO_MIC_DEVICE === undefined && ajustes.micDispositivo !== POR_DEFECTO.micDispositivo) extra.NEXO_MIC_DEVICE = ajustes.micDispositivo;
  return extra;
}

module.exports = { NOMBRE_ARCHIVO, MODOS, POR_DEFECTO, normalizar, leerAjustes, entornoDeAjustes };

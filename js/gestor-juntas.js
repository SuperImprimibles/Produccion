const GestorJuntas = (function() {
  'use strict';

  const STORAGE_KEY = 'superimprimible_juntas';

  // ── Detección temprana de localStorage deshabilitado ────────────────────
  let _storageDisabled = false;
  try {
    // Acceso de prueba para detectar SecurityError (política del navegador)
    localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    _storageDisabled = true;
    console.error('[GestorJuntas] localStorage no está disponible:', e);
  }

  // ── Helpers privados ────────────────────────────────────────────────────

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  function buildFallbackName(nombreCumpleanero, fechaEvento) {
    const fecha = fechaEvento || '';
    return `${nombreCumpleanero} - ${fecha}`;
  }

  // ── Serialización / Deserialización ────────────────────────────────────

  function serializeJuntas(juntas) {
    return JSON.stringify(juntas);
  }

  function deserializeJuntas(raw) {
    const parsed = JSON.parse(raw); // puede lanzar SyntaxError
    if (!Array.isArray(parsed)) throw new TypeError('Formato inválido');
    return parsed;
  }

  // ── Validación de forma de objeto Junta ────────────────────────────────

  function validateJuntaShape(obj) {
    if (!obj || typeof obj !== 'object') throw new TypeError('No es un objeto');
    const required = [
      'id', 'nombre', 'nombreCumpleanero', 'edad',
      'lugarEvento', 'fechaEvento', 'horaEvento', 'createdAt'
    ];
    for (const key of required) {
      if (!(key in obj)) throw new TypeError(`Falta campo: ${key}`);
    }
  }

  // ── Lectura desde localStorage ─────────────────────────────────────────

  function readAll() {
    if (_storageDisabled) return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    let entries;
    try {
      entries = deserializeJuntas(raw);
    } catch (e) {
      console.error('[GestorJuntas] Error al deserializar el array principal:', e);
      return [];
    }
    // Filtrar entradas individuales corruptas
    return entries.filter(function(entry) {
      try {
        validateJuntaShape(entry);
        return true;
      } catch (e) {
        console.error('[GestorJuntas] Entrada corrupta ignorada:', entry, e);
        return false;
      }
    });
  }

  // ── API Pública ────────────────────────────────────────────────────────

  function listJuntas() {
    return readAll().sort(function(a, b) { return b.createdAt - a.createdAt; });
  }

  function saveJunta(formData, nombreDescriptivo) {
    if (_storageDisabled) throw new Error('localStorage no disponible');
    var junta = {
      id: generateId(),
      nombre: nombreDescriptivo,
      nombreCumpleanero: formData.nombreCumpleanero,
      edad: formData.edad,
      lugarEvento: formData.lugarEvento,
      fechaEvento: formData.fechaEvento,
      horaEvento: formData.horaEvento,
      createdAt: Date.now()
    };
    var juntas = readAll();
    juntas.push(junta);
    try {
      localStorage.setItem(STORAGE_KEY, serializeJuntas(juntas));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        throw new Error('QUOTA_EXCEEDED');
      }
      throw e;
    }
    return junta;
  }

  function loadJunta(id) {
    var juntas = readAll();
    return juntas.find(function(j) { return j.id === id; }) || null;
  }

  function deleteJunta(id) {
    if (_storageDisabled) return;
    var juntas = readAll().filter(function(j) { return j.id !== id; });
    localStorage.setItem(STORAGE_KEY, serializeJuntas(juntas));
  }

  return {
    listJuntas,
    saveJunta,
    loadJunta,
    deleteJunta,
    buildFallbackName,
    generateId
  };
})();

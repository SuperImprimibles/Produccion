const GestorFuentes = (function() {
  'use strict';

  const STORAGE_KEY = 'superimprimible_fuentes';
  const SIZE_WARNING_BYTES = 4 * 1024 * 1024; // 4 MB

  // ── Detección temprana de localStorage deshabilitado ────────────────────
  let _storageDisabled = false;
  try {
    localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    _storageDisabled = true;
    console.error('[GestorFuentes] localStorage no disponible:', e);
  }

  // ── Helpers privados ────────────────────────────────────────────────────

  function validateShape(obj) {
    if (!obj || typeof obj !== 'object') throw new TypeError('No es un objeto');
    const required = ['id', 'nombre', 'fechaCreacion', 'version', 'caracteres'];
    for (const key of required) {
      if (!(key in obj)) throw new TypeError(`Falta campo: ${key}`);
    }
    // Validar tipos básicos
    if (typeof obj.id !== 'string') throw new TypeError('id debe ser string');
    if (typeof obj.nombre !== 'string') throw new TypeError('nombre debe ser string');
    if (typeof obj.fechaCreacion !== 'string') throw new TypeError('fechaCreacion debe ser string');
    if (typeof obj.version !== 'number' || obj.version < 1) throw new TypeError('version debe ser number >= 1');
    if (typeof obj.caracteres !== 'object') throw new TypeError('caracteres debe ser object');
  }

  function readAll() {
    if (_storageDisabled) return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch (e) {
      console.error('[GestorFuentes] Error al parsear JSON:', e);
      return [];
    }
    if (!Array.isArray(entries)) return [];
    // Filtrar entradas individuales corruptas
    return entries.filter(function(entry) {
      try {
        validateShape(entry);
        return true;
      } catch (e) {
        console.error('[GestorFuentes] Entrada corrupta ignorada:', entry, e);
        return false;
      }
    });
  }

  function _emitirEvento() {
    window.dispatchEvent(new CustomEvent('superimprimible:fuentes-updated'));
  }

  function _notificarAlmacenamientoLleno() {
    console.warn('[GestorFuentes] Almacenamiento casi lleno (>= 4 MB)');
  }

  // ── API Pública ────────────────────────────────────────────────────────

  function calcularTamano() {
    const raw = localStorage.getItem(STORAGE_KEY) || '';
    return new Blob([raw]).size;
  }

  function listar() {
    return readAll().sort(function(a, b) {
      // Ordenar por fechaCreacion descendente
      return new Date(b.fechaCreacion) - new Date(a.fechaCreacion);
    });
  }

  function obtener(id) {
    var fuentes = readAll();
    return fuentes.find(function(p) { return p.id === id; }) || null;
  }

  function eliminar(id) {
    if (_storageDisabled) return;
    var fuentes = readAll().filter(function(p) { return p.id !== id; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fuentes));
    _emitirEvento();
  }

  function guardar(datos) {
    if (_storageDisabled) throw new Error('STORAGE_DISABLED');

    // Validar nombre no vacío
    var nombre = (datos.nombre || '').trim();
    if (!nombre) throw new Error('NOMBRE_VACIO');

    // Validar que hay caracteres
    if (!datos.caracteres || Object.keys(datos.caracteres).length === 0) {
      throw new Error('CARACTERES_VACIOS');
    }

    var fuentes = readAll();
    
    // Buscar entrada existente por nombre (case-insensitive upsert)
    var nombreLower = nombre.toLowerCase();
    var existing = fuentes.find(function(p) {
      return p.nombre.toLowerCase() === nombreLower;
    });

    var fuente;
    if (existing) {
      // Upsert: preservar id, incrementar version
      fuente = {
        id: existing.id,
        nombre: nombre,
        caracteres: datos.caracteres, // { 'A': 'data:image/png;base64,...', 'B': '...', ... }
        preview: datos.preview || existing.preview, // Vista previa del nombre renderizado
        fechaCreacion: existing.fechaCreacion,
        version: existing.version + 1,
        // Metadatos opcionales
        categoria: datos.categoria || existing.categoria,
        tintColor: datos.tintColor || existing.tintColor
      };
      // Reemplazar en el array
      var idx = fuentes.findIndex(function(p) { return p.id === existing.id; });
      fuentes[idx] = fuente;
    } else {
      // Crear nuevo
      fuente = {
        id: 'fuente_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
        nombre: nombre,
        caracteres: datos.caracteres,
        preview: datos.preview || null,
        fechaCreacion: new Date().toISOString(),
        version: 1,
        // Metadatos opcionales
        categoria: datos.categoria || 'Fuentes',
        tintColor: datos.tintColor || null
      };
      fuentes.push(fuente);
    }

    // Escribir en localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fuentes));
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        throw new Error('QUOTA_EXCEEDED');
      }
      throw e;
    }

    _emitirEvento();

    // Verificar tamaño y notificar si >= 4 MB
    if (calcularTamano() >= SIZE_WARNING_BYTES) {
      _notificarAlmacenamientoLleno();
    }

    return fuente;
  }

  return {
    guardar: guardar,
    listar: listar,
    obtener: obtener,
    eliminar: eliminar,
    calcularTamano: calcularTamano
  };
})();

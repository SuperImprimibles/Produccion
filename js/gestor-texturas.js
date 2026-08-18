const GestorTexturas = (function() {
  'use strict';

  const STORAGE_KEY = 'superimprimible_texturas';
  const SIZE_WARNING_BYTES = 4 * 1024 * 1024; // 4 MB

  // ── Detección temprana de localStorage deshabilitado ────────────────────
  let _storageDisabled = false;
  try {
    localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    _storageDisabled = true;
    console.error('[GestorTexturas] localStorage no disponible:', e);
  }

  // ── Helpers privados ────────────────────────────────────────────────────

  function validateShape(obj) {
    if (!obj || typeof obj !== 'object') throw new TypeError('No es un objeto');
    const required = ['id', 'nombre', 'preview', 'fechaCreacion', 'version'];
    for (const key of required) {
      if (!(key in obj)) throw new TypeError(`Falta campo: ${key}`);
    }
    // Validar tipos básicos
    if (typeof obj.id !== 'string') throw new TypeError('id debe ser string');
    if (typeof obj.nombre !== 'string') throw new TypeError('nombre debe ser string');
    if (typeof obj.preview !== 'string') throw new TypeError('preview debe ser string');
    if (typeof obj.fechaCreacion !== 'string') throw new TypeError('fechaCreacion debe ser string');
    if (typeof obj.version !== 'number' || obj.version < 1) throw new TypeError('version debe ser number >= 1');
  }

  function readAll() {
    if (_storageDisabled) return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    let entries;
    try {
      entries = JSON.parse(raw);
    } catch (e) {
      console.error('[GestorTexturas] Error al parsear JSON:', e);
      return [];
    }
    if (!Array.isArray(entries)) return [];
    // Filtrar entradas individuales corruptas
    return entries.filter(function(entry) {
      try {
        validateShape(entry);
        return true;
      } catch (e) {
        console.error('[GestorTexturas] Entrada corrupta ignorada:', entry, e);
        return false;
      }
    });
  }

  function _emitirEvento() {
    window.dispatchEvent(new CustomEvent('superimprimible:texturas-updated'));
  }

  function _notificarAlmacenamientoLleno() {
    console.warn('[GestorTexturas] Almacenamiento casi lleno (>= 4 MB)');
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
    var texturas = readAll();
    return texturas.find(function(p) { return p.id === id; }) || null;
  }

  function eliminar(id) {
    if (_storageDisabled) return;
    var texturas = readAll().filter(function(p) { return p.id !== id; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(texturas));
    _emitirEvento();
  }

  function guardar(datos) {
    if (_storageDisabled) throw new Error('STORAGE_DISABLED');

    // Validar nombre no vacío
    var nombre = (datos.nombre || '').trim();
    if (!nombre) throw new Error('NOMBRE_VACIO');

    var texturas = readAll();
    
    // Buscar entrada existente por nombre (case-insensitive upsert)
    var nombreLower = nombre.toLowerCase();
    var existing = texturas.find(function(p) {
      return p.nombre.toLowerCase() === nombreLower;
    });

    var textura;
    if (existing) {
      // Upsert: preservar id, incrementar version
      textura = {
        id: existing.id,
        nombre: nombre,
        preview: datos.preview,
        fechaCreacion: existing.fechaCreacion,
        version: existing.version + 1,
        // Metadatos opcionales (incluye subcategoría)
        categoria: datos.categoria || existing.categoria,
        subcategoria: datos.subcategoria || existing.subcategoria,
        medidas: datos.medidas || existing.medidas,
        tolerance: datos.tolerance || existing.tolerance
      };
      // Reemplazar en el array
      var idx = texturas.findIndex(function(p) { return p.id === existing.id; });
      texturas[idx] = textura;
    } else {
      // Crear nuevo
      textura = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        nombre: nombre,
        preview: datos.preview,
        fechaCreacion: new Date().toISOString(),
        version: 1,
        // Metadatos opcionales (incluye subcategoría)
        categoria: datos.categoria || 'Sin categoría',
        subcategoria: datos.subcategoria || '',
        medidas: datos.medidas || null,
        tolerance: datos.tolerance || null
      };
      texturas.push(textura);
    }

    // Escribir en localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(texturas));
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

    return textura;
  }

  return {
    guardar: guardar,
    listar: listar,
    obtener: obtener,
    eliminar: eliminar,
    calcularTamano: calcularTamano
  };
})();

const GestorPlantillas = (function() {
  'use strict';

  const STORAGE_KEY = 'superimprimible_plantillas';
  const SIZE_WARNING_BYTES = 4 * 1024 * 1024; // 4 MB
  const CATEGORIAS_VALIDAS = ['Invitaciones', 'Deco', 'Candy Bar', 'Juegos'];

  // ── Detección temprana de localStorage deshabilitado ────────────────────
  let _storageDisabled = false;
  try {
    localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    _storageDisabled = true;
    console.error('[GestorPlantillas] localStorage no disponible:', e);
  }

  // ── Helpers privados ────────────────────────────────────────────────────

  function validateShape(obj) {
    if (!obj || typeof obj !== 'object') throw new TypeError('No es un objeto');
    const required = ['id', 'nombre', 'categoria', 'preview', 'regiones', 'fechaCreacion', 'version'];
    for (const key of required) {
      if (!(key in obj)) throw new TypeError(`Falta campo: ${key}`);
    }
    // Validar categoria
    if (!CATEGORIAS_VALIDAS.includes(obj.categoria)) {
      throw new TypeError(`Categoría inválida: ${obj.categoria}`);
    }
    // Validar tipos básicos
    if (typeof obj.id !== 'string') throw new TypeError('id debe ser string');
    if (typeof obj.nombre !== 'string') throw new TypeError('nombre debe ser string');
    if (typeof obj.preview !== 'string') throw new TypeError('preview debe ser string');
    if (!Array.isArray(obj.regiones)) throw new TypeError('regiones debe ser array');
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
      console.error('[GestorPlantillas] Error al parsear JSON:', e);
      return [];
    }
    if (!Array.isArray(entries)) return [];
    // Filtrar entradas individuales corruptas
    return entries.filter(function(entry) {
      try {
        validateShape(entry);
        return true;
      } catch (e) {
        console.error('[GestorPlantillas] Entrada corrupta ignorada:', entry, e);
        return false;
      }
    });
  }

  function _emitirEvento() {
    window.dispatchEvent(new CustomEvent('superimprimible:plantillas-updated'));
  }

  function _notificarAlmacenamientoLleno() {
    // Este método será llamado desde la UI cuando se detecte el límite de 4 MB
    console.warn('[GestorPlantillas] Almacenamiento casi lleno (>= 4 MB)');
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
    var plantillas = readAll();
    return plantillas.find(function(p) { return p.id === id; }) || null;
  }

  function eliminar(id) {
    if (_storageDisabled) return;
    var plantillas = readAll().filter(function(p) { return p.id !== id; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plantillas));
    _emitirEvento();
  }

  function guardar(datos) {
    if (_storageDisabled) throw new Error('STORAGE_DISABLED');

    // Validar nombre no vacío
    var nombre = (datos.nombre || '').trim();
    if (!nombre) throw new Error('NOMBRE_VACIO');

    var plantillas = readAll();
    
    // Buscar entrada existente por nombre (case-insensitive upsert)
    var nombreLower = nombre.toLowerCase();
    var existing = plantillas.find(function(p) {
      return p.nombre.toLowerCase() === nombreLower;
    });

    var plantilla;
    if (existing) {
      // Upsert: preservar id, incrementar version
      plantilla = {
        id: existing.id,
        nombre: nombre,
        categoria: datos.categoria,
        preview: datos.preview,
        regiones: datos.regiones || [],
        fechaCreacion: existing.fechaCreacion,
        version: existing.version + 1
      };
      // Reemplazar en el array
      var idx = plantillas.findIndex(function(p) { return p.id === existing.id; });
      plantillas[idx] = plantilla;
    } else {
      // Crear nuevo
      plantilla = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        nombre: nombre,
        categoria: datos.categoria,
        preview: datos.preview,
        regiones: datos.regiones || [],
        fechaCreacion: new Date().toISOString(),
        version: 1
      };
      plantillas.push(plantilla);
    }

    // Escribir en localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plantillas));
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

    return plantilla;
  }

  return {
    guardar: guardar,
    listar: listar,
    obtener: obtener,
    eliminar: eliminar,
    calcularTamano: calcularTamano
  };
})();

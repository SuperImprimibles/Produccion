const GestorElementos = (function() {
  'use strict';

  console.log('[GestorElementos] Módulo cargado - usando almacenamiento en servidor');

  const API_URL = 'http://localhost:3000/api/elementos';
  const SIZE_WARNING_BYTES = 4 * 1024 * 1024; // 4 MB

  // ── API Pública ────────────────────────────────────────────────────────

  async function listar() {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error('Error al cargar elementos');
      const elementos = await response.json();
      return elementos.sort(function(a, b) {
        return new Date(b.fechaCreacion) - new Date(a.fechaCreacion);
      });
    } catch (error) {
      console.error('[GestorElementos] Error al listar:', error);
      return [];
    }
  }

  async function obtener(id) {
    try {
      const elementos = await listar();
      return elementos.find(function(p) { return p.id === id; }) || null;
    } catch (error) {
      console.error('[GestorElementos] Error al obtener:', error);
      return null;
    }
  }

  async function eliminar(id) {
    try {
      const response = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Error al eliminar elemento');
      window.dispatchEvent(new CustomEvent('superimprimible:elementos-updated'));
      return true;
    } catch (error) {
      console.error('[GestorElementos] Error al eliminar:', error);
      return false;
    }
  }

  async function guardar(datos) {
    // Validar nombre no vacío
    var nombre = (datos.nombre || '').trim();
    if (!nombre) throw new Error('NOMBRE_VACIO');

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          preview: datos.preview,
          categoria: datos.categoria || 'Sin categoría',
          tolerance: datos.tolerance || null,
          medidas: datos.medidas || null
        })
      });

      if (!response.ok) throw new Error('Error al guardar elemento');
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Error desconocido');

      window.dispatchEvent(new CustomEvent('superimprimible:elementos-updated'));
      
      return result.elemento;
    } catch (error) {
      console.error('[GestorElementos] Error al guardar:', error);
      if (error.message.includes('Failed to fetch')) {
        throw new Error('SERVIDOR_NO_DISPONIBLE');
      }
      throw error;
    }
  }

  function calcularTamano() {
    // Esta función ya no es relevante con almacenamiento en servidor
    return 0;
  }

  return {
    guardar: guardar,
    listar: listar,
    obtener: obtener,
    eliminar: eliminar,
    calcularTamano: calcularTamano
  };
})();

// Exportar al scope global
window.GestorElementos = GestorElementos;

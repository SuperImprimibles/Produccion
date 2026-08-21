const GestorTexturas = (function() {
  'use strict';

  console.log('[GestorTexturas] Módulo cargado - usando almacenamiento en servidor');

  const API_URL = 'http://localhost:3000/api/texturas';

  async function listar() {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error('Error al cargar texturas');
      const texturas = await response.json();
      return texturas.sort(function(a, b) {
        return new Date(b.fechaCreacion) - new Date(a.fechaCreacion);
      });
    } catch (error) {
      console.error('[GestorTexturas] Error al listar:', error);
      return [];
    }
  }

  async function obtener(id) {
    try {
      const texturas = await listar();
      return texturas.find(function(p) { return p.id === id; }) || null;
    } catch (error) {
      console.error('[GestorTexturas] Error al obtener:', error);
      return null;
    }
  }

  async function eliminar(id) {
    try {
      const response = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Error al eliminar textura');
      window.dispatchEvent(new CustomEvent('superimprimible:texturas-updated'));
      return true;
    } catch (error) {
      console.error('[GestorTexturas] Error al eliminar:', error);
      return false;
    }
  }

  async function guardar(datos) {
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
          subcategoria: datos.subcategoria || '',
          tolerance: datos.tolerance || null,
          medidas: datos.medidas || null
        })
      });

      if (!response.ok) throw new Error('Error al guardar textura');
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Error desconocido');

      window.dispatchEvent(new CustomEvent('superimprimible:texturas-updated'));
      
      return result.textura;
    } catch (error) {
      console.error('[GestorTexturas] Error al guardar:', error);
      if (error.message.includes('Failed to fetch')) {
        throw new Error('SERVIDOR_NO_DISPONIBLE');
      }
      throw error;
    }
  }

  function calcularTamano() {
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
window.GestorTexturas = GestorTexturas;

const GestorFuentes = (function() {
  'use strict';

  console.log('[GestorFuentes] Módulo cargado - usando almacenamiento en servidor');

  const API_URL = 'http://localhost:3000/api/fuentes';

  async function listar() {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error('Error al cargar fuentes');
      const fuentes = await response.json();
      return fuentes.sort(function(a, b) {
        return new Date(b.fechaCreacion) - new Date(a.fechaCreacion);
      });
    } catch (error) {
      console.error('[GestorFuentes] Error al listar:', error);
      return [];
    }
  }

  async function obtener(id) {
    try {
      const fuentes = await listar();
      return fuentes.find(function(p) { return p.id === id; }) || null;
    } catch (error) {
      console.error('[GestorFuentes] Error al obtener:', error);
      return null;
    }
  }

  async function eliminar(id) {
    try {
      const response = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Error al eliminar fuente');
      window.dispatchEvent(new CustomEvent('superimprimible:fuentes-updated'));
      return true;
    } catch (error) {
      console.error('[GestorFuentes] Error al eliminar:', error);
      return false;
    }
  }

  async function guardar(datos) {
    var nombre = (datos.nombre || '').trim();
    if (!nombre) throw new Error('NOMBRE_VACIO');
    
    if (!datos.caracteres || Object.keys(datos.caracteres).length === 0) {
      throw new Error('CARACTERES_VACIOS');
    }

    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: nombre,
          caracteres: datos.caracteres,
          preview: datos.preview || null,
          categoria: datos.categoria || 'Fuentes',
          tintColor: datos.tintColor || null
        })
      });

      if (!response.ok) throw new Error('Error al guardar fuente');
      
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'Error desconocido');

      window.dispatchEvent(new CustomEvent('superimprimible:fuentes-updated'));
      
      return result.fuente;
    } catch (error) {
      console.error('[GestorFuentes] Error al guardar:', error);
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
window.GestorFuentes = GestorFuentes;

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'datos');

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Límite para imágenes base64
app.use(express.static(__dirname)); // Sirve archivos estáticos (HTML, CSS, JS)

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN: Crear carpeta de datos si no existe
// ═══════════════════════════════════════════════════════════════════════════
async function inicializarDatos() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // Crear archivos vacíos si no existen
    const archivos = ['elementos.json', 'texturas.json', 'fuentes.json', 'plantillas.json', 'tematicas.json'];
    for (const archivo of archivos) {
      const rutaArchivo = path.join(DATA_DIR, archivo);
      try {
        await fs.access(rutaArchivo);
      } catch {
        await fs.writeFile(rutaArchivo, '[]', 'utf8');
        console.log(`[Init] Creado archivo: ${archivo}`);
      }
    }
    console.log('[Init] Carpeta de datos inicializada:', DATA_DIR);
  } catch (error) {
    console.error('[Init] Error al inicializar datos:', error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS: Lectura/escritura de archivos JSON
// ═══════════════════════════════════════════════════════════════════════════
async function leerJSON(nombreArchivo) {
  try {
    const rutaArchivo = path.join(DATA_DIR, nombreArchivo);
    const contenido = await fs.readFile(rutaArchivo, 'utf8');
    return JSON.parse(contenido);
  } catch (error) {
    console.error(`[Error] Al leer ${nombreArchivo}:`, error.message);
    return [];
  }
}

async function escribirJSON(nombreArchivo, datos) {
  try {
    const rutaArchivo = path.join(DATA_DIR, nombreArchivo);
    await fs.writeFile(rutaArchivo, JSON.stringify(datos, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error(`[Error] Al escribir ${nombreArchivo}:`, error.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// API: ELEMENTOS
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/elementos - Listar todos los elementos
app.get('/api/elementos', async (req, res) => {
  const elementos = await leerJSON('elementos.json');
  res.json(elementos);
});

// POST /api/elementos - Guardar elemento (crear o actualizar)
app.post('/api/elementos', async (req, res) => {
  try {
    const nuevoElemento = req.body;
    const elementos = await leerJSON('elementos.json');
    
    // Buscar si existe por nombre (case-insensitive)
    const nombreLower = nuevoElemento.nombre.toLowerCase();
    const indiceExistente = elementos.findIndex(e => e.nombre.toLowerCase() === nombreLower);
    
    if (indiceExistente >= 0) {
      // Actualizar: preservar id, incrementar versión
      const existente = elementos[indiceExistente];
      elementos[indiceExistente] = {
        ...nuevoElemento,
        id: existente.id,
        fechaCreacion: existente.fechaCreacion,
        version: (existente.version || 1) + 1
      };
    } else {
      // Crear nuevo
      elementos.push({
        ...nuevoElemento,
        id: nuevoElemento.id || Date.now().toString(36) + Math.random().toString(36).slice(2),
        fechaCreacion: nuevoElemento.fechaCreacion || new Date().toISOString(),
        version: 1
      });
    }
    
    const guardado = await escribirJSON('elementos.json', elementos);
    if (guardado) {
      res.json({ success: true, elemento: elementos[indiceExistente >= 0 ? indiceExistente : elementos.length - 1] });
    } else {
      res.status(500).json({ success: false, error: 'Error al guardar' });
    }
  } catch (error) {
    console.error('[API] Error en POST /api/elementos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/elementos/:id - Eliminar elemento
app.delete('/api/elementos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const elementos = await leerJSON('elementos.json');
    const elementosFiltrados = elementos.filter(e => e.id !== id);
    
    const guardado = await escribirJSON('elementos.json', elementosFiltrados);
    if (guardado) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Error al eliminar' });
    }
  } catch (error) {
    console.error('[API] Error en DELETE /api/elementos:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// API: TEXTURAS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/texturas', async (req, res) => {
  const texturas = await leerJSON('texturas.json');
  res.json(texturas);
});

app.post('/api/texturas', async (req, res) => {
  try {
    const nuevaTextura = req.body;
    const texturas = await leerJSON('texturas.json');
    
    const nombreLower = nuevaTextura.nombre.toLowerCase();
    const indiceExistente = texturas.findIndex(t => t.nombre.toLowerCase() === nombreLower);
    
    if (indiceExistente >= 0) {
      const existente = texturas[indiceExistente];
      texturas[indiceExistente] = {
        ...nuevaTextura,
        id: existente.id,
        fechaCreacion: existente.fechaCreacion,
        version: (existente.version || 1) + 1
      };
    } else {
      texturas.push({
        ...nuevaTextura,
        id: nuevaTextura.id || Date.now().toString(36) + Math.random().toString(36).slice(2),
        fechaCreacion: nuevaTextura.fechaCreacion || new Date().toISOString(),
        version: 1
      });
    }
    
    const guardado = await escribirJSON('texturas.json', texturas);
    if (guardado) {
      res.json({ success: true, textura: texturas[indiceExistente >= 0 ? indiceExistente : texturas.length - 1] });
    } else {
      res.status(500).json({ success: false, error: 'Error al guardar' });
    }
  } catch (error) {
    console.error('[API] Error en POST /api/texturas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/texturas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const texturas = await leerJSON('texturas.json');
    const texturasFiltradas = texturas.filter(t => t.id !== id);
    
    const guardado = await escribirJSON('texturas.json', texturasFiltradas);
    if (guardado) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Error al eliminar' });
    }
  } catch (error) {
    console.error('[API] Error en DELETE /api/texturas:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// API: FUENTES
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/fuentes', async (req, res) => {
  const fuentes = await leerJSON('fuentes.json');
  res.json(fuentes);
});

app.post('/api/fuentes', async (req, res) => {
  try {
    const nuevaFuente = req.body;
    const fuentes = await leerJSON('fuentes.json');
    
    const nombreLower = nuevaFuente.nombre.toLowerCase();
    const indiceExistente = fuentes.findIndex(f => f.nombre.toLowerCase() === nombreLower);
    
    if (indiceExistente >= 0) {
      const existente = fuentes[indiceExistente];
      fuentes[indiceExistente] = {
        ...nuevaFuente,
        id: existente.id,
        fechaCreacion: existente.fechaCreacion,
        version: (existente.version || 1) + 1
      };
    } else {
      fuentes.push({
        ...nuevaFuente,
        id: nuevaFuente.id || 'fuente_' + Date.now().toString(36) + Math.random().toString(36).slice(2),
        fechaCreacion: nuevaFuente.fechaCreacion || new Date().toISOString(),
        version: 1
      });
    }
    
    const guardado = await escribirJSON('fuentes.json', fuentes);
    if (guardado) {
      res.json({ success: true, fuente: fuentes[indiceExistente >= 0 ? indiceExistente : fuentes.length - 1] });
    } else {
      res.status(500).json({ success: false, error: 'Error al guardar' });
    }
  } catch (error) {
    console.error('[API] Error en POST /api/fuentes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/fuentes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fuentes = await leerJSON('fuentes.json');
    const fuentesFiltradas = fuentes.filter(f => f.id !== id);
    
    const guardado = await escribirJSON('fuentes.json', fuentesFiltradas);
    if (guardado) {
      res.json({ success: true });
    } else {
      res.status(500).json({ success: false, error: 'Error al eliminar' });
    }
  } catch (error) {
    console.error('[API] Error en DELETE /api/fuentes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INICIAR SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════
inicializarDatos().then(() => {
  app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  🚀 Servidor SuperImprimible iniciado');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  📡 URL: http://localhost:${PORT}`);
    console.log(`  📁 Datos almacenados en: ${DATA_DIR}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  Presioná Ctrl+C para detener el servidor');
    console.log('═══════════════════════════════════════════════════════════════');
  });
});

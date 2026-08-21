# SuperImprimible - Backend con Almacenamiento Persistente

## ✅ Instalación Completa

El backend ya está instalado y configurado. Los datos se guardan en archivos físicos en lugar de localStorage.

---

## 🚀 Cómo Iniciar la Aplicación

### Opción 1: Usando el script (Recomendado)
Doble clic en: **`iniciar-app.bat`**

### Opción 2: Desde la terminal
```bash
node servidor.js
```

---

## 📡 Acceder a la Aplicación

Una vez iniciado el servidor, abrí tu navegador en:

**http://localhost:3000**

---

## 📁 Dónde se Guardan los Datos

Los elementos, texturas y fuentes se guardan en:

```
📁 Produccion/
  📁 datos/
    📄 elementos.json   ← Todos tus elementos
    📄 texturas.json    ← Todas tus texturas
    📄 fuentes.json     ← Todas tus fuentes
```

**Estos archivos son legibles y editables** con cualquier editor de texto.

---

## 🔄 Migrar Datos de localStorage (Opcional)

Si tenías datos guardados en localStorage del navegador, podés exportarlos:

1. Abrí la consola del navegador (F12)
2. Ejecutá este código:

```javascript
// Exportar elementos
console.log(JSON.parse(localStorage.getItem('superimprimible_elementos')));

// Exportar texturas
console.log(JSON.parse(localStorage.getItem('superimprimible_texturas')));

// Exportar fuentes
console.log(JSON.parse(localStorage.getItem('superimprimible_fuentes')));
```

3. Copiá el resultado y pegalo en los archivos correspondientes en `datos/`

---

## ⚙️ Ventajas del Nuevo Sistema

✅ **Datos persistentes** - No se pierden al cambiar de navegador
✅ **Archivos físicos** - Podés copiarlos, respaldarlos, compartirlos
✅ **Multiplataforma** - Accedé desde cualquier dispositivo en tu red local
✅ **Sin límite de tamaño** - No hay límite de 5-10MB como en localStorage
✅ **Portable** - Copiá la carpeta `datos/` y llevate todo

---

## 🛑 Cómo Detener el Servidor

Presioná **Ctrl+C** en la terminal donde está corriendo el servidor.

---

## 🔧 Solución de Problemas

### Error: "Cannot GET /"
- Verificá que el servidor esté corriendo
- Asegurate de acceder a http://localhost:3000 (no file://)

### Error: "Failed to fetch" o "SERVIDOR_NO_DISPONIBLE"
- El servidor no está corriendo
- Inicialo con `node servidor.js` o `iniciar-app.bat`

### Los elementos no aparecen
- Verificá que los archivos en `datos/` tengan formato JSON válido
- Revisá la consola del navegador (F12) para ver errores

---

## 📝 Notas Técnicas

- **Puerto**: El servidor corre en el puerto 3000
- **API**: Las rutas de la API están en `/api/elementos`, `/api/texturas`, `/api/fuentes`
- **CORS**: Habilitado para desarrollo local
- **Límite de tamaño**: 50MB por request (para imágenes base64)

---

## 🆘 Soporte

Si tenés problemas, revisá:
1. Los logs del servidor en la terminal
2. La consola del navegador (F12)
3. Que los archivos JSON en `datos/` tengan formato válido

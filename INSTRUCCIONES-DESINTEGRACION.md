# Integración del Efecto de Desintegración

## 📋 Pasos para implementar el efecto

### 1. Agregar las bibliotecas necesarias

Agrega estas líneas en tu `index.html` **ANTES** de la línea `<script src="js/ui-controles-app.js"></script>`:

```html
<!-- Bibliotecas para el efecto de desintegración -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
<script src="js/efecto-desintegracion.js"></script>
```

### 2. Modificar el código de eliminación

En `js/ui-controles-app.js`, busca este código (aproximadamente línea 2370):

**CÓDIGO ACTUAL:**
```javascript
deleteBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  confirmarEliminacion('elemento', elemento.nombre, function() {
    if (typeof GestorElementos !== 'undefined' && GestorElementos.eliminar) {
      GestorElementos.eliminar(elemento.id || elemento.nombre);
      card.remove();
      console.log('[crearTarjetaElementoGuardado] Elemento eliminado:', elemento.nombre);
      // Disparar evento de actualización para refrescar otras vistas
      window.dispatchEvent(new CustomEvent('superimprimible:elementos-updated'));
    }
  });
});
```

**REEMPLAZAR POR:**
```javascript
deleteBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  confirmarEliminacion('elemento', elemento.nombre, function() {
    if (typeof GestorElementos !== 'undefined' && GestorElementos.eliminar) {
      GestorElementos.eliminar(elemento.id || elemento.nombre);
      
      // Aplicar efecto de desintegración antes de eliminar
      if (typeof DesintegracionFX !== 'undefined') {
        DesintegracionFX.desintegrarCard(card, function() {
          console.log('[crearTarjetaElementoGuardado] Elemento eliminado con efecto:', elemento.nombre);
          // Disparar evento de actualización para refrescar otras vistas
          window.dispatchEvent(new CustomEvent('superimprimible:elementos-updated'));
        });
      } else {
        // Fallback: eliminar sin efecto si el módulo no está cargado
        card.remove();
        console.log('[crearTarjetaElementoGuardado] Elemento eliminado:', elemento.nombre);
        window.dispatchEvent(new CustomEvent('superimprimible:elementos-updated'));
      }
    }
  });
});
```

### 3. Aplicar el mismo cambio a TEXTURAS

Busca alrededor de la línea 2604 (función de texturas):

**CÓDIGO ACTUAL:**
```javascript
deleteBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  confirmarEliminacion('textura', textura.nombre, function() {
    if (typeof GestorTexturas !== 'undefined' && GestorTexturas.eliminar) {
      GestorTexturas.eliminar(textura.id || textura.nombre);
      card.remove();
      console.log('[crearTarjetaTexturaGuardada] Textura eliminada:', textura.nombre);
      window.dispatchEvent(new CustomEvent('superimprimible:texturas-updated'));
    }
  });
});
```

**REEMPLAZAR POR:**
```javascript
deleteBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  confirmarEliminacion('textura', textura.nombre, function() {
    if (typeof GestorTexturas !== 'undefined' && GestorTexturas.eliminar) {
      GestorTexturas.eliminar(textura.id || textura.nombre);
      
      if (typeof DesintegracionFX !== 'undefined') {
        DesintegracionFX.desintegrarCard(card, function() {
          console.log('[crearTarjetaTexturaGuardada] Textura eliminada con efecto:', textura.nombre);
          window.dispatchEvent(new CustomEvent('superimprimible:texturas-updated'));
        });
      } else {
        card.remove();
        console.log('[crearTarjetaTexturaGuardada] Textura eliminada:', textura.nombre);
        window.dispatchEvent(new CustomEvent('superimprimible:texturas-updated'));
      }
    }
  });
});
```

### 4. Aplicar el mismo cambio a FUENTES

Busca alrededor de la línea 2787:

**CÓDIGO ACTUAL:**
```javascript
deleteBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  confirmarEliminacion('fuente', fuente.nombre, function() {
    if (typeof GestorFuentes !== 'undefined' && GestorFuentes.eliminar) {
      GestorFuentes.eliminar(fuente.id || fuente.nombre);
      card.remove();
      console.log('[crearTarjetaFuenteGuardada] Fuente eliminada:', fuente.nombre);
      window.dispatchEvent(new CustomEvent('superimprimible:fuentes-updated'));
    }
  });
});
```

**REEMPLAZAR POR:**
```javascript
deleteBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  confirmarEliminacion('fuente', fuente.nombre, function() {
    if (typeof GestorFuentes !== 'undefined' && GestorFuentes.eliminar) {
      GestorFuentes.eliminar(fuente.id || fuente.nombre);
      
      if (typeof DesintegracionFX !== 'undefined') {
        DesintegracionFX.desintegrarCard(card, function() {
          console.log('[crearTarjetaFuenteGuardada] Fuente eliminada con efecto:', fuente.nombre);
          window.dispatchEvent(new CustomEvent('superimprimible:fuentes-updated'));
        });
      } else {
        card.remove();
        console.log('[crearTarjetaFuenteGuardada] Fuente eliminada:', fuente.nombre);
        window.dispatchEvent(new CustomEvent('superimprimible:fuentes-updated'));
      }
    }
  });
});
```

### 5. Aplicar el mismo cambio a TEMÁTICAS

Busca alrededor de la línea 4992:

**REEMPLAZAR** el código similar con el mismo patrón usando `DesintegracionFX.desintegrarCard()`.

## ⚙️ Personalización del efecto

Si quieres ajustar el efecto, puedes modificar la configuración en `js/efecto-desintegracion.js`:

```javascript
const CONFIG = {
  COUNT: 50,              // Número de fragmentos (más = más detallado, pero más lento)
  REPEAT_COUNT: 2,        // Repetición de píxeles
  DURATION: 0.8,          // Duración en segundos (aumenta para más lento)
  SPREAD: 60,             // Distancia de dispersión en píxeles
  ROTATION: 45            // Rotación máxima en grados
};
```

## 🎨 Ejemplos de configuraciones

**Explosión rápida y dramática:**
```javascript
COUNT: 75,
DURATION: 0.5,
SPREAD: 100,
ROTATION: 90
```

**Desintegración suave:**
```javascript
COUNT: 40,
DURATION: 1.2,
SPREAD: 40,
ROTATION: 30
```

## 🔍 Solución de problemas

1. **El efecto no funciona:** Verifica que las 3 bibliotecas estén cargadas antes de `ui-controles-app.js`
2. **Errores en consola:** Abre las herramientas de desarrollador (F12) y verifica el mensaje de error
3. **El efecto es muy lento:** Reduce el valor de `COUNT` en la configuración
4. **Los fragmentos no se dispersan bien:** Aumenta el valor de `SPREAD`

## ✅ Verificación

Después de implementar, prueba:
1. Abrir la aplicación
2. Agregar un elemento/textura/fuente
3. Hacer clic en el botón de eliminar (🗑️)
4. Confirmar la eliminación
5. ¡Deberías ver el efecto de desintegración!

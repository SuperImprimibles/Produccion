/**
 * Efecto de desintegración para elementos
 * Requiere: GSAP 3+ y html2canvas
 */

(function() {
  'use strict';

  // Configuración del efecto
  const CONFIG = {
    COUNT: 12,              // Número de fragmentos (optimizado para rendimiento)
    REPEAT_COUNT: 1,        // Repetición para distribuir píxeles
    DURATION: 0.9,          // Duración de la animación (segundos)
    SPREAD: 50,             // Distancia de dispersión (px)
    ROTATION: 40            // Rotación máxima (grados)
  };

  /**
   * Aplica el efecto de desintegración a un elemento
   * @param {HTMLElement} element - Elemento a desintegrar
   * @param {Function} onComplete - Callback al finalizar la animación
   */
  function desintegrarElemento(element, onComplete) {
    if (!element) {
      console.warn('[Desintegración] Elemento no válido');
      if (onComplete) onComplete();
      return;
    }

    // Verificar dependencias
    if (typeof html2canvas === 'undefined') {
      console.error('[Desintegración] html2canvas no está cargado');
      element.remove();
      if (onComplete) onComplete();
      return;
    }

    if (typeof gsap === 'undefined') {
      console.error('[Desintegración] GSAP no está cargado');
      element.remove();
      if (onComplete) onComplete();
      return;
    }

    console.log('[Desintegración] Iniciando efecto...');

    // Obtener posición y dimensiones del elemento
    const rect = element.getBoundingClientRect();

    // Capturar el elemento como imagen ANTES de ocultarlo
    html2canvas(element, {
      backgroundColor: null,
      scale: 1,
      logging: false,
      allowTaint: true,
      useCORS: true,
      width: rect.width,
      height: rect.height,
      imageTimeout: 0,
      removeContainer: true
    }).then(function(canvas) {
      
      // AHORA sí ocultamos el elemento original
      element.style.opacity = '0';
      
      // Crear un contenedor para los fragmentos
      const fragmentContainer = document.createElement('div');
      fragmentContainer.style.cssText = `
        position: fixed;
        left: ${rect.left}px;
        top: ${rect.top}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        pointer-events: none;
        z-index: 9999;
      `;
      document.body.appendChild(fragmentContainer);
      
      const width = canvas.width;
      const height = canvas.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const imageData = ctx.getImageData(0, 0, width, height);
      
      console.log('[Desintegración] ImageData obtenida, creando fragmentos...');
      
      // Crear arrays para los fragmentos
      const dataList = [];
      for (let i = 0; i < CONFIG.COUNT; i++) {
        dataList.push(ctx.createImageData(width, height));
      }

      // Distribuir píxeles en los fragmentos de manera optimizada
      const pixelStep = 3; // Muestrear cada 3 píxeles para máximo rendimiento
      for (let x = 0; x < width; x += pixelStep) {
        for (let y = 0; y < height; y += pixelStep) {
          const index = (x + y * width) * 4;
          const dataIndex = Math.floor(Math.random() * CONFIG.COUNT);
          
          // Copiar el píxel y sus vecinos para rellenar el paso
          for (let dx = 0; dx < pixelStep && x + dx < width; dx++) {
            for (let dy = 0; dy < pixelStep && y + dy < height; dy++) {
              const idx = ((x + dx) + (y + dy) * width) * 4;
              dataList[dataIndex].data[idx] = imageData.data[index];
              dataList[dataIndex].data[idx + 1] = imageData.data[index + 1];
              dataList[dataIndex].data[idx + 2] = imageData.data[index + 2];
              dataList[dataIndex].data[idx + 3] = imageData.data[index + 3];
            }
          }
        }
      }

      console.log('[Desintegración] Fragmentos creados:', dataList.length);
      console.log('[Desintegración] Iniciando animaciones...');

      // Crear y animar cada fragmento
      let completedFragments = 0;
      const fragment = document.createDocumentFragment();
      
      dataList.forEach(function(data, i) {
        const fragmentCanvas = document.createElement('canvas');
        fragmentCanvas.width = width;
        fragmentCanvas.height = height;
        const fragmentCtx = fragmentCanvas.getContext('2d', { alpha: true, willReadFrequently: false });
        fragmentCtx.putImageData(data, 0, 0);
        
        fragmentCanvas.style.cssText = `
          position: absolute;
          left: 0;
          top: 0;
          width: ${rect.width}px;
          height: ${rect.height}px;
          image-rendering: auto;
          will-change: transform, opacity;
        `;
        
        fragment.appendChild(fragmentCanvas);

        // Ángulo y rotación aleatorios precalculados
        const randomAngle = (Math.random() - 0.5) * 2 * Math.PI;
        const randomRotation = CONFIG.ROTATION * (Math.random() - 0.5);
        const xOffset = CONFIG.SPREAD * Math.sin(randomAngle);
        const yOffset = CONFIG.SPREAD * Math.cos(randomAngle);

        // Animar el fragmento con optimización
        gsap.to(fragmentCanvas, {
          duration: CONFIG.DURATION,
          rotate: randomRotation,
          x: xOffset,
          y: yOffset,
          opacity: 0,
          delay: (i / dataList.length) * 0.2,
          ease: 'power1.out',
          force3D: true,
          onComplete: function() {
            completedFragments++;
            
            // Cuando todos los fragmentos terminaron
            if (completedFragments === dataList.length) {
              fragmentContainer.remove();
              element.remove();
              if (onComplete) onComplete();
            }
          }
        });
      });
      
      // Agregar todos los fragmentos de una vez
      fragmentContainer.appendChild(fragment);

    }).catch(function(error) {
      console.error('[Desintegración] Error al capturar elemento:', error);
      fragmentContainer.remove();
      element.remove();
      if (onComplete) onComplete();
    });
  }

  /**
   * Desintegrar una tarjeta (card) del grid
   * @param {HTMLElement} card - Tarjeta a desintegrar
   * @param {Function} onComplete - Callback al finalizar
   */
  function desintegrarCard(card, onComplete) {
    if (!card) {
      if (onComplete) onComplete();
      return;
    }

    // Clonar la tarjeta para el efecto
    const cardClone = card.cloneNode(true);
    cardClone.style.cssText = card.style.cssText;
    
    // Obtener posición exacta
    const rect = card.getBoundingClientRect();
    cardClone.style.position = 'fixed';
    cardClone.style.left = rect.left + 'px';
    cardClone.style.top = rect.top + 'px';
    cardClone.style.width = rect.width + 'px';
    cardClone.style.height = rect.height + 'px';
    cardClone.style.zIndex = '9998';
    cardClone.style.margin = '0';
    
    // Agregar el clon al body
    document.body.appendChild(cardClone);
    
    // Ocultar el original
    card.style.opacity = '0';
    
    // Aplicar el efecto al clon
    desintegrarElemento(cardClone, function() {
      card.remove();
      if (onComplete) onComplete();
    });
  }

  // Exponer las funciones globalmente
  window.DesintegracionFX = {
    desintegrar: desintegrarElemento,
    desintegrarCard: desintegrarCard,
    config: CONFIG
  };

  console.log('[Desintegración] Módulo cargado correctamente');
})();

  // Modal flotante: Elegir Diseño
  (function(){
    const openBtn = document.getElementById('chooseDesignBtn');
    const openBtn2 = document.getElementById('sidePanel2DesignBtn');
    const openBtn3 = document.getElementById('tematicasDesignBtn');
    const closeBtn = document.getElementById('chooseDesignModalClose');
    const backdrop = document.getElementById('chooseDesignModalBackdrop');
    const gridWrap = document.getElementById('designPickerGrid');
    if (!closeBtn || !backdrop) return;

    let activeTriggerEl = null;

    // Los diseños que se muestran acá son las tarjetas ya cargadas en
    // #elements-grid (vista Marketing) cuya categoría coincide con la que
    // esté activa en #view-marketing > .category-toolbar > .category-btn.active,
    // para que el picker quede siempre sincronizado con lo que se haya
    // agregado en esa categoría (Diseños, Plantillas, Elementos, etc).
    function getActiveMarketingCategory(){
      const activeBtn = document.querySelector('#view-marketing > .category-toolbar > .category-btn.active');
      return activeBtn ? activeBtn.textContent.trim() : '';
    }

    function getDesignCards(){
      const cat = getActiveMarketingCategory();
      if (!cat || cat === 'Todos' || cat === 'Elegidos por Tí') return [];
      return Array.prototype.filter.call(
        document.querySelectorAll('#elements-grid .element-card'),
        function(card){ return card.dataset.marketingCategory === cat; }
      );
    }

    function applyDesign(card){
      const name = card.dataset.name || '';
      const square = card.querySelector('.element-square');
      const bg = square ? square.style.backgroundImage : '';
      if (activeTriggerEl){
        activeTriggerEl.dataset.selectedDesign = name;
      }
      // Otros módulos pueden escuchar este evento para aplicar el diseño
      // elegido sobre el lienzo/side-card correspondiente.
      backdrop.dispatchEvent(new CustomEvent('designChosen', {
        detail: { name: name, backgroundImage: bg, triggerEl: activeTriggerEl }
      }));
    }

    function renderGrid(){
      if (!gridWrap) return;
      gridWrap.innerHTML = '';
      const cards = getDesignCards();

      if (!cards.length){
        const empty = document.createElement('div');
        empty.className = 'texture-picker-empty';
        empty.id = 'designPickerEmpty';
        empty.textContent = 'Todavía no agregaste diseños en Marketing. Agregalos desde la categoría correspondiente.';
        gridWrap.appendChild(empty);
        return;
      }

      cards.forEach(function(card){
        const name = card.dataset.name || 'Sin nombre';
        const square = card.querySelector('.element-square');
        const bg = square ? square.style.backgroundImage : '';

        const thumb = document.createElement('div');
        thumb.className = 'texture-picker-thumb design-picker-thumb';
        if (bg) thumb.style.backgroundImage = bg;
        thumb.title = name;

        const label = document.createElement('span');
        label.className = 'design-picker-thumb-label';
        label.textContent = name;
        thumb.appendChild(label);

        thumb.addEventListener('click', function(){
          gridWrap.querySelectorAll('.design-picker-thumb.selected').forEach(function(t){ t.classList.remove('selected'); });
          thumb.classList.add('selected');
          applyDesign(card);
          closeModal();
        });
        gridWrap.appendChild(thumb);
      });
    }

    function openModal(e){
      activeTriggerEl = (e && e.currentTarget) || openBtn || openBtn2 || openBtn3;
      renderGrid();
      backdrop.classList.add('open');
    }
    function closeModal(){ backdrop.classList.remove('open'); }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (openBtn2) openBtn2.addEventListener('click', openModal);
    if (openBtn3) openBtn3.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', function(e){
      if (e.target === backdrop) closeModal();
    });
  })();

  // Botón "Jerarquía" (side-panel-2): muestra/oculta el panel flotante de jerarquía
  (function(){
    const btn = document.getElementById('sidePanel2HierarchyBtn');
    const panel = document.getElementById('floatingPanelHierarchySection');
    if (!btn || !panel) return;

    btn.addEventListener('click', function(){
      const hidden = panel.style.display === 'none';
      panel.style.display = hidden ? '' : 'none';
    });
  })();

  // Interruptor "Plantilla Plegable" (vista Diseño del riel flotante)
  // + interruptor "Plegable" (vista Configuraciones, debajo de #masksCard)
  // Ambos controlan el mismo estado y se mantienen sincronizados entre sí.
  (function(){
    const toggle = document.getElementById('foldableTemplateToggle');
    const toggleSettings = document.getElementById('foldableToggleSettings');
    if (!toggle && !toggleSettings) return;

    function applyFoldable(isFoldable, source){
      document.body.classList.toggle('is-foldable-template', isFoldable);
      if (toggle && toggle !== source) toggle.checked = isFoldable;
      if (toggleSettings && toggleSettings !== source) toggleSettings.checked = isFoldable;
      document.dispatchEvent(new CustomEvent('sp:foldableTemplateChanged', { detail: { foldable: isFoldable } }));
    }

    if (toggle){
      toggle.addEventListener('change', function(){
        applyFoldable(toggle.checked, toggle);
      });
    }
    if (toggleSettings){
      toggleSettings.addEventListener('change', function(){
        applyFoldable(toggleSettings.checked, toggleSettings);
      });
    }
  })();

  // Panel "Medidas" — controla 3 cosas en vivo a partir de Ancho/Alto (cm):
  //  1) El TAMAÑO REAL de la plantilla cargada (#editorCanvas se escala en
  //     CSS a las dimensiones elegidas — antes solo se movía el recuadro
  //     punteado decorativo y la imagen quedaba con su tamaño de siempre).
  //  2) El marco punteado (#dimPageFrame) que representa ese mismo tamaño.
  //  3) Si "Visualizar en Hoja" está activo, una hoja de referencia fija
  //     (#dimA4Frame) del tamaño elegido en "Tamaño de hoja" (A4/A3/A5/
  //     Carta/Legal/Oficio) — el diseño se centra adentro a esa escala,
  //     así se ve si entra o se sale de la hoja.
  (function(){
    const widthSlider = document.getElementById('dimWidthSlider');
    const heightSlider = document.getElementById('dimHeightSlider');
    const showGeneral = document.getElementById('showGeneralDimensions');
    const paperSelect = document.getElementById('dimsPaperSizeSelect');
    const paperOrientationSelect = document.getElementById('dimsPaperOrientationSelect');

    const editorWrap = document.getElementById('editorWrap');
    const a4Frame = document.getElementById('dimA4Frame');
    const a4Label = document.getElementById('dimA4Label');
    const frame = document.getElementById('dimPageFrame');
    const labelWidth = document.getElementById('dimLabelWidth');
    const labelHeight = document.getElementById('dimLabelHeight');
    const annotationInfo = document.getElementById('dimAnnotationInfo');
    const canvasEl = document.getElementById('editorCanvas');

    if (!widthSlider || !heightSlider || !editorWrap || !frame || !a4Frame) return;

    function getPaperSizeCm(){
      const opt = paperSelect && paperSelect.selectedOptions[0];
      const w = opt ? parseFloat(opt.dataset.w) : 21;
      const h = opt ? parseFloat(opt.dataset.h) : 29.7;
      const isHorizontal = !!(paperOrientationSelect && paperOrientationSelect.value === 'horizontal');
      // los data-w/data-h de cada opción están en orientación vertical
      // (la hoja "de pie", ancho < alto); con Horizontal simplemente se
      // invierten para mostrar la hoja "acostada".
      const wCm = isFinite(w) ? w : 21;
      const hCm = isFinite(h) ? h : 29.7;
      return {
        name: opt ? opt.value : 'A4',
        w: isHorizontal ? hCm : wCm,
        h: isHorizontal ? wCm : hCm,
      };
    }

    function updateDimPageFrame(){
      const widthCm = parseFloat(widthSlider.value) || 1;
      const heightCm = parseFloat(heightSlider.value) || 1;
      const paperOn = !!(showGeneral && showGeneral.checked);
      const paper = getPaperSizeCm();

      // Área disponible dentro de #editorWrap, dejando un margen igual al
      // que usaba #editorCanvas antes (92%) para que los marcos y la
      // imagen coincidan.
      const wrapW = editorWrap.clientWidth;
      const wrapH = editorWrap.clientHeight;
      if (!wrapW || !wrapH) return;
      const availW = wrapW * 0.92;
      const availH = wrapH * 0.92;
      const centerX = wrapW / 2;
      const centerY = wrapH / 2;

      // Con la hoja visible, la escala la fija la HOJA (para comparar el
      // diseño contra un tamaño real fijo). Sin hoja, la escala se ajusta
      // al propio diseño (para que siempre se vea grande y centrado).
      const scale = paperOn
        ? Math.min(availW / paper.w, availH / paper.h)
        : Math.min(availW / widthCm, availH / heightCm);

      if (paperOn){
        const a4W = paper.w * scale;
        const a4H = paper.h * scale;
        a4Frame.style.width = a4W + 'px';
        a4Frame.style.height = a4H + 'px';
        a4Frame.style.left = (centerX - a4W / 2) + 'px';
        a4Frame.style.top = (centerY - a4H / 2) + 'px';
        if (a4Label) a4Label.textContent = paper.name + ' · ' + paper.w + ' × ' + paper.h + ' cm';
      }

      const frameW = widthCm * scale;
      const frameH = heightCm * scale;
      frame.style.width = frameW + 'px';
      frame.style.height = frameH + 'px';
      frame.style.left = (centerX - frameW / 2) + 'px';
      frame.style.top = (centerY - frameH / 2) + 'px';

      const shapeBbox = (typeof window.__spGetMasksBBoxPx === 'function') ? window.__spGetMasksBBoxPx() : null;

      // La plantilla/imagen cargada se escala en pantalla para que la FORMA
      // (el bbox de las máscaras) mida exactamente Ancho×Alto — no el
      // lienzo completo, que suele tener relleno vacío alrededor de la
      // forma. Por eso escalamos el canvas por el factor que hace falta
      // para que solo esa región mida frameW×frameH, y lo posicionamos
      // (position:absolute) para que el centro de la forma quede
      // exactamente donde está el centro del recuadro punteado.
      if (canvasEl && canvasEl.classList.contains('has-image')){
        canvasEl.style.maxWidth = 'none';
        canvasEl.style.maxHeight = 'none';
        // object-fit:contain (CSS por defecto) fuerza a que el contenido dibujado
        // mantenga SIEMPRE la proporción original del canvas, sin importar qué
        // width/height le pongamos por JS — por eso, aunque el recuadro cambiara de
        // forma, el elemento se seguía viendo "contenido" con su proporción intacta.
        // Acá SÍ queremos que se deforme de verdad cuando el Bloqueo de
        // Proporcionalidad está desactivado, así que forzamos 'fill' (estira el
        // contenido para llenar exactamente el ancho/alto asignados).
        canvasEl.style.objectFit = 'fill';
        if (shapeBbox && shapeBbox.width > 0 && shapeBbox.height > 0 && canvasEl.width && canvasEl.height){
          const shapeScaleX = frameW / shapeBbox.width;
          const shapeScaleY = frameH / shapeBbox.height;
          const bboxCenterXpx = shapeBbox.minX + shapeBbox.width / 2;
          const bboxCenterYpx = shapeBbox.minY + shapeBbox.height / 2;
          canvasEl.style.position = 'absolute';
          canvasEl.style.width = (canvasEl.width * shapeScaleX) + 'px';
          canvasEl.style.height = (canvasEl.height * shapeScaleY) + 'px';
          canvasEl.style.left = (centerX - bboxCenterXpx * shapeScaleX) + 'px';
          canvasEl.style.top = (centerY - bboxCenterYpx * shapeScaleY) + 'px';
          // Recorta todo lo que quede fuera del bbox de la forma — el resto
          // del lienzo (relleno vacío) queda invisible, solo se ve la forma.
          const clipTop = (shapeBbox.minY / canvasEl.height) * 100;
          const clipRight = (1 - shapeBbox.maxX / canvasEl.width) * 100;
          const clipBottom = (1 - shapeBbox.maxY / canvasEl.height) * 100;
          const clipLeft = (shapeBbox.minX / canvasEl.width) * 100;
          canvasEl.style.clipPath = 'inset(' + clipTop + '% ' + clipRight + '% ' + clipBottom + '% ' + clipLeft + '%)';
        } else {
          // Todavía no hay máscaras (sin segmentar): escalamos el canvas
          // completo al tamaño del recuadro, centrado normalmente.
          canvasEl.style.position = '';
          canvasEl.style.left = '';
          canvasEl.style.top = '';
          canvasEl.style.width = frameW + 'px';
          canvasEl.style.height = frameH + 'px';
          canvasEl.style.clipPath = '';
        }
      }

      if (labelWidth) labelWidth.textContent = 'Ancho: ' + widthCm + ' cm';
      if (labelHeight) labelHeight.textContent = 'Alto: ' + heightCm + ' cm';

      if (annotationInfo){
        const ratio = (widthCm / heightCm).toFixed(2);
        const areaCm2 = (widthCm * heightCm).toFixed(1);
        let info = widthCm + ' × ' + heightCm + ' cm · ' + areaCm2 + ' cm²<br>Relación ' + ratio + ':1';
        if (canvasEl && canvasEl.classList.contains('has-image')){
          // DPI real de la FORMA (bbox), no del lienzo completo con relleno.
          const shapePxW = (shapeBbox && shapeBbox.width > 0) ? shapeBbox.width : canvasEl.width;
          const shapePxH = (shapeBbox && shapeBbox.height > 0) ? shapeBbox.height : canvasEl.height;
          const dpi = Math.round(shapePxW / (widthCm / 2.54));
          info += '<br>≈ ' + dpi + ' DPI (' + shapePxW + '×' + shapePxH + ' px)';
        }
        annotationInfo.innerHTML = info;
      }
    }

    function resetCanvasSize(){
      // Vuelve la plantilla a su tamaño y posición naturales (flujo normal,
      // centrada por flex, capada al 92% del área).
      if (!canvasEl) return;
      canvasEl.style.width = '';
      canvasEl.style.height = '';
      canvasEl.style.maxWidth = '';
      canvasEl.style.maxHeight = '';
      canvasEl.style.position = '';
      canvasEl.style.left = '';
      canvasEl.style.top = '';
      canvasEl.style.clipPath = '';
      canvasEl.style.objectFit = '';
    }

    function updateDimFrameVisibility(){
      const on = !!(showGeneral && showGeneral.checked);
      frame.classList.toggle('active', on);
      a4Frame.classList.toggle('active', on);
      updateDimPageFrame();
    }

    // OJO: este bloque NO es el módulo ES donde vive `state` (el que
    // arranca más abajo) — así que acá solo repintamos los marcos 2D y el
    // tamaño mostrado de la plantilla, leyendo directo los sliders. Quién
    // decide los valores de Ancho/Alto (a mano, con bloqueo de
    // proporcionalidad, o automático desde las máscaras) vive en el
    // módulo, en el bloque "Panel Medidas: estado real" — ese bloque
    // escribe los sliders y dispara 'sp:dimsChanged', que es lo que
    // escuchamos acá para repintar.
    widthSlider.addEventListener('input', function(){
      updateDimPageFrame();
    });
    heightSlider.addEventListener('input', function(){
      updateDimPageFrame();
    });
    document.addEventListener('sp:dimsChanged', updateDimPageFrame);

    if (showGeneral) showGeneral.addEventListener('change', updateDimFrameVisibility);
    if (paperSelect) paperSelect.addEventListener('change', updateDimPageFrame);
    if (paperOrientationSelect) paperOrientationSelect.addEventListener('change', updateDimPageFrame);

    window.addEventListener('resize', updateDimPageFrame);

    // El panel "Medidas" puede estar oculto (display:none) al cargar la página,
    // así que recalculamos apenas se hace visible desde el riel de vistas.
    document.addEventListener('sp:disenoViewChanged', function(){
      requestAnimationFrame(updateDimPageFrame);
    });

    // Si se carga una imagen nueva (o se borra), reaplicamos el tamaño real
    // vigente — o lo reseteamos si ya no hay imagen.
    if (canvasEl){
      const canvasObserver = new MutationObserver(function(){
        if (canvasEl.classList.contains('has-image')) updateDimPageFrame();
        else resetCanvasSize();
      });
      canvasObserver.observe(canvasEl, { attributes: true, attributeFilter: ['class'] });
    }

    updateDimFrameVisibility();
  })();

  // Barra lateral vertical de vistas (Diseño / Medidas / Jerarquías / Configuraciones)
  (function(){
    const items = document.querySelectorAll('.floating-panel-rail .nav-item');
    const hierarchyPanel = document.getElementById('floatingPanelHierarchySection');
    const dimensionsPanel = document.getElementById('floatingPanelDimensionsSection');
    const sidePanel2 = document.getElementById('side-panel-2');
    const settingsPanel = document.getElementById('floatingPanelSettingsSection');
    if (!items.length) return;

    function applyView(view){
      if (hierarchyPanel) hierarchyPanel.style.display = (view === 'jerarquias') ? '' : 'none';
      if (dimensionsPanel) dimensionsPanel.style.display = (view === 'medidas') ? '' : 'none';
      if (sidePanel2) sidePanel2.style.display = (view === 'diseno') ? '' : 'none';
      if (settingsPanel) settingsPanel.style.display = (view === 'configuraciones') ? '' : 'none';
      // Avisamos al módulo del editor (canvas) si la vista "Diseño" quedó visible o no,
      // para que pinte el canvas en color puro con el color de #sp2ColorPickerInput.
      document.dispatchEvent(new CustomEvent('sp:disenoViewChanged', { detail: { active: view === 'diseno' } }));
    }

    items.forEach(function(item){
      item.addEventListener('click', function(){
        const wasActive = item.classList.contains('active');
        items.forEach(function(i){ i.classList.remove('active'); });
        if (wasActive){
          applyView(null);
        } else {
          item.classList.add('active');
          applyView(item.getAttribute('data-rail-view'));
        }
      });
    });

    // Estado inicial: coincide con el ítem marcado como "active" en el HTML
    // (por defecto ninguno lo está, así que al abrir la página no se muestra
    // ninguna sección del rail hasta que el usuario haga clic en un botón).
    const initialItem = document.querySelector('.floating-panel-rail .nav-item.active');
    applyView(initialItem ? initialItem.getAttribute('data-rail-view') : null);
  })();

  // Menú horizontal de la vista "Gestión" (Análisis / Publicaciones / Marketing)
  (function(){
    const toolbar = document.getElementById('gestionCategoryToolbar');
    if (!toolbar) return;
    const items = toolbar.querySelectorAll('.category-btn');
    const panels = {
      publicaciones: document.getElementById('gestionPanelPublicaciones'),
      marketing: document.getElementById('gestionPanelMarketing'),
      operaciones: document.getElementById('gestionPanelOperaciones'),
      analisis: document.getElementById('gestionPanelAnalisis')
    };

    function applyGestionView(view){
      Object.keys(panels).forEach(function(key){
        const panel = panels[key];
        if (panel) panel.classList.toggle('active', key === view);
      });
      const syncGroup = document.getElementById('gestionSyncGroup');
      if (syncGroup) syncGroup.classList.toggle('show', view === 'publicaciones');
      const pubFilter = document.getElementById('gestionPublicacionesFilter');
      if (pubFilter) pubFilter.classList.toggle('show', view === 'publicaciones');
      const conexionesBtn = document.getElementById('gestionConexionesBtn');
      if (conexionesBtn) conexionesBtn.classList.toggle('show', view === 'analisis');
      const crearMaquetaBtn = document.getElementById('gestionCrearMaquetaBtn');
      if (crearMaquetaBtn) crearMaquetaBtn.classList.toggle('show', view === 'marketing');
      const operacionesHeader = document.getElementById('gestionOperacionesHeader');
      if (operacionesHeader) operacionesHeader.classList.toggle('show', view === 'operaciones');
    }

    items.forEach(function(item){
      item.addEventListener('click', function(){
        items.forEach(function(i){ i.classList.remove('active'); });
        item.classList.add('active');
        applyGestionView(item.getAttribute('data-gestion-view'));
      });
    });

    const initialGestionItem = toolbar.querySelector('.category-btn.active');
    applyGestionView(initialGestionItem ? initialGestionItem.getAttribute('data-gestion-view') : 'publicaciones');
  })();

  // Tarjetas de "Publicaciones"
  (function(){
    const grid = document.getElementById('publicacionesGrid');
    if (!grid) return;

    // Panel de detalle
    const publicacionDetailOverlay = document.createElement('div');
    publicacionDetailOverlay.className = 'publicacion-detail-overlay';
    publicacionDetailOverlay.innerHTML =
      '<div class="publicacion-detail-modal">' +
        '<button type="button" class="publicacion-detail-close" aria-label="Cerrar">✕</button>' +
        '<p class="publicacion-detail-title"></p>' +
        '<div class="publicacion-detail-meta"></div>' +
        '<div class="publicacion-config-sep"></div>' +
        '<div class="publicacion-config-form">' +
          '<div class="publicacion-config-radios">' +
            '<label class="publicacion-config-radio"><input type="radio" name="publicacion-config-tipo" value="activacion">App Web</label>' +
            '<label class="publicacion-config-radio"><input type="radio" name="publicacion-config-tipo" value="link-fijo" checked>Link Personalizado</label>' +
          '</div>' +
          '<div class="publicacion-config-field">' +
            '<span class="publicacion-config-label">Link Fijo</span>' +
            '<input type="text" class="publicacion-config-input" id="publicacionConfigLink" placeholder="https://...">' +
          '</div>' +
          '<div class="publicacion-config-field">' +
            '<span class="publicacion-config-label">Tu Costo <span class="opcional">(opcional)</span></span>' +
            '<div class="publicacion-config-costo">' +
              '<span>$</span>' +
              '<input type="number" id="publicacionConfigCosto" placeholder="Ej: 3000">' +
            '</div>' +
          '</div>' +
          '<div class="publicacion-config-field">' +
            '<span class="publicacion-config-label">Notas Internas <span class="opcional">(opcional)</span></span>' +
            '<textarea class="publicacion-config-textarea" id="publicacionConfigNotas" placeholder="Ej: Promoción activa hasta fin de mes"></textarea>' +
          '</div>' +
          '<div class="publicacion-config-actions">' +
            '<button type="button" class="publicacion-config-btn publicacion-config-btn--primary" id="publicacionConfigGuardar">Guardar Configuración</button>' +
            '<button type="button" class="publicacion-config-btn publicacion-config-btn--secondary" id="publicacionConfigCancelar">Cancelar</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(publicacionDetailOverlay);
    const publicacionDetailTitle = publicacionDetailOverlay.querySelector('.publicacion-detail-title');
    const publicacionDetailMeta = publicacionDetailOverlay.querySelector('.publicacion-detail-meta');

    function openPublicacionDetail(card){
      const name = card.dataset.name || '';
      if (publicacionDetailTitle) publicacionDetailTitle.textContent = name;
      if (publicacionDetailMeta){
        const metaSource = card.querySelector('.publicacion-card-meta');
        publicacionDetailMeta.innerHTML = metaSource ? metaSource.innerHTML : '';
      }
      publicacionDetailOverlay.classList.add('open');
    }
    function closePublicacionDetail(){
      publicacionDetailOverlay.classList.remove('open');
    }

    publicacionDetailOverlay.querySelector('.publicacion-detail-close').addEventListener('click', closePublicacionDetail);
    publicacionDetailOverlay.addEventListener('click', function(e){
      if (e.target === publicacionDetailOverlay) closePublicacionDetail();
    });

    const publicacionConfigCancelar = publicacionDetailOverlay.querySelector('#publicacionConfigCancelar');
    if (publicacionConfigCancelar){
      publicacionConfigCancelar.addEventListener('click', closePublicacionDetail);
    }
    const publicacionConfigGuardar = publicacionDetailOverlay.querySelector('#publicacionConfigGuardar');
    if (publicacionConfigGuardar){
      publicacionConfigGuardar.addEventListener('click', closePublicacionDetail);
    }

    grid.querySelectorAll('.publicacion-card').forEach(function(card){
      card.addEventListener('click', function(e){
        if (e.target.closest('button, input, a')) return;
        openPublicacionDetail(card);
      });

      const estadoBtn = card.querySelector('[data-action="herramientas"]');
      if (estadoBtn){
        estadoBtn.addEventListener('click', function(e){
          e.stopPropagation();
          const isActive = estadoBtn.classList.contains('publicacion-card-pill--active');
          estadoBtn.classList.toggle('publicacion-card-pill--active', !isActive);
          estadoBtn.classList.toggle('publicacion-card-pill--inactive', isActive);
          estadoBtn.textContent = isActive ? 'Inactivo' : 'Activo';
        });
      }
    });
  })();

  // Planilla "Operaciones": filtro por fecha y estado
  (function(){
    const desdeInput = document.getElementById('operacionesFiltroDesde');
    const hastaInput = document.getElementById('operacionesFiltroHasta');
    const estadoSelect = document.getElementById('operacionesFiltroEstado');
    const aplicarBtn = document.getElementById('operacionesAplicarFiltros');
    const tbody = document.getElementById('operacionesTableBody');
    if (!aplicarBtn || !tbody) return;

    function aplicarFiltros(){
      const desde = desdeInput && desdeInput.value ? new Date(desdeInput.value) : null;
      const hasta = hastaInput && hastaInput.value ? new Date(hastaInput.value) : null;
      const estado = estadoSelect ? estadoSelect.value : '';

      let visibles = 0;
      Array.from(tbody.querySelectorAll('tr[data-estado]')).forEach(function(row){
        let show = true;
        if (estado && row.getAttribute('data-estado') !== estado) show = false;
        const fechaAttr = row.getAttribute('data-fecha');
        if (show && fechaAttr){
          const fecha = new Date(fechaAttr);
          if (desde && fecha < desde) show = false;
          if (hasta){
            const hastaFin = new Date(hasta);
            hastaFin.setHours(23, 59, 59, 999);
            if (fecha > hastaFin) show = false;
          }
        }
        row.style.display = show ? '' : 'none';
        if (show) visibles++;
      });

      let emptyRow = tbody.querySelector('.operaciones-table-empty-row');
      if (visibles === 0){
        if (!emptyRow){
          emptyRow = document.createElement('tr');
          emptyRow.className = 'operaciones-table-empty-row';
          emptyRow.innerHTML = '<td colspan="5" class="operaciones-table-empty">No se encontraron órdenes con esos filtros.</td>';
          tbody.appendChild(emptyRow);
        }
      } else if (emptyRow){
        emptyRow.remove();
      }
    }

    aplicarBtn.addEventListener('click', aplicarFiltros);
  })();

  // Botón "Sincronizar" del panel de Publicaciones
  (function(){
    const syncBtn = document.getElementById('gestionSyncBtn');
    const syncLast = document.getElementById('gestionSyncLast');
    if (!syncBtn || !syncLast) return;

    function formatFecha(date){
      const fecha = date.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
      const hora = date.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
      return fecha + ' ' + hora;
    }

    syncBtn.addEventListener('click', function(){
      if (syncBtn.classList.contains('is-syncing')) return;
      syncBtn.classList.add('is-syncing');
      syncBtn.disabled = true;
      setTimeout(function(){
        syncBtn.classList.remove('is-syncing');
        syncBtn.disabled = false;
        syncLast.textContent = 'Última sincronización: ' + formatFecha(new Date());
      }, 900);
    });
  })();

  // Modal "Mensaje para Compradores"
  (function(){
    const openBtn = document.getElementById('gestionPublicacionesMensajeBtn');
    if (!openBtn) return;

    const DEFAULT_TEMPLATE =
      '¡Hola {buyer_name}! Aquí tiene el link de descarga de su kit imprimible y editable:\n\n' +
      '{invitation_link}\n\n' +
      'Muchas gracias por su compra y por confiar en súper imprimibles :)';

    const SAMPLE_VALUES = {
      buyer_name: 'María García',
      invitation_link: 'https://invitaciones.com/edit/abc123xyz',
      order_id: '#20481',
      product_title: 'Kit Guirnalda Cumpleaños'
    };

    const MAX_CHARS = 2000;

    const overlay = document.createElement('div');
    overlay.className = 'mensaje-modal-overlay';
    overlay.innerHTML =
      '<div class="mensaje-modal">' +
        '<button type="button" class="mensaje-modal-close" aria-label="Cerrar">✕</button>' +
        '<p class="mensaje-modal-title">Mensaje para Compradores</p>' +
        '<p class="mensaje-modal-desc">Configura el mensaje que se enviará automáticamente a los compradores por mensajería de Mercado Libre. Usa los placeholders para personalizar el mensaje.</p>' +
        '<div class="mensaje-modal-grid">' +
          '<div class="mensaje-modal-col">' +
            '<div class="mensaje-modal-col-label">Plantilla del Mensaje</div>' +
            '<textarea class="mensaje-template-textarea" id="mensajeTemplateTextarea" maxlength="' + MAX_CHARS + '"></textarea>' +
            '<div class="mensaje-placeholders-label">Placeholders Disponibles:</div>' +
            '<div class="mensaje-placeholders-row" id="mensajePlaceholdersRow">' +
              '<button type="button" class="mensaje-placeholder-chip" data-ph="buyer_name">{buyer_name}</button>' +
              '<button type="button" class="mensaje-placeholder-chip" data-ph="invitation_link">{invitation_link}</button>' +
              '<button type="button" class="mensaje-placeholder-chip" data-ph="order_id">{order_id}</button>' +
              '<button type="button" class="mensaje-placeholder-chip" data-ph="product_title">{product_title}</button>' +
            '</div>' +
            '<div class="mensaje-placeholders-hint">Click en un placeholder para insertarlo en el cursor</div>' +
            '<div class="mensaje-modal-actions">' +
              '<button type="button" class="mensaje-btn mensaje-btn--primary" id="mensajeGuardarBtn">Guardar Mensaje</button>' +
              '<button type="button" class="mensaje-btn mensaje-btn--secondary" id="mensajeRestaurarBtn">Restaurar por Defecto</button>' +
            '</div>' +
          '</div>' +
          '<div class="mensaje-modal-col">' +
            '<div class="mensaje-modal-col-label">Vista Previa</div>' +
            '<div class="mensaje-preview-card">' +
              '<div class="mensaje-preview-header">' +
                '<div class="mensaje-preview-avatar">ML</div>' +
                '<div>' +
                  '<div class="mensaje-preview-name">Tu Tienda</div>' +
                  '<div class="mensaje-preview-sub">Mercado Libre</div>' +
                '</div>' +
              '</div>' +
              '<div class="mensaje-preview-body" id="mensajePreviewBody"></div>' +
            '</div>' +
            '<div class="mensaje-info-box">' +
              '<div class="mensaje-info-title">ℹ️ Información</div>' +
              '<ul>' +
                '<li>Los placeholders se reemplazan automáticamente</li>' +
                '<li>Puedes usar emojis 🎉</li>' +
                '<li>Máximo ' + MAX_CHARS + ' caracteres (límite de Mercado Libre)</li>' +
                '<li>El link se genera automáticamente por cada venta</li>' +
              '</ul>' +
            '</div>' +
            '<div class="mensaje-char-counter">' +
              '<div class="mensaje-char-counter-label" id="mensajeCharLabel">Caracteres: 0 / ' + MAX_CHARS + '</div>' +
              '<div class="mensaje-char-counter-track"><div class="mensaje-char-counter-fill" id="mensajeCharFill" style="width:0%"></div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const textarea = overlay.querySelector('#mensajeTemplateTextarea');
    const previewBody = overlay.querySelector('#mensajePreviewBody');
    const charLabel = overlay.querySelector('#mensajeCharLabel');
    const charFill = overlay.querySelector('#mensajeCharFill');
    const closeBtn = overlay.querySelector('.mensaje-modal-close');
    const guardarBtn = overlay.querySelector('#mensajeGuardarBtn');
    const restaurarBtn = overlay.querySelector('#mensajeRestaurarBtn');
    const placeholdersRow = overlay.querySelector('#mensajePlaceholdersRow');

    const STORAGE_KEY = 'superimprimible_mensaje_compradores';

    function escapeHtml(str){
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function renderPreview(){
      let text = textarea.value;
      let escaped = escapeHtml(text);
      Object.keys(SAMPLE_VALUES).forEach(function(key){
        const re = new RegExp('\\{' + key + '\\}', 'g');
        escaped = escaped.replace(re, SAMPLE_VALUES[key]);
      });
      escaped = escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="#" onclick="return false;">$1</a>');
      previewBody.innerHTML = escaped;
    }

    function updateCounter(){
      const len = textarea.value.length;
      charLabel.textContent = 'Caracteres: ' + len + ' / ' + MAX_CHARS;
      charFill.style.width = Math.min(100, (len / MAX_CHARS) * 100) + '%';
    }

    function refresh(){
      renderPreview();
      updateCounter();
    }

    textarea.addEventListener('input', refresh);

    placeholdersRow.querySelectorAll('.mensaje-placeholder-chip').forEach(function(chip){
      chip.addEventListener('click', function(){
        const ph = '{' + chip.getAttribute('data-ph') + '}';
        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const value = textarea.value;
        textarea.value = value.slice(0, start) + ph + value.slice(end);
        const newPos = start + ph.length;
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
        refresh();
      });
    });

    function loadTemplate(){
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY); } catch(e){}
      textarea.value = saved || DEFAULT_TEMPLATE;
      refresh();
    }

    function openModal(){
      loadTemplate();
      overlay.classList.add('open');
    }
    function closeModal(){
      overlay.classList.remove('open');
    }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e){
      if (e.target === overlay) closeModal();
    });

    guardarBtn.addEventListener('click', function(){
      try { localStorage.setItem(STORAGE_KEY, textarea.value); } catch(e){}
      closeModal();
    });

    restaurarBtn.addEventListener('click', function(){
      textarea.value = DEFAULT_TEMPLATE;
      refresh();
    });
  })();

  // Modal "Conexión con Mercado Libre" (botón "Conexiones" del panel Análisis)
  (function(){
    const openBtn = document.getElementById('gestionConexionesBtn');
    if (!openBtn) return;

    const overlay = document.createElement('div');
    overlay.className = 'conexiones-modal-overlay';
    overlay.innerHTML =
      '<div class="conexiones-modal">' +
        '<button type="button" class="conexiones-modal-close" aria-label="Cerrar">✕</button>' +
        '<p class="conexiones-modal-title">Conexión con Mercado Libre</p>' +
        '<p class="conexiones-modal-desc">Conecta tu cuenta de vendedor para recibir notificaciones automáticas de ventas.</p>' +
        '<div class="conexiones-status-box is-connected" id="conexionesStatusBox">' +
          '<div class="conexiones-status-header">' +
            '<svg class="conexiones-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>' +
            '<span id="conexionesStatusLabel">Cuenta Conectada</span>' +
          '</div>' +
          '<div class="conexiones-status-row">' +
            '<span>Seller ID:</span>' +
            '<span class="conexiones-status-row-value" id="conexionesSellerId">1859008228</span>' +
          '</div>' +
          '<div class="conexiones-status-row">' +
            '<span>Conectado:</span>' +
            '<span class="conexiones-status-row-value" id="conexionesConectadoFecha">18/07/2026, 02:45 a. m.</span>' +
          '</div>' +
          '<div class="conexiones-token-box">' +
            '<span>Estado del Token:</span>' +
            '<span class="conexiones-status-row-value" id="conexionesTokenEstado">Expira en 4h 50m</span>' +
          '</div>' +
        '</div>' +
        '<div class="conexiones-actions">' +
          '<button type="button" class="conexiones-btn conexiones-btn--reconectar" id="conexionesReconectarBtn">Reconectar</button>' +
          '<button type="button" class="conexiones-btn conexiones-btn--desconectar" id="conexionesDesconectarBtn">Desconectar</button>' +
        '</div>' +
        '<p class="conexiones-hint">Los tokens se refrescan automáticamente cada 6 horas</p>' +
      '</div>';
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.conexiones-modal-close');
    const reconectarBtn = overlay.querySelector('#conexionesReconectarBtn');
    const desconectarBtn = overlay.querySelector('#conexionesDesconectarBtn');
    const statusBox = overlay.querySelector('#conexionesStatusBox');
    const statusLabel = overlay.querySelector('#conexionesStatusLabel');
    const tokenEstado = overlay.querySelector('#conexionesTokenEstado');

    let isConnected = true; // estado inicial: conectada (coincide con el HTML de arriba)

    function formatFechaAhora(){
      try {
        return new Date().toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      } catch(e){
        return new Date().toString();
      }
    }

    function refreshConnectionUI(){
      openBtn.classList.toggle('is-connected', isConnected);
      openBtn.classList.toggle('is-disconnected', !isConnected);
      if (statusBox){
        statusBox.classList.toggle('is-connected', isConnected);
        statusBox.classList.toggle('is-disconnected', !isConnected);
      }
      if (statusLabel) statusLabel.textContent = isConnected ? 'Cuenta Conectada' : 'Cuenta Desconectada';
      if (tokenEstado) tokenEstado.textContent = isConnected ? 'Expira en 4h 50m' : 'Sin token activo';
      if (reconectarBtn) reconectarBtn.style.display = isConnected ? 'none' : '';
      if (desconectarBtn) desconectarBtn.style.display = isConnected ? '' : 'none';
    }

    function openModal(){
      overlay.classList.add('open');
    }
    function closeModal(){
      overlay.classList.remove('open');
    }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e){
      if (e.target === overlay) closeModal();
    });

    reconectarBtn.addEventListener('click', function(){
      // Placeholder: aquí se dispararía el flujo de reconexión OAuth con Mercado Libre.
      isConnected = true;
      const fechaEl = overlay.querySelector('#conexionesConectadoFecha');
      if (fechaEl) fechaEl.textContent = formatFechaAhora();
      refreshConnectionUI();
      closeModal();
    });

    desconectarBtn.addEventListener('click', function(){
      // Placeholder: aquí se dispararía la desconexión de la cuenta de Mercado Libre.
      isConnected = false;
      refreshConnectionUI();
      closeModal();
    });

    refreshConnectionUI();
  })();

  // Panel desplegable "Notificaciones" (#gestionNotificacionBtn)
  (function(){
    const dropdown = document.getElementById('notifDropdown');
    const openBtn = document.getElementById('gestionNotificacionBtn');
    const panel = document.getElementById('notifPanel');
    const listEl = document.getElementById('notifPanelList');
    const badge = document.getElementById('notifDropdownBadge');
    const clearBtn = document.getElementById('notifPanelClear');
    if (!dropdown || !openBtn || !panel || !listEl) return;

    // Datos de ejemplo; en un entorno real vendrían del backend / de eventos reales.
    let notificaciones = [
      { id: 1, titulo: 'Nueva venta en Mercado Libre', desc: 'Se vendió "Invitación cumpleaños temática" (x2).', tiempo: 'Hace 12 min', leida: false },
      { id: 2, titulo: 'Sincronización completada', desc: 'Se actualizaron 34 publicaciones.', tiempo: 'Hace 1 h', leida: false },
      { id: 3, titulo: 'Token por expirar', desc: 'El token de Mercado Libre expira en 4h 50m.', tiempo: 'Hace 3 h', leida: true }
    ];

    function renderBadge(){
      const noLeidas = notificaciones.filter(function(n){ return !n.leida; }).length;
      if (!badge) return;
      if (noLeidas > 0){
        badge.textContent = noLeidas > 9 ? '9+' : String(noLeidas);
        badge.classList.remove('hide');
      } else {
        badge.textContent = '';
        badge.classList.add('hide');
      }
    }

    function renderList(){
      listEl.innerHTML = '';
      if (!notificaciones.length){
        const empty = document.createElement('div');
        empty.className = 'notif-panel-empty';
        empty.textContent = 'No tenés notificaciones por ahora.';
        listEl.appendChild(empty);
        renderBadge();
        return;
      }
      notificaciones.forEach(function(n){
        const item = document.createElement('div');
        item.className = 'notif-item' + (n.leida ? '' : ' unread');
        item.innerHTML =
          '<span class="notif-item-title">' + n.titulo + '</span>' +
          '<span class="notif-item-desc">' + n.desc + '</span>' +
          '<span class="notif-item-time">' + n.tiempo + '</span>';
        item.addEventListener('click', function(){
          n.leida = true;
          renderList();
        });
        listEl.appendChild(item);
      });
      renderBadge();
    }

    function toggleDropdown(e){
      e.stopPropagation();
      dropdown.classList.toggle('open');
    }

    openBtn.addEventListener('click', toggleDropdown);

    if (clearBtn){
      clearBtn.addEventListener('click', function(e){
        e.stopPropagation();
        notificaciones.forEach(function(n){ n.leida = true; });
        renderList();
      });
    }

    document.addEventListener('click', function(e){
      if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
    });

    renderList();
  })();

  // Vista "Mis Tareas" (#gestionNotaBtn): alta, marcado de cumplidas, orden por prioridad
  (function(){
    const openBtn = document.getElementById('gestionNotaBtn');
    if (!openBtn) return;

    const STORAGE_KEY = 'superimprimible_tareas';
    const PRIORIDAD_ORDEN = { alta: 0, media: 1, baja: 2 };
    const PRIORIDAD_LABEL = { alta: 'Alta', media: 'Media', baja: 'Baja' };

    const overlay = document.createElement('div');
    overlay.className = 'tareas-modal-overlay';
    overlay.innerHTML =
      '<div class="tareas-modal">' +
        '<button type="button" class="tareas-modal-close" aria-label="Cerrar">✕</button>' +
        '<div class="tareas-head">' +
          '<h2 class="tareas-modal-title">Mis tareas</h2>' +
          '<span class="tareas-toolbar-count" id="tareasContador">0 tareas</span>' +
        '</div>' +
        '<div class="tareas-form-row">' +
          '<input type="text" class="tareas-form-input" id="tareasNuevoInput" placeholder="Agregar una tarea y presionar Enter..." autocomplete="off">' +
          '<button type="button" class="tareas-sort-btn" id="tareasOrdenarBtn" aria-label="Ordenar por prioridad" title="Ordenar por prioridad">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5h10"/><path d="M11 9h7"/><path d="M11 13h4"/><path d="M3 17l3 3 3-3"/><path d="M6 18V4"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="tareas-list" id="tareasList"></div>' +
      '</div>';
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('.tareas-modal-close');
    const nuevoInput = overlay.querySelector('#tareasNuevoInput');
    const listEl = overlay.querySelector('#tareasList');
    const contadorEl = overlay.querySelector('#tareasContador');
    const ordenarBtn = overlay.querySelector('#tareasOrdenarBtn');

    let tareas = [];
    let ordenPorPrioridad = false;
    let seq = 1;
    const PRIORIDAD_CICLO = { alta: 'media', media: 'baja', baja: 'alta' };

    function cargarTareas(){
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw){
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) tareas = parsed;
        }
      } catch(e){ tareas = []; }
      seq = tareas.reduce(function(max, t){ return Math.max(max, t.id || 0); }, 0) + 1;
    }

    function guardarTareas(){
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tareas)); } catch(e){}
    }

    function tareasOrdenadas(){
      const copia = tareas.slice();
      if (ordenPorPrioridad){
        copia.sort(function(a, b){
          if (a.done !== b.done) return a.done ? 1 : -1;
          return (PRIORIDAD_ORDEN[a.prioridad] ?? 1) - (PRIORIDAD_ORDEN[b.prioridad] ?? 1);
        });
      }
      return copia;
    }

    function renderTareas(){
      listEl.innerHTML = '';
      const items = tareasOrdenadas();

      if (!items.length){
        const empty = document.createElement('div');
        empty.className = 'tareas-empty';
        empty.textContent = 'Todavía no agregaste ninguna tarea.';
        listEl.appendChild(empty);
      } else {
        items.forEach(function(tarea){
          const row = document.createElement('div');
          row.className = 'tarea-item' + (tarea.done ? ' done' : '');

          const dot = document.createElement('button');
          dot.type = 'button';
          dot.className = 'tarea-priority-dot';
          dot.dataset.priority = tarea.prioridad;
          dot.title = 'Prioridad: ' + (PRIORIDAD_LABEL[tarea.prioridad] || 'Media') + ' (clic para cambiar)';
          dot.addEventListener('click', function(){
            tarea.prioridad = PRIORIDAD_CICLO[tarea.prioridad] || 'media';
            guardarTareas();
            renderTareas();
          });

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'tarea-checkbox';
          checkbox.checked = !!tarea.done;
          checkbox.setAttribute('aria-label', 'Marcar como cumplida');
          checkbox.addEventListener('change', function(){
            tarea.done = checkbox.checked;
            guardarTareas();
            renderTareas();
          });

          const title = document.createElement('span');
          title.className = 'tarea-title';
          title.textContent = tarea.texto;

          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'tarea-delete';
          deleteBtn.setAttribute('aria-label', 'Eliminar tarea');
          deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
          deleteBtn.addEventListener('click', function(){
            tareas = tareas.filter(function(t){ return t.id !== tarea.id; });
            guardarTareas();
            renderTareas();
          });

          row.appendChild(dot);
          row.appendChild(checkbox);
          row.appendChild(title);
          row.appendChild(deleteBtn);
          listEl.appendChild(row);
        });
      }

      const pendientes = tareas.filter(function(t){ return !t.done; }).length;
      contadorEl.textContent = tareas.length === 0
        ? '0 tareas'
        : pendientes + ' pendiente' + (pendientes === 1 ? '' : 's') + ' de ' + tareas.length;

      ordenarBtn.classList.toggle('is-active', ordenPorPrioridad);
    }

    function agregarTarea(){
      const texto = nuevoInput.value.trim();
      if (!texto) return;
      tareas.push({
        id: seq++,
        texto: texto,
        prioridad: 'media',
        done: false
      });
      nuevoInput.value = '';
      guardarTareas();
      renderTareas();
      nuevoInput.focus();
    }

    nuevoInput.addEventListener('keydown', function(e){
      if (e.key === 'Enter'){
        e.preventDefault();
        agregarTarea();
      }
    });

    ordenarBtn.addEventListener('click', function(){
      ordenPorPrioridad = !ordenPorPrioridad;
      renderTareas();
    });

    function openModal(){
      cargarTareas();
      renderTareas();
      overlay.classList.add('open');
      nuevoInput.focus();
    }
    function closeModal(){
      overlay.classList.remove('open');
    }

    openBtn.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', function(e){
      if (e.target === overlay) closeModal();
    });
  })();

  // Interruptor "MAQUETA" del rail vertical: decide si #side-card es visible.
  (function(){
    const toggle = document.getElementById('railMaquetaToggle');
    const sideCard = document.getElementById('side-card');
    if (!toggle || !sideCard) return;

    function applyMaquetaVisibility(){
      sideCard.style.display = toggle.checked ? '' : 'none';
    }

    toggle.addEventListener('change', applyMaquetaVisibility);
    applyMaquetaVisibility();
  })();

  // Círculo de color: al hacer click, abre el selector de colores nativo.
  (function(){
    function wireColorCircle(circleId, inputId){
      const colorCircle = document.getElementById(circleId);
      const colorInput = document.getElementById(inputId);
      if (!colorCircle || !colorInput) return;

      // El círculo arranca con el mismo color que trae el <input type="color"> por defecto.
      colorCircle.style.background = colorInput.value;

      colorCircle.addEventListener('click', () => {
        colorInput.click();
      });

      colorInput.addEventListener('input', () => {
        colorCircle.style.background = colorInput.value;
      });
    }
    wireColorCircle('fuentesEfectoBordesBlancos', 'fuentesEfectoBordesBlancosPickerInput');
    wireColorCircle('fuentesEfectoIluminacion', 'fuentesEfectoIluminacionPickerInput');
  })();

  // Paleta cómic (span.vcp-wrap) del panel flotante de Diseño (#sp2ColorSwatchTrigger):
  // mismo widget que el de Temáticas, conectado al <input type="color"> de Diseño
  // (#sp2ColorPickerInput).
  (function(){
    var toolColorInput = document.getElementById('sp2ColorPickerInput');
    var swatchTrigger = document.getElementById('sp2ColorSwatchTrigger');
    var palette = document.getElementById('sp2ComicPalette');
    var paletteBtns = palette ? palette.querySelectorAll('.vcp-item') : [];
    if(!toolColorInput || !swatchTrigger || !palette) return;

    document.body.appendChild(palette); // se independiza del layout para poder anclarse (fixed)

    function isTrigger(el){
      return !!(el && el.closest && el.closest('.vcp-trigger'));
    }
    function positionPalette(){
      var rect = swatchTrigger.getBoundingClientRect();
      var x = Math.max(90, Math.min(window.innerWidth - 90, rect.left + rect.width / 2));
      var y = rect.bottom + 10;
      palette.style.left = x + 'px';
      palette.style.top = y + 'px';
    }
    function closePalette(){
      palette.classList.remove('open');
      swatchTrigger.setAttribute('aria-expanded', 'false');
    }
    function openPalette(){
      positionPalette();
      palette.classList.add('open');
      swatchTrigger.setAttribute('aria-expanded', 'true');
      var currentHex = (toolColorInput.value || '').toLowerCase();
      paletteBtns.forEach(function(b){
        b.classList.toggle('selected', b.dataset.color.toLowerCase() === currentHex);
      });
    }

    swatchTrigger.addEventListener('click', function(e){
      e.stopPropagation();
      if(palette.classList.contains('open')) closePalette();
      else openPalette();
    });

    var previewOriginal = null;
    paletteBtns.forEach(function(btn){
      btn.addEventListener('mouseenter', function(){
        if(previewOriginal === null) previewOriginal = toolColorInput.value;
        toolColorInput.value = btn.dataset.color;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
      });
      btn.addEventListener('mouseleave', function(){
        if(previewOriginal === null) return;
        toolColorInput.value = previewOriginal;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        previewOriginal = null;
      });
      btn.addEventListener('click', function(){
        previewOriginal = null;
        toolColorInput.value = btn.dataset.color;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        closePalette();
      });
    });

    document.addEventListener('click', function(e){
      if(!palette.classList.contains('open')) return;
      if(palette.contains(e.target)) return;
      if(isTrigger(e.target)) return;
      closePalette();
    });
  })();

  // Paleta cómic (span.vcp-wrap) agregada al lado de #tematicasTextureCircle:
  // mismo widget que el swatch de "Color del pincel" de Fuentes/Texturas/Elementos,
  // pero conectado directamente al <input type="color"> ya existente de Temáticas
  // (#tematicasColorPickerInput).
  (function(){
    var toolColorInput = document.getElementById('tematicasColorPickerInput');
    var swatchTrigger = document.getElementById('tematicasColorSwatchTrigger');
    var palette = document.getElementById('tematicasComicPalette');
    var paletteBtns = palette ? palette.querySelectorAll('.vcp-item') : [];
    if(!toolColorInput || !swatchTrigger || !palette) return;

    document.body.appendChild(palette); // se independiza del layout para poder anclarse (fixed)

    function isTrigger(el){
      return !!(el && el.closest && el.closest('.vcp-trigger'));
    }
    function positionPalette(){
      var rect = swatchTrigger.getBoundingClientRect();
      var x = Math.max(90, Math.min(window.innerWidth - 90, rect.left + rect.width / 2));
      var y = rect.bottom + 10;
      palette.style.left = x + 'px';
      palette.style.top = y + 'px';
    }
    function closePalette(){
      palette.classList.remove('open');
      swatchTrigger.setAttribute('aria-expanded', 'false');
    }
    function openPalette(){
      positionPalette();
      palette.classList.add('open');
      swatchTrigger.setAttribute('aria-expanded', 'true');
      var currentHex = (toolColorInput.value || '').toLowerCase();
      paletteBtns.forEach(function(b){
        b.classList.toggle('selected', b.dataset.color.toLowerCase() === currentHex);
      });
    }

    swatchTrigger.addEventListener('click', function(e){
      e.stopPropagation();
      if(palette.classList.contains('open')) closePalette();
      else openPalette();
    });

    // Preview en vivo: al pasar el mouse por un color de la paleta se aplica de
    // inmediato (sin hacer clic todavía); si se saca el mouse sin elegir, se
    // restaura el color anterior.
    var previewOriginal = null;
    paletteBtns.forEach(function(btn){
      btn.addEventListener('mouseenter', function(){
        if(previewOriginal === null) previewOriginal = toolColorInput.value;
        toolColorInput.value = btn.dataset.color;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
      });
      btn.addEventListener('mouseleave', function(){
        if(previewOriginal === null) return;
        toolColorInput.value = previewOriginal;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        previewOriginal = null;
      });
      btn.addEventListener('click', function(){
        previewOriginal = null;
        toolColorInput.value = btn.dataset.color;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        closePalette();
      });
    });

    document.addEventListener('click', function(e){
      if(!palette.classList.contains('open')) return;
      if(palette.contains(e.target)) return;
      if(isTrigger(e.target)) return;
      closePalette();
    });
  })();

  // Selector de color "Color del pincel" copiado a la Vista Fuentes (#fuentesVectorizeToolColorPicker):
  // mismo widget (cuentagotas + paleta cómic) que en los modales de Elementos/Texturas, pero
  // autónomo (no repinta ningún canvas, solo guarda/expone el color elegido).
  (function(){
    var toolColorPicker = document.getElementById('fuentesVectorizeToolColorPicker');
    var toolColorInput = document.getElementById('fuentesVectorizeToolColor');
    var eyedropper = document.getElementById('fuentesVectorizeColorEyedropper');
    var swatchTrigger = document.getElementById('fuentesVectorizeColorSwatchTrigger');
    var palette = document.getElementById('fuentesVectorizeComicPalette');
    var paletteBtns = palette ? palette.querySelectorAll('.vcp-item') : [];
    if(!toolColorPicker || !toolColorInput || !swatchTrigger || !palette) return;

    document.body.appendChild(palette); // se independiza del layout para poder anclarse (fixed)

    function paintColorUI(hex){
      toolColorPicker.style.setProperty('--tool-color-current', hex);
    }
    paintColorUI(toolColorInput.value);

    function isTrigger(el){
      return !!(el && el.closest && el.closest('.vcp-trigger'));
    }
    function positionPalette(){
      var rect = swatchTrigger.getBoundingClientRect();
      var x = Math.max(90, Math.min(window.innerWidth - 90, rect.left + rect.width / 2));
      var y = rect.bottom + 10;
      palette.style.left = x + 'px';
      palette.style.top = y + 'px';
    }
    function closePalette(){
      palette.classList.remove('open');
      swatchTrigger.setAttribute('aria-expanded', 'false');
    }
    function openPalette(){
      positionPalette();
      palette.classList.add('open');
      swatchTrigger.setAttribute('aria-expanded', 'true');
      var currentHex = (toolColorInput.value || '').toLowerCase();
      paletteBtns.forEach(function(b){
        b.classList.toggle('selected', b.dataset.color.toLowerCase() === currentHex);
      });
    }

    swatchTrigger.addEventListener('click', function(e){
      e.stopPropagation();
      if(palette.classList.contains('open')) closePalette();
      else openPalette();
    });

    // Preview en vivo: al pasar el mouse por un color de la paleta se aplica de
    // inmediato (sin hacer clic todavía); si se saca el mouse sin elegir, se
    // restaura el color anterior.
    var previewOriginal = null;
    paletteBtns.forEach(function(btn){
      btn.addEventListener('mouseenter', function(){
        if(previewOriginal === null) previewOriginal = toolColorInput.value;
        toolColorInput.value = btn.dataset.color;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
      });
      btn.addEventListener('mouseleave', function(){
        if(previewOriginal === null) return;
        toolColorInput.value = previewOriginal;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        previewOriginal = null;
      });
      btn.addEventListener('click', function(){
        previewOriginal = null;
        toolColorInput.value = btn.dataset.color;
        toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        closePalette();
      });
    });

    document.addEventListener('click', function(e){
      if(!palette.classList.contains('open')) return;
      if(palette.contains(e.target)) return;
      if(isTrigger(e.target)) return;
      closePalette();
    });

    toolColorInput.addEventListener('input', function(){
      paintColorUI(toolColorInput.value);
      if(window.__setFuentesLetterTint) window.__setFuentesLetterTint(toolColorInput.value);
    });

    if(eyedropper){
      eyedropper.addEventListener('click', function(){
        if(window.EyeDropper){
          new EyeDropper().open().then(function(result){
            toolColorInput.value = result.sRGBHex;
            toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
          }).catch(function(){ /* usuario canceló */ });
        } else {
          toolColorInput.click();
        }
      });
    }
  })();

  // Reguladores de Efectos Aplicables (Fuentes): muestran su valor numérico en vivo
  (function(){
    function wireRangeVal(rangeId, valId){
      const range = document.getElementById(rangeId);
      const val = document.getElementById(valId);
      if (!range || !val) return;
      val.textContent = range.value;
      range.addEventListener('input', () => {
        val.textContent = range.value;
      });
    }
    wireRangeVal('fuentesEfectoBordesBlancosRange', 'fuentesEfectoBordesBlancosVal');
    wireRangeVal('fuentesEfectoIluminacionRange', 'fuentesEfectoIluminacionVal');
  })();

  // Modal flotante: Texturas
  (function(){
    const openBtn = document.getElementById('sp2TextureCircle');
    const openBtn2 = document.getElementById('tematicasTextureCircle');
    const closeBtn = document.getElementById('textureModalClose');
    const backdrop = document.getElementById('textureModalBackdrop');
    const categoriesWrap = document.getElementById('texturePickerCategories');
    const gridWrap = document.getElementById('texturePickerGrid');
    if ((!openBtn && !openBtn2) || !closeBtn || !backdrop) return;

    let activeTriggerEl = null;
    let activeSubcategory = '';

    // Las categorías del picker se generan a partir de las subcategorías disponibles
    // en las texturas guardadas
    function populateCategories(){
      if (!categoriesWrap) return;
      categoriesWrap.innerHTML = '';
      
      const todasBtn = document.createElement('button');
      todasBtn.type = 'button';
      todasBtn.className = 'subcategory-btn' + (activeSubcategory === '' ? ' active' : '');
      todasBtn.dataset.subcategory = '';
      todasBtn.textContent = 'Todas';
      categoriesWrap.appendChild(todasBtn);

      // Obtener subcategorías únicas de las texturas guardadas
      if (typeof GestorTexturas !== 'undefined') {
        const texturas = GestorTexturas.listar();
        const subcategorias = new Set();
        texturas.forEach(function(tex) {
          if (tex.subcategoria) subcategorias.add(tex.subcategoria);
        });
        
        // Lista de subcategorías en orden
        const subcategoriasOrdenadas = [
          'Acuarelas',
          'Geométricas y Minimalistas',
          'Orgánicas y Botánicas',
          'Texturas de Materiales Naturales',
          'Efectos Metálicos y Foil',
          'Glitter y Brillos',
          'Efecto Pizarra y Tiza'
        ];
        
        subcategoriasOrdenadas.forEach(function(nombre) {
          if (subcategorias.has(nombre)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'subcategory-btn' + (activeSubcategory === nombre ? ' active' : '');
            btn.dataset.subcategory = nombre;
            btn.textContent = nombre;
            categoriesWrap.appendChild(btn);
          }
        });
      }
    }

    function applyTexture(textura){
      if (!activeTriggerEl || !textura || !textura.preview) return;
      activeTriggerEl.style.backgroundImage = 'url("' + textura.preview + '")';
      activeTriggerEl.style.backgroundSize = 'cover';
      activeTriggerEl.style.backgroundPosition = 'center';
      activeTriggerEl.dataset.selectedTexture = textura.id;
      activeTriggerEl.dataset.selectedTextureName = textura.nombre;
      console.log('[Texture Picker] Textura seleccionada:', textura.nombre);
    }

    function renderGrid(){
      if (!gridWrap) return;
      gridWrap.innerHTML = '';
      
      if (typeof GestorTexturas === 'undefined') {
        console.warn('[Texture Picker] GestorTexturas no está disponible');
        const empty = document.createElement('div');
        empty.className = 'texture-picker-empty';
        empty.textContent = 'Error: Sistema de texturas no disponible.';
        gridWrap.appendChild(empty);
        return;
      }
      
      const texturas = GestorTexturas.listar();
      
      // Filtrar por subcategoría activa
      const texturasFiltradasFiltered = texturas.filter(function(tex) {
        if (!activeSubcategory) return true;
        return tex.subcategoria === activeSubcategory;
      });

      if (!texturasFiltradasFiltered.length){
        const empty = document.createElement('div');
        empty.className = 'texture-picker-empty';
        empty.textContent = 'Todavía no cargaste texturas en esa categoría. Subilas desde la vista "Texturas".';
        gridWrap.appendChild(empty);
        return;
      }

      texturasFiltradasFiltered.forEach(function(textura){
        const thumb = document.createElement('div');
        thumb.className = 'texture-picker-thumb';
        thumb.style.backgroundImage = 'url("' + textura.preview + '")';
        thumb.style.backgroundSize = 'cover';
        thumb.style.backgroundPosition = 'center';
        thumb.title = textura.nombre + (textura.subcategoria ? ' (' + textura.subcategoria + ')' : '');
        thumb.addEventListener('click', function(){
          gridWrap.querySelectorAll('.texture-picker-thumb.selected').forEach(function(t){ t.classList.remove('selected'); });
          thumb.classList.add('selected');
          applyTexture(textura);
          closeModal();
        });
        gridWrap.appendChild(thumb);
      });
    }

    if (categoriesWrap){
      categoriesWrap.addEventListener('click', function(e){
        const btn = e.target.closest('.subcategory-btn');
        if (!btn) return;
        activeSubcategory = btn.dataset.subcategory || '';
        categoriesWrap.querySelectorAll('.subcategory-btn').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        renderGrid();
      });
    }

    function openModal(e){
      activeTriggerEl = (e && e.currentTarget) || openBtn || openBtn2;
      activeSubcategory = '';
      populateCategories();
      renderGrid();
      backdrop.classList.add('open');
    }
    function closeModal(){ backdrop.classList.remove('open'); }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (openBtn2) openBtn2.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', function(e){
      if (e.target === backdrop) closeModal();
    });
  })();

  // Modal flotante: Fuente
  (function(){
    const openBtn = document.getElementById('sp2FontChooseBtn');
    const openBtn2 = document.getElementById('tematicasFontChooseBtn');
    const closeBtn = document.getElementById('fontModalClose');
    const backdrop = document.getElementById('fontModalBackdrop');
    const gridWrap = document.getElementById('fontPickerGrid');
    if ((!openBtn && !openBtn2) || !closeBtn || !backdrop) return;

    let activeTriggerEl = null;

    function applyFont(fuente){
      if (!activeTriggerEl || !fuente) return;
      // Guardar referencia a la fuente seleccionada
      activeTriggerEl.dataset.selectedFont = fuente.id;
      activeTriggerEl.dataset.selectedFontName = fuente.nombre;
      // Aquí se puede agregar lógica adicional para aplicar la fuente al elemento
      console.log('[Font Picker] Fuente seleccionada:', fuente.nombre);
    }

    function renderGrid(){
      if (!gridWrap) return;
      gridWrap.innerHTML = '';
      
      if (typeof GestorFuentes === 'undefined') {
        console.warn('[Font Picker] GestorFuentes no está disponible');
        const empty = document.createElement('div');
        empty.className = 'texture-picker-empty';
        empty.textContent = 'Error: Sistema de fuentes no disponible.';
        gridWrap.appendChild(empty);
        return;
      }
      
      const fuentes = GestorFuentes.listar();

      if (!fuentes.length){
        const empty = document.createElement('div');
        empty.className = 'texture-picker-empty';
        empty.id = 'fontPickerEmpty';
        empty.textContent = 'Todavía no agregaste fuentes en Marketing. Agregalas desde la categoría correspondiente.';
        gridWrap.appendChild(empty);
        return;
      }

      fuentes.forEach(function(fuente){
        const thumb = document.createElement('div');
        thumb.className = 'texture-picker-thumb font-picker-thumb';
        thumb.title = fuente.nombre;
        thumb.style.backgroundColor = '#fff';
        
        // Renderizar el texto "Aa" o "ABC" con la fuente guardada
        renderizarTextoConFuenteParaModal(fuente, 'ABC').then(function(canvas) {
          if (canvas) {
            thumb.style.backgroundImage = 'url("' + canvas.toDataURL('image/png') + '")';
            thumb.style.backgroundSize = 'contain';
            thumb.style.backgroundPosition = 'center';
            thumb.style.backgroundRepeat = 'no-repeat';
          }
        }).catch(function(err) {
          console.error('[Font Picker] Error al renderizar preview:', err);
          // Fallback: mostrar el nombre
          thumb.textContent = fuente.nombre.substring(0, 3);
        });
        
        thumb.addEventListener('click', function(){
          gridWrap.querySelectorAll('.font-picker-thumb.selected').forEach(function(t){ t.classList.remove('selected'); });
          thumb.classList.add('selected');
          applyFont(fuente);
          closeModal();
        });
        gridWrap.appendChild(thumb);
      });
    }

    // Función auxiliar para renderizar texto pequeño para el modal
    function renderizarTextoConFuenteParaModal(fuente, texto) {
      return new Promise(function(resolve, reject) {
        if (!fuente || !fuente.caracteres || !texto) {
          reject(new Error('Datos inválidos'));
          return;
        }
        
        var caracteres = fuente.caracteres;
        var spacing = 1;
        var targetHeight = 30; // Más pequeño para el modal
        
        var promesas = [];
        var charMap = {};
        
        for (var i = 0; i < texto.length; i++) {
          var char = texto[i];
          if (!caracteres[char]) continue;
          if (charMap[char]) continue;
          
          (function(c) {
            var promise = new Promise(function(res, rej) {
              var img = new Image();
              img.onload = function() { res({ char: c, img: img }); };
              img.onerror = function() { rej(new Error('Error cargando imagen')); };
              img.src = caracteres[c];
            });
            promesas.push(promise);
          })(char);
          
          charMap[char] = true;
        }
        
        Promise.all(promesas).then(function(resultados) {
          var loadedChars = {};
          resultados.forEach(function(r) {
            loadedChars[r.char] = r.img;
          });
          
          var totalWidth = 3;
          for (var i = 0; i < texto.length; i++) {
            var char = texto[i];
            if (!loadedChars[char]) continue;
            var img = loadedChars[char];
            var scale = targetHeight / img.height;
            var charWidth = img.width * scale;
            totalWidth += charWidth + spacing;
          }
          
          var canvas = document.createElement('canvas');
          canvas.width = totalWidth + 3;
          canvas.height = targetHeight + 6;
          var ctx = canvas.getContext('2d');
          
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          var x = 3;
          var y = 3;
          
          for (var i = 0; i < texto.length; i++) {
            var char = texto[i];
            if (!loadedChars[char]) continue;
            var img = loadedChars[char];
            var scale = targetHeight / img.height;
            var charWidth = img.width * scale;
            ctx.drawImage(img, x, y, charWidth, targetHeight);
            x += charWidth + spacing;
          }
          
          resolve(canvas);
        }).catch(reject);
      });
    }

    function openModal(e){
      activeTriggerEl = (e && e.currentTarget) || openBtn || openBtn2;
      renderGrid();
      backdrop.classList.add('open');
    }
    function closeModal(){ backdrop.classList.remove('open'); }

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (openBtn2) openBtn2.addEventListener('click', openModal);
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', function(e){
      if (e.target === backdrop) closeModal();
    });
  })();

  // Cuadrados "Personajes": click para subir una imagen
  // (excluye #tematicasPersonajesGrid, que tiene su propio manejo con
  // arrastrar y soltar + recorte de fondo automático, más abajo)
  (function(){
    const squares = Array.prototype.filter.call(
      document.querySelectorAll('.sp2-add-square'),
      function(sq){ return !sq.closest('#tematicasPersonajesGrid'); }
    );
    if (!squares.length) return;

    squares.forEach(function(square){
      square.addEventListener('click', function(){
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.style.display = 'none';
        input.addEventListener('change', function(){
          const file = input.files && input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = function(e){
            square.style.backgroundImage = 'url(' + e.target.result + ')';
            square.classList.add('has-image');
          };
          reader.readAsDataURL(file);
        });
        document.body.appendChild(input);
        input.click();
        input.addEventListener('change', function(){ input.remove(); });
      });
    });
  })();


  // Pestañas del panel lateral flotante (Plantilla / Diseño)
  (function(){
    const tabs = document.querySelectorAll('.floating-panel-tab');
    if (!tabs.length) return;

    tabs.forEach(function(tab){
      tab.addEventListener('click', function(){
        const target = tab.getAttribute('data-panel-view');

        tabs.forEach(function(t){ t.classList.remove('active'); });
        tab.classList.add('active');

        document.querySelectorAll('.floating-panel-view').forEach(function(view){
          view.classList.remove('active');
        });
        const targetView = document.getElementById('floatingPanelView-' + target);
        if (targetView) targetView.classList.add('active');
      });
    });
  })();

  // Popover de opciones (tuerca) sobre side-card
  (function(){
    const btn = document.getElementById('foldOptionsBtn');
    const popover = document.getElementById('foldOptionsPopover');
    if (!btn || !popover) return;

    function closePopover(){
      popover.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
    function togglePopover(e){
      e.stopPropagation();
      const isOpen = popover.classList.toggle('open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
    btn.addEventListener('click', togglePopover);
    document.addEventListener('click', function(e){
      if (!popover.contains(e.target) && e.target !== btn) closePopover();
    });
  })();

  const navItems = document.querySelectorAll('.nav-item[data-view]');
  const views = document.querySelectorAll('.view');

  const contentEl = document.querySelector('.content');

  // Grillas de tarjetas 1:1 que se agrandan/achican para llenar el espacio
  // disponible del contenedor sin necesitar barras de desplazamiento.
  // Se reutiliza para "Fuentes" (80 tarjetas) y "Marketing" (30 tarjetas).
  function layoutSquareGrid(gridId){
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const total = grid.children.length;
    if (!total) return;
    const gap = 10;
    const w = grid.clientWidth;
    const h = grid.clientHeight;
    if (!w || !h) return;

    // Probamos todas las combinaciones de columnas posibles y nos quedamos
    // con la que permite el cuadrado más grande sin desbordar el contenedor.
    let bestSize = 0;
    for (let cols = 1; cols <= total; cols++){
      const rows = Math.ceil(total / cols);
      const cellW = (w - gap * (cols - 1)) / cols;
      const cellH = (h - gap * (rows - 1)) / rows;
      const size = Math.min(cellW, cellH);
      if (size > bestSize) bestSize = size;
    }
    bestSize = Math.max(bestSize, 0);

    Array.from(grid.children).forEach(function(card){
      card.style.width = bestSize + 'px';
      card.style.height = bestSize + 'px';
    });
  }
  function layoutFuentesGrid(){ layoutSquareGrid('fuentesGrid'); }

  function buildSquareCardGrid(gridId, cardClass, idPrefix, total, selectable){
    const grid = document.getElementById(gridId);
    if (!grid) return;

    if (selectable === undefined) selectable = true;

    for (let i = 1; i <= total; i++){
      const card = document.createElement('div');
      card.className = cardClass;
      card.id = idPrefix + i;
      if (selectable){
        card.addEventListener('click', function(){
          grid.querySelectorAll('.' + cardClass + '.selected').forEach(function(el){
            el.classList.remove('selected');
          });
          card.classList.add('selected');
        });
      }
      grid.appendChild(card);
    }
  }

  (function(){
    buildSquareCardGrid('fuentesGrid', 'fuente-card', 'fuenteCard', 76, false);
    layoutFuentesGrid();

    let fuentesResizeTimer = null;
    window.addEventListener('resize', function(){
      clearTimeout(fuentesResizeTimer);
      fuentesResizeTimer = setTimeout(layoutFuentesGrid, 120);
    });
  })();

  function goToView(target){
    const navItem = document.querySelector('.nav-item[data-view="' + target + '"]');
    const targetView = document.getElementById('view-' + target);
    if (!navItem || !targetView) return;

    navItems.forEach(i => i.classList.remove('active'));
    navItem.classList.add('active');

    views.forEach(v => v.classList.remove('view-active'));
    targetView.classList.add('view-active');

    // #floatingPanelRail y #side-card son exclusivos de la vista "Plantilla" (diseno)
    document.body.classList.toggle('is-view-diseno', target === 'diseno');

    // Al entrar a "Fuentes" o "Marketing" recalculamos el tamaño de sus tarjetas 1:1,
    // porque mientras la vista estaba oculta su ancho/alto eran 0.
    if (target === 'fuentes' && typeof layoutFuentesGrid === 'function'){
      requestAnimationFrame(layoutFuentesGrid);
    }

    if (contentEl) contentEl.scrollTop = 0;
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      goToView(item.getAttribute('data-view'));
    });
  });

  const elementNames = [
    "Guirnalda", "Centro de mesa", "Cartel de bienvenida", "Topper de torta", "Etiquetas para regalos",
    "Marco de fotos", "Banderines", "Vasos personalizados", "Servilletas", "Manteles individuales",
    "Bolsitas de dulces", "Etiquetas para golosinas", "Cartel Candy Bar", "Vasos de golosinas", "Conitos de papel",
    "Stickers para bolsitas", "Base para cupcakes", "Tarjetas de sabores", "Cajitas individuales", "Cintas decorativas",
    "Bingo infantil", "Búsqueda del tesoro", "Memotest", "Tarjetas de adivinanzas", "Ruleta de preguntas",
    "Diploma de participación", "Tarjetas Yo nunca", "Sopa de letras", "Laberinto", "Dado de emociones",
    "Globos", "Piñata", "Velas de cumpleaños", "Confeti", "Serpentinas",
    "Manteles de mesa", "Platos descartables", "Vasos descartables", "Cubiertos descartables", "Servilletas decoradas",
    "Cotillón", "Sombreros de fiesta", "Antifaces", "Silbatos", "Matracas",
    "Stickers decorativos", "Imanes de recuerdo", "Bolsas de regalo", "Cintas para el cabello", "Coronitas"
  ];

  // Mapa de nombre de elemento -> categoría (Deco / Candy Bar / Juegos)
  const elementsByCategory = {
    "Deco": ["Guirnalda", "Centro de mesa", "Cartel de bienvenida", "Topper de torta", "Etiquetas para regalos", "Marco de fotos", "Banderines", "Vasos personalizados", "Servilletas", "Manteles individuales"],
    "Candy Bar": ["Bolsitas de dulces", "Etiquetas para golosinas", "Cartel Candy Bar", "Vasos de golosinas", "Conitos de papel", "Stickers para bolsitas", "Base para cupcakes", "Tarjetas de sabores", "Cajitas individuales", "Cintas decorativas"],
    "Juegos": ["Bingo infantil", "Búsqueda del tesoro", "Memotest", "Tarjetas de adivinanzas", "Ruleta de preguntas", "Diploma de participación", "Tarjetas Yo nunca", "Sopa de letras", "Laberinto", "Dado de emociones"]
  };
  const categoryMap = {};
  Object.entries(elementsByCategory).forEach(([catName, items]) => {
    items.forEach(name => { categoryMap[name] = catName; });
  });

  // ---------- Fecha y Hora del evento: precargar con la fecha/hora actual ----------
  (function initEventDateTime(){
    const dateInput = document.getElementById('event-date-input');
    const timeInput = document.getElementById('event-time-input');
    if (!dateInput && !timeInput) return;
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    if (dateInput && !dateInput.value){
      dateInput.value = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    }
    if (timeInput && !timeInput.value){
      timeInput.value = pad(now.getHours()) + ':' + pad(now.getMinutes());
    }
  })();

  // ══════════════════════════════════════════════════════════════════════
  // Funciones para integrar vistas previas de plantillas
  // ══════════════════════════════════════════════════════════════════════

  // Tarea 7.2: esDataUrlValido() y encontrarPlantilla()
  
  function esDataUrlValido(preview) {
    return typeof preview === 'string' && preview.startsWith('data:image/');
  }

  function encontrarPlantilla(plantillas, elementName, elementCategory) {
    if (!plantillas || !Array.isArray(plantillas) || plantillas.length === 0) {
      return null;
    }
    
    // Normalizar nombre y categoría
    var nameLower = (elementName || '').toLowerCase().trim();
    var categoryLower = (elementCategory || '').toLowerCase().trim();
    
    // 1. Buscar primero por nombre exacto (case-insensitive)
    if (nameLower) {
      var matchPorNombre = plantillas.find(function(p) {
        return p.nombre && p.nombre.toLowerCase().trim() === nameLower;
      });
      if (matchPorNombre) return matchPorNombre;
    }
    
    // 2. Fallback: buscar por categoría (retornar la primera que coincida)
    if (categoryLower) {
      var matchPorCategoria = plantillas.find(function(p) {
        return p.categoria && p.categoria.toLowerCase().trim() === categoryLower;
      });
      if (matchPorCategoria) return matchPorCategoria;
    }
    
    // 3. Sin coincidencia
    return null;
  }

  // ══════════════════════════════════════════════════════════════════════

  const elementsGrid = document.getElementById('elements-grid');

  // ══════════════════════════════════════════════════════════════════════
  // TARJETAS DE EJEMPLO COMENTADAS - Solo se mostrarán elementos guardados
  // ══════════════════════════════════════════════════════════════════════
  /*
  elementNames.forEach(itemName => {
    const card = document.createElement('div');
    card.className = 'element-card';
    card.dataset.name = itemName;
    card.dataset.category = categoryMap[itemName] || 'Otros';
    card.dataset.marketingCategory = 'Elementos';

    const topRow = document.createElement('div');
    topRow.className = 'element-top-row';
    topRow.addEventListener('click', (e) => {
      if (e.target.closest('button, input, label, a')) return;
      openElementDetailModal(itemName);
    });

    const square = document.createElement('div');
    square.className = 'element-square';

    const percentBadge = document.createElement('span');
    percentBadge.className = 'element-square-percent';
    percentBadge.textContent = '0%';
    square.appendChild(percentBadge);

    const dimensionBadge = document.createElement('button');
    dimensionBadge.type = 'button';
    dimensionBadge.className = 'square-dimension-badge';
    dimensionBadge.textContent = '2D';
    dimensionBadge.setAttribute('aria-label', 'Cambiar entre 2D y 3D');
    dimensionBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      dimensionBadge.textContent = dimensionBadge.textContent === '2D' ? '3D' : '2D';
    });
    square.appendChild(dimensionBadge);

    const editPencilSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    const gearIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82A1.65 1.65 0 003 13.09H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';
    const ajustesIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';

    const specs = document.createElement('div');
    specs.className = 'element-specs';
    specs.innerHTML =
      '<div class="spec-row"><span class="spec-label">Medidas</span><span class="spec-value">10 x 15 cm</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-medidas" aria-label="Editar medidas">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Medidas Plegado:</span><span class="spec-value">Sin definir</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-medidas-plegado" aria-label="Editar medidas plegado">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row spec-row-copias"><span class="spec-label">Copias:</span><span class="spec-value">Iguales</span>' +
        '<button type="button" class="spec-edit-btn" data-action="copias-engranaje" aria-label="Engranaje de copias">' + gearIconSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Categoria:</span><span class="spec-value">Sin definir</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-categoria" aria-label="Editar categoria">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Contenido</span><span class="spec-value">Sin contenido</span>' +
        '<button type="button" class="spec-edit-btn" data-action="ajustes-contenido" aria-label="Ajustes de contenido">' + ajustesIconSvg + '</button></div>';

    const specsAppearance = document.createElement('div');
    specsAppearance.className = 'element-specs';
    specsAppearance.innerHTML =
      '<div class="spec-row"><span class="spec-label">Fuente de nombre:</span><span class="spec-value">Inter</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-fuente-nombre" aria-label="Editar fuente de nombre">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Fuente de Edad:</span><span class="spec-value">Fuente Especial 1</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-fuente-edad" aria-label="Editar fuente de edad">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Iluminación:</span><span class="spec-value">50</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-iluminacion" aria-label="Editar iluminación">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Color:</span><span class="spec-value">Ocean</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-color" aria-label="Editar color">' + editPencilSvg + '</button></div>';

    const specsAssign = document.createElement('div');
    specsAssign.className = 'element-specs';
    specsAssign.innerHTML =
      '<div class="spec-row"><span class="spec-label">Personajes:</span><span class="spec-value">Sin asignar</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-personajes" aria-label="Editar personajes">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Fondos:</span><span class="spec-value">Sin asignar</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-fondos" aria-label="Editar fondos">' + editPencilSvg + '</button></div>';

    topRow.appendChild(square);
    topRow.appendChild(specs);
    topRow.appendChild(specsAppearance);
    topRow.appendChild(specsAssign);

    const row = document.createElement('div');
    row.className = 'quantities-row';
    row.innerHTML =
      '<span class="quantities-label">' + itemName + '</span>' +
      '<label class="element-lock-toggle">' +
        '<input type="checkbox" value="">' +
        '<div class="element-lock-track">' +
          '<svg class="element-lock-icon open" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M50,18A19.9,19.9,0,0,0,30,38v8a8,8,0,0,0-8,8V74a8,8,0,0,0,8,8H70a8,8,0,0,0,8-8V54a8,8,0,0,0-8-8H38V38a12,12,0,0,1,23.6-3,4,4,0,1,0,7.8-2A20.1,20.1,0,0,0,50,18Z"></path>' +
          '</svg>' +
          '<svg class="element-lock-icon closed" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
            '<path fill-rule="evenodd" d="M30,46V38a20,20,0,0,1,40,0v8a8,8,0,0,1,8,8V74a8,8,0,0,1-8,8H30a8,8,0,0,1-8-8V54A8,8,0,0,1,30,46Zm32-8v8H38V38a12,12,0,0,1,24,0Z"></path>' +
          '</svg>' +
          '<div class="element-lock-thumb"></div>' +
        '</div>' +
      '</label>';

    card.appendChild(topRow);
    card.appendChild(row);
    elementsGrid.appendChild(card);

    const lockInput = row.querySelector('.element-lock-toggle input');
    if (lockInput){
      lockInput.addEventListener('change', () => {
        applyElementsCategoryFilter();
      });
    }
  });
  */
  console.log('[Marketing] Tarjetas de ejemplo comentadas - Solo se mostrarán elementos guardados');

  // ══════════════════════════════════════════════════════════════════════
  // Tarea 7.4: aplicarVistasPrevia() - Aplicar previews de plantillas
  // ══════════════════════════════════════════════════════════════════════

  function aplicarVistasPrevia() {
    // Obtener todas las plantillas guardadas
    var plantillas = GestorPlantillas.listar();
    
    // Seleccionar todas las tarjetas de elementos
    var cards = document.querySelectorAll('#elements-grid .element-card');
    
    cards.forEach(function(card) {
      var elementName = card.dataset.name || '';
      var elementCategory = card.dataset.category || '';
      
      // Buscar plantilla que coincida
      var plantilla = encontrarPlantilla(plantillas, elementName, elementCategory);
      
      // Obtener el div .element-square
      var square = card.querySelector('.element-square');
      if (!square) return;
      
      if (plantilla && esDataUrlValido(plantilla.preview)) {
        // Aplicar vista previa
        square.style.backgroundImage = 'url("' + plantilla.preview + '")';
        square.style.backgroundSize = 'cover';
        square.style.backgroundPosition = 'center';
        square.style.backgroundRepeat = 'no-repeat';
      } else {
        // Restaurar estilos vacíos (preservar gradiente placeholder)
        square.style.backgroundImage = '';
        square.style.backgroundSize = '';
        square.style.backgroundPosition = '';
        square.style.backgroundRepeat = '';
      }
    });
  }

  // Llamar a aplicarVistasPrevia después de crear las tarjetas
  aplicarVistasPrevia();

  // ══════════════════════════════════════════════════════════════════════
  // Tarea 7.5: Suscribir a eventos para actualización automática
  // ══════════════════════════════════════════════════════════════════════

  // Evento para misma pestaña (cuando se guarda/elimina en Creador de Plantillas)
  window.addEventListener('superimprimible:plantillas-updated', aplicarVistasPrevia);

  // Evento cross-tab (cuando se modifica desde otra pestaña)
  window.addEventListener('storage', function(e) {
    if (e.key === 'superimprimible_plantillas') {
      aplicarVistasPrevia();
    }
  });

  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  // CARGAR ELEMENTOS GUARDADOS DESDE LOCALSTORAGE
  // ══════════════════════════════════════════════════════════════════════
  function cargarElementosGuardados() {
    console.log('[cargarElementosGuardados] Iniciando carga...');
    if (typeof GestorElementos === 'undefined') {
      console.warn('[Marketing] GestorElementos no está disponible');
      return;
    }
    
    var elementosGuardados = GestorElementos.listar();
    console.log('[cargarElementosGuardados] Elementos en localStorage:', elementosGuardados);
    
    if (!elementosGuardados || elementosGuardados.length === 0) {
      console.log('[cargarElementosGuardados] No hay elementos guardados');
      return;
    }
    
    elementosGuardados.forEach(function(elemento) {
      console.log('[cargarElementosGuardados] Procesando elemento:', elemento);
      // Verificar si ya existe una tarjeta con este nombre Y categoria Elementos
      var existingCard = document.querySelector('#elements-grid .element-card[data-name="' + elemento.nombre + '"][data-marketing-category="Elementos"]');
      console.log('[cargarElementosGuardados] Tarjeta existente para "' + elemento.nombre + '":', existingCard);
      
      if (existingCard) {
        // Actualizar la tarjeta existente con la imagen guardada
        var square = existingCard.querySelector('.element-square');
        if (square && elemento.preview) {
          console.log('[cargarElementosGuardados] Actualizando tarjeta existente');
          square.style.backgroundImage = 'url("' + elemento.preview + '")';
          square.style.backgroundSize = 'cover';
          square.style.backgroundPosition = 'center';
          square.style.backgroundRepeat = 'no-repeat';
        }
      } else {
        // Crear una nueva tarjeta para este elemento
        console.log('[cargarElementosGuardados] Creando nueva tarjeta para:', elemento.nombre);
        crearTarjetaElementoGuardado(elemento);
      }
    });
  }

  function crearTarjetaElementoGuardado(elemento) {
    console.log('[crearTarjetaElementoGuardado] Creando tarjeta para:', elemento);
    if (!elementsGrid) {
      console.error('[crearTarjetaElementoGuardado] elementsGrid no está definido!');
      return;
    }
    
    var card = document.createElement('div');
    card.className = 'element-card';
    card.dataset.name = elemento.nombre;
    card.dataset.category = elemento.categoria || 'Sin categoría';
    card.dataset.marketingCategory = 'Elementos';

    var topRow = document.createElement('div');
    topRow.className = 'element-top-row';
    topRow.addEventListener('click', function(e) {
      if (e.target.closest('button, input, label, a')) return;
      // openElementDetailModal(elemento.nombre); // Descomentar si existe esta función
    });

    var square = document.createElement('div');
    square.className = 'element-square';
    
    // Aplicar la imagen guardada
    if (elemento.preview) {
      square.style.backgroundImage = 'url("' + elemento.preview + '")';
      square.style.backgroundSize = 'cover';
      square.style.backgroundPosition = 'center';
      square.style.backgroundRepeat = 'no-repeat';
    }

    var percentBadge = document.createElement('span');
    percentBadge.className = 'element-square-percent';
    percentBadge.textContent = '100%';
    square.appendChild(percentBadge);

    var dimensionBadge = document.createElement('button');
    dimensionBadge.type = 'button';
    dimensionBadge.className = 'square-dimension-badge';
    dimensionBadge.textContent = '2D';
    dimensionBadge.setAttribute('aria-label', 'Cambiar entre 2D y 3D');
    dimensionBadge.addEventListener('click', function(e) {
      e.stopPropagation();
      dimensionBadge.textContent = dimensionBadge.textContent === '2D' ? '3D' : '2D';
    });
    square.appendChild(dimensionBadge);

    var editPencilSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

    var specs = document.createElement('div');
    specs.className = 'element-specs';
    specs.innerHTML =
      '<div class="spec-row"><span class="spec-label">Medidas</span><span class="spec-value">Auto</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-medidas" aria-label="Editar medidas">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Categoria:</span><span class="spec-value">' + (elemento.categoria || 'Elementos') + '</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-categoria" aria-label="Editar categoria">' + editPencilSvg + '</button></div>';

    topRow.appendChild(square);
    topRow.appendChild(specs);

    var row = document.createElement('div');
    row.className = 'quantities-row';
    row.innerHTML =
      '<span class="quantities-label">' + elemento.nombre + '</span>' +
      '<label class="element-lock-toggle">' +
        '<input type="checkbox" value="">' +
        '<div class="element-lock-track">' +
          '<svg class="element-lock-icon open" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M50,18A19.9,19.9,0,0,0,30,38v8a8,8,0,0,0-8,8V74a8,8,0,0,0,8,8H70a8,8,0,0,0,8-8V54a8,8,0,0,0-8-8H38V38a12,12,0,0,1,23.6-3,4,4,0,1,0,7.8-2A20.1,20.1,0,0,0,50,18Z"></path>' +
          '</svg>' +
          '<svg class="element-lock-icon closed" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
            '<path fill-rule="evenodd" d="M30,46V38a20,20,0,0,1,40,0v8a8,8,0,0,1,8,8V74a8,8,0,0,1-8,8H30a8,8,0,0,1-8-8V54A8,8,0,0,1,30,46Zm32-8v8H38V38a12,12,0,0,1,24,0Z"></path>' +
          '</svg>' +
          '<div class="element-lock-thumb"></div>' +
        '</div>' +
      '</label>';

    card.appendChild(topRow);
    card.appendChild(row);
    console.log('[crearTarjetaElementoGuardado] Agregando tarjeta al DOM...', card);
    elementsGrid.appendChild(card);
    console.log('[crearTarjetaElementoGuardado] Tarjeta agregada! Total en grid:', elementsGrid.children.length);

    var lockInput = row.querySelector('.element-lock-toggle input');
    if (lockInput) {
      lockInput.addEventListener('change', function() {
        if (typeof applyElementsCategoryFilter === 'function') {
          applyElementsCategoryFilter();
        }
      });
    }
    
    console.log('[crearTarjetaElementoGuardado] Tarjeta completa creada para:', elemento.nombre);
    
    // Reaplicar el filtro para que la nueva tarjeta se muestre/oculte según corresponda
    // (solo si elementsToolbar ya está definido - puede no estarlo durante la carga inicial)
    if (typeof applyElementsCategoryFilter === 'function') {
      try {
        console.log('[crearTarjetaElementoGuardado] Aplicando filtros de categoría...');
        applyElementsCategoryFilter();
      } catch (e) {
        console.log('[crearTarjetaElementoGuardado] No se pudo aplicar filtro todavía (carga inicial):', e.message);
      }
    }
  }

  // Cargar elementos guardados al iniciar
  // NO llamar acá porque elementsToolbar aún no existe
  // console.log('[Init] Llamando a cargarElementosGuardados en la inicialización...');
  // cargarElementosGuardados();

  // Escuchar cambios en el almacenamiento para recargar automáticamente
  window.addEventListener('superimprimible:elementos-updated', function() {
    console.log('[Marketing] Recargando elementos guardados...');
    cargarElementosGuardados();
    cargarElementosEnSidePanel(); // También actualizar el side-panel-2
  });
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  // CARGAR ELEMENTOS EN EL SIDE-PANEL-2 (Vista Diseño)
  // ══════════════════════════════════════════════════════════════════════
  function cargarElementosEnSidePanel() {
    console.log('[cargarElementosEnSidePanel] Iniciando carga en side-panel-2...');
    if (typeof GestorElementos === 'undefined') {
      console.warn('[SidePanel2] GestorElementos no está disponible');
      return;
    }
    
    var elementosGuardados = GestorElementos.listar();
    console.log('[cargarElementosEnSidePanel] Elementos disponibles:', elementosGuardados);
    
    // Llenar los cuadrados del side-panel-2 (máximo 24)
    for (var i = 1; i <= 24; i++) {
      var square = document.getElementById('sp2Elemento' + i);
      if (!square) continue;
      
      var elemento = elementosGuardados[i - 1]; // 0-indexed
      
      if (elemento && elemento.preview) {
        // Aplicar la imagen del elemento
        square.style.backgroundImage = 'url("' + elemento.preview + '")';
        square.style.backgroundSize = 'contain';
        square.style.backgroundPosition = 'center';
        square.style.backgroundRepeat = 'no-repeat';
        square.setAttribute('data-elemento-id', elemento.id);
        square.setAttribute('data-elemento-nombre', elemento.nombre);
        square.classList.add('has-element');
        
        // Hacer clickeable para aplicarlo sobre el canvas
        square.style.cursor = 'pointer';
        square.title = elemento.nombre;
      } else {
        // Limpiar cuadrado vacío
        square.style.backgroundImage = 'none';
        square.removeAttribute('data-elemento-id');
        square.removeAttribute('data-elemento-nombre');
        square.classList.remove('has-element');
        square.style.cursor = '';
        square.title = '';
      }
    }
    
    console.log('[cargarElementosEnSidePanel] Cargados', Math.min(elementosGuardados.length, 24), 'elementos en side-panel-2');
  }
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  // CARGAR TEXTURAS GUARDADAS DESDE LOCALSTORAGE
  // ══════════════════════════════════════════════════════════════════════
  function cargarTexturasGuardadas() {
    console.log('[cargarTexturasGuardadas] Iniciando carga...');
    if (typeof GestorTexturas === 'undefined') {
      console.warn('[Marketing] GestorTexturas no está disponible');
      return;
    }
    
    var texturasGuardadas = GestorTexturas.listar();
    console.log('[cargarTexturasGuardadas] Texturas en localStorage:', texturasGuardadas);
    
    if (!texturasGuardadas || texturasGuardadas.length === 0) {
      console.log('[cargarTexturasGuardadas] No hay texturas guardadas');
      return;
    }
    
    texturasGuardadas.forEach(function(textura) {
      console.log('[cargarTexturasGuardadas] Procesando textura:', textura);
      // Verificar si ya existe una tarjeta con este nombre Y categoria Texturas
      var existingCard = document.querySelector('#elements-grid .element-card[data-name="' + textura.nombre + '"][data-marketing-category="Texturas"]');
      console.log('[cargarTexturasGuardadas] Tarjeta existente para "' + textura.nombre + '":', existingCard);
      
      if (existingCard) {
        // Actualizar la tarjeta existente con la imagen guardada
        var square = existingCard.querySelector('.element-square');
        if (square && textura.preview) {
          console.log('[cargarTexturasGuardadas] Actualizando tarjeta existente');
          square.style.backgroundImage = 'url("' + textura.preview + '")';
          square.style.backgroundSize = 'cover';
          square.style.backgroundPosition = 'center';
          square.style.backgroundRepeat = 'no-repeat';
        }
      } else {
        // Crear una nueva tarjeta para esta textura
        console.log('[cargarTexturasGuardadas] Creando nueva tarjeta para:', textura.nombre);
        crearTarjetaTexturaGuardada(textura);
      }
    });
  }

  function crearTarjetaTexturaGuardada(textura) {
    console.log('[crearTarjetaTexturaGuardada] Creando tarjeta para:', textura);
    if (!elementsGrid) {
      console.error('[crearTarjetaTexturaGuardada] elementsGrid no está definido!');
      return;
    }
    
    var card = document.createElement('div');
    card.className = 'element-card';
    card.dataset.name = textura.nombre;
    card.dataset.category = textura.categoria || 'Sin categoría';
    card.dataset.marketingCategory = 'Texturas';
    card.dataset.marketingSubcategory = textura.subcategoria || '';

    var topRow = document.createElement('div');
    topRow.className = 'element-top-row';
    topRow.addEventListener('click', function(e) {
      if (e.target.closest('button, input, label, a')) return;
      // openElementDetailModal(textura.nombre); // Descomentar si existe esta función
    });

    var square = document.createElement('div');
    square.className = 'element-square';
    
    // Aplicar la imagen guardada
    if (textura.preview) {
      square.style.backgroundImage = 'url("' + textura.preview + '")';
      square.style.backgroundSize = 'cover';
      square.style.backgroundPosition = 'center';
      square.style.backgroundRepeat = 'no-repeat';
    }

    var percentBadge = document.createElement('span');
    percentBadge.className = 'element-square-percent';
    percentBadge.textContent = '100%';
    square.appendChild(percentBadge);

    var dimensionBadge = document.createElement('button');
    dimensionBadge.type = 'button';
    dimensionBadge.className = 'square-dimension-badge';
    dimensionBadge.textContent = '2D';
    dimensionBadge.setAttribute('aria-label', 'Cambiar entre 2D y 3D');
    dimensionBadge.addEventListener('click', function(e) {
      e.stopPropagation();
      dimensionBadge.textContent = dimensionBadge.textContent === '2D' ? '3D' : '2D';
    });
    square.appendChild(dimensionBadge);

    var editPencilSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

    var specs = document.createElement('div');
    specs.className = 'element-specs';
    specs.innerHTML =
      '<div class="spec-row"><span class="spec-label">Medidas</span><span class="spec-value">Auto</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-medidas" aria-label="Editar medidas">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Categoria:</span><span class="spec-value">' + (textura.categoria || 'Texturas') + '</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-categoria" aria-label="Editar categoria">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Subcategoria:</span><span class="spec-value">' + (textura.subcategoria || 'Sin subcategoría') + '</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-subcategoria" aria-label="Editar subcategoria">' + editPencilSvg + '</button></div>';

    topRow.appendChild(square);
    topRow.appendChild(specs);

    var row = document.createElement('div');
    row.className = 'quantities-row';
    row.innerHTML =
      '<span class="quantities-label">' + textura.nombre + '</span>' +
      '<label class="element-lock-toggle">' +
        '<input type="checkbox" value="">' +
        '<div class="element-lock-track">' +
          '<svg class="element-lock-icon open" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M50,18A19.9,19.9,0,0,0,30,38v8a8,8,0,0,0-8,8V74a8,8,0,0,0,8,8H70a8,8,0,0,0,8-8V54a8,8,0,0,0-8-8H38V38a12,12,0,0,1,23.6-3,4,4,0,1,0,7.8-2A20.1,20.1,0,0,0,50,18Z"></path>' +
          '</svg>' +
          '<svg class="element-lock-icon closed" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
            '<path fill-rule="evenodd" d="M30,46V38a20,20,0,0,1,40,0v8a8,8,0,0,1,8,8V74a8,8,0,0,1-8,8H30a8,8,0,0,1-8-8V54A8,8,0,0,1,30,46Zm32-8v8H38V38a12,12,0,0,1,24,0Z"></path>' +
          '</svg>' +
          '<div class="element-lock-thumb"></div>' +
        '</div>' +
      '</label>';

    card.appendChild(topRow);
    card.appendChild(row);
    console.log('[crearTarjetaTexturaGuardada] Agregando tarjeta al DOM...', card);
    elementsGrid.appendChild(card);
    console.log('[crearTarjetaTexturaGuardada] Tarjeta agregada! Total en grid:', elementsGrid.children.length);

    var lockInput = row.querySelector('.element-lock-toggle input');
    if (lockInput) {
      lockInput.addEventListener('change', function() {
        if (typeof applyElementsCategoryFilter === 'function') {
          applyElementsCategoryFilter();
        }
      });
    }
    
    console.log('[crearTarjetaTexturaGuardada] Tarjeta completa creada para:', textura.nombre);
    
    // Reaplicar el filtro para que la nueva tarjeta se muestre/oculte según corresponda
    if (typeof applyElementsCategoryFilter === 'function') {
      try {
        console.log('[crearTarjetaTexturaGuardada] Aplicando filtros de categoría...');
        applyElementsCategoryFilter();
      } catch (e) {
        console.log('[crearTarjetaTexturaGuardada] No se pudo aplicar filtro todavía (carga inicial):', e.message);
      }
    }
  }

  // Escuchar cambios en el almacenamiento para recargar automáticamente
  window.addEventListener('superimprimible:texturas-updated', function() {
    console.log('[Marketing] Recargando texturas guardadas...');
    cargarTexturasGuardadas();
  });
  // ══════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════
  // CARGAR FUENTES GUARDADAS DESDE LOCALSTORAGE
  // ══════════════════════════════════════════════════════════════════════
  function cargarFuentesGuardadas() {
    console.log('[cargarFuentesGuardadas] Iniciando carga...');
    if (typeof GestorFuentes === 'undefined') {
      console.warn('[Marketing] GestorFuentes no está disponible');
      return;
    }
    
    var fuentesGuardadas = GestorFuentes.listar();
    console.log('[cargarFuentesGuardadas] Fuentes en localStorage:', fuentesGuardadas);
    
    if (!fuentesGuardadas || fuentesGuardadas.length === 0) {
      console.log('[cargarFuentesGuardadas] No hay fuentes guardadas');
      return;
    }
    
    fuentesGuardadas.forEach(function(fuente) {
      console.log('[cargarFuentesGuardadas] Procesando fuente:', fuente);
      // Verificar si ya existe una tarjeta con este nombre Y categoria Fuentes
      var existingCard = document.querySelector('#elements-grid .element-card[data-name="' + fuente.nombre + '"][data-marketing-category="Fuentes"]');
      console.log('[cargarFuentesGuardadas] Tarjeta existente para "' + fuente.nombre + '":', existingCard);
      
      if (existingCard) {
        // Actualizar la tarjeta existente con la imagen guardada
        var square = existingCard.querySelector('.element-square');
        if (square && fuente.preview) {
          console.log('[cargarFuentesGuardadas] Actualizando tarjeta existente');
          square.style.backgroundImage = 'url("' + fuente.preview + '")';
          square.style.backgroundSize = 'contain';
          square.style.backgroundPosition = 'center';
          square.style.backgroundRepeat = 'no-repeat';
        }
      } else {
        // Crear una nueva tarjeta para esta fuente
        console.log('[cargarFuentesGuardadas] Creando nueva tarjeta para:', fuente.nombre);
        crearTarjetaFuenteGuardada(fuente);
      }
    });
  }

  function crearTarjetaFuenteGuardada(fuente) {
    console.log('[crearTarjetaFuenteGuardada] Creando tarjeta para:', fuente);
    if (!elementsGrid) {
      console.error('[crearTarjetaFuenteGuardada] elementsGrid no está definido!');
      return;
    }
    
    var card = document.createElement('div');
    card.className = 'element-card';
    card.dataset.name = fuente.nombre;
    card.dataset.category = fuente.categoria || 'Sin categoría';
    card.dataset.marketingCategory = 'Fuentes';

    var topRow = document.createElement('div');
    topRow.className = 'element-top-row';
    topRow.addEventListener('click', function(e) {
      if (e.target.closest('button, input, label, a')) return;
      // openElementDetailModal(fuente.nombre); // Descomentar si existe esta función
    });

    var square = document.createElement('div');
    square.className = 'element-square';
    square.style.backgroundColor = '#fff'; // Fondo blanco para que se vean las letras
    
    // Generar preview del texto "Super Imprimible" usando la fuente guardada (asíncrono)
    renderizarTextoConFuenteAsync(fuente, 'Super Imprimible').then(function(previewCanvas) {
      if (previewCanvas) {
        square.style.backgroundImage = 'url("' + previewCanvas.toDataURL('image/png') + '")';
        square.style.backgroundSize = 'contain';
        square.style.backgroundPosition = 'center';
        square.style.backgroundRepeat = 'no-repeat';
      }
    }).catch(function(err) {
      console.error('[crearTarjetaFuenteGuardada] Error al renderizar preview:', err);
    });

    var percentBadge = document.createElement('span');
    percentBadge.className = 'element-square-percent';
    percentBadge.textContent = '100%';
    square.appendChild(percentBadge);

    var dimensionBadge = document.createElement('button');
    dimensionBadge.type = 'button';
    dimensionBadge.className = 'square-dimension-badge';
    dimensionBadge.textContent = '2D';
    dimensionBadge.setAttribute('aria-label', 'Cambiar entre 2D y 3D');
    dimensionBadge.addEventListener('click', function(e) {
      e.stopPropagation();
      dimensionBadge.textContent = dimensionBadge.textContent === '2D' ? '3D' : '2D';
    });
    square.appendChild(dimensionBadge);

    var editPencilSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

    var numCaracteres = fuente.caracteres ? Object.keys(fuente.caracteres).length : 0;

    var specs = document.createElement('div');
    specs.className = 'element-specs';
    specs.innerHTML =
      '<div class="spec-row"><span class="spec-label">Caracteres</span><span class="spec-value">' + numCaracteres + '</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-caracteres" aria-label="Ver caracteres">' + editPencilSvg + '</button></div>' +
      '<div class="spec-row"><span class="spec-label">Categoria:</span><span class="spec-value">' + (fuente.categoria || 'Fuentes') + '</span>' +
        '<button type="button" class="spec-edit-btn" data-action="edit-categoria" aria-label="Editar categoria">' + editPencilSvg + '</button></div>';

    topRow.appendChild(square);
    topRow.appendChild(specs);

    var row = document.createElement('div');
    row.className = 'quantities-row';
    row.innerHTML =
      '<span class="quantities-label">' + fuente.nombre + '</span>' +
      '<label class="element-lock-toggle">' +
        '<input type="checkbox" value="">' +
        '<div class="element-lock-track">' +
          '<svg class="element-lock-icon open" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
            '<path d="M50,18A19.9,19.9,0,0,0,30,38v8a8,8,0,0,0-8,8V74a8,8,0,0,0,8,8H70a8,8,0,0,0,8-8V54a8,8,0,0,0-8-8H38V38a12,12,0,0,1,23.6-3,4,4,0,1,0,7.8-2A20.1,20.1,0,0,0,50,18Z"></path>' +
          '</svg>' +
          '<svg class="element-lock-icon closed" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
            '<path fill-rule="evenodd" d="M30,46V38a20,20,0,0,1,40,0v8a8,8,0,0,1,8,8V74a8,8,0,0,1-8,8H30a8,8,0,0,1-8-8V54A8,8,0,0,1,30,46Zm32-8v8H38V38a12,12,0,0,1,24,0Z"></path>' +
          '</svg>' +
          '<div class="element-lock-thumb"></div>' +
        '</div>' +
      '</label>';

    card.appendChild(topRow);
    card.appendChild(row);
    console.log('[crearTarjetaFuenteGuardada] Agregando tarjeta al DOM...', card);
    elementsGrid.appendChild(card);
    console.log('[crearTarjetaFuenteGuardada] Tarjeta agregada! Total en grid:', elementsGrid.children.length);

    var lockInput = row.querySelector('.element-lock-toggle input');
    if (lockInput) {
      lockInput.addEventListener('change', function() {
        if (typeof applyElementsCategoryFilter === 'function') {
          applyElementsCategoryFilter();
        }
      });
    }
    
    console.log('[crearTarjetaFuenteGuardada] Tarjeta completa creada para:', fuente.nombre);
    
    // Reaplicar el filtro para que la nueva tarjeta se muestre/oculte según corresponda
    if (typeof applyElementsCategoryFilter === 'function') {
      try {
        console.log('[crearTarjetaFuenteGuardada] Aplicando filtros de categoría...');
        applyElementsCategoryFilter();
      } catch (e) {
        console.log('[crearTarjetaFuenteGuardada] No se pudo aplicar filtro todavía (carga inicial):', e.message);
      }
    }
  }

  // Función auxiliar ASÍNCRONA para renderizar texto usando los caracteres de una fuente
  function renderizarTextoConFuenteAsync(fuente, texto) {
    return new Promise(function(resolve, reject) {
      if (!fuente || !fuente.caracteres || !texto) {
        return reject(new Error('Datos inválidos'));
      }
      
      texto = texto.toUpperCase(); // Convertir a mayúsculas
      var caracteres = fuente.caracteres;
      
      // Cargar todas las imágenes primero
      var loadPromises = [];
      var charImages = {};
      
      for (var i = 0; i < texto.length; i++) {
        var char = texto[i];
        if (char === ' ') continue;
        
        if (!caracteres[char]) {
          console.warn('[renderizarTextoConFuente] Carácter no disponible:', char);
          continue;
        }
        
        (function(index, character) {
          var img = new Image();
          var promise = new Promise(function(resolveImg) {
            img.onload = function() {
              charImages[index] = { img: img, char: character };
              resolveImg();
            };
            img.onerror = function() {
              console.error('[renderizarTextoConFuente] Error cargando imagen:', character);
              resolveImg(); // Continuar aunque falle
            };
          });
          img.src = caracteres[character];
          loadPromises.push(promise);
        })(i, char);
      }
      
      // Cuando todas las imágenes estén cargadas, renderizar
      Promise.all(loadPromises).then(function() {
        try {
          // Calcular dimensiones
          var maxHeight = 0;
          var totalWidth = 0;
          var spacing = 2;
          var targetHeight = 40;
          
          var charDimensions = [];
          
          for (var i = 0; i < texto.length; i++) {
            var char = texto[i];
            if (char === ' ') {
              charDimensions.push({ type: 'space', width: 15 });
              totalWidth += 15;
              continue;
            }
            
            if (!charImages[i]) continue;
            
            var charImg = charImages[i].img;
            var scale = targetHeight / (charImg.height || targetHeight);
            var charWidth = (charImg.width || 20) * scale;
            
            charDimensions.push({
              type: 'char',
              img: charImg,
              width: charWidth,
              height: targetHeight
            });
            
            totalWidth += charWidth + spacing;
            maxHeight = Math.max(maxHeight, targetHeight);
          }
          
          // Crear canvas con las dimensiones calculadas
          var canvas = document.createElement('canvas');
          canvas.width = totalWidth + 10; // padding
          canvas.height = maxHeight + 10; // padding
          var ctx = canvas.getContext('2d');
          
          // Fondo transparente
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          
          var x = 5; // padding inicial
          var y = 5;
          
          // Dibujar cada carácter
          for (var i = 0; i < charDimensions.length; i++) {
            var dim = charDimensions[i];
            
            if (dim.type === 'space') {
              x += dim.width;
            } else if (dim.type === 'char') {
              ctx.drawImage(dim.img, x, y, dim.width, dim.height);
              x += dim.width + spacing;
            }
          }
          
          resolve(canvas);
        } catch (error) {
          reject(error);
        }
      }).catch(reject);
    });
  }

  // Escuchar cambios en el almacenamiento para recargar automáticamente
  window.addEventListener('superimprimible:fuentes-updated', function() {
    console.log('[Marketing] Recargando fuentes guardadas...');
    cargarFuentesGuardadas();
  });
  // ══════════════════════════════════════════════════════════════════════


  // ---------- Vista alterna en columna 2 de la tarjeta: Tamaño Plano / Copias ----------
  (function initSpecsAltViews(){
    let uidCounter = 0;

    elementsGrid.querySelectorAll('.element-card').forEach(card => {
      const topRow = card.querySelector(':scope > .element-top-row');
      if (!topRow) return;
      const specsCol = topRow.querySelector(':scope > div:nth-child(2)');
      const assignCol = topRow.querySelector(':scope > div:nth-child(4)');
      if (!specsCol) return;

      let storedChildren = null; // guarda las filas originales mientras se muestra una vista alterna

      function restoreDefaultView(){
        if (!storedChildren) return;
        specsCol.innerHTML = '';
        specsCol.appendChild(storedChildren);
        storedChildren = null;
        specsCol.classList.remove('specs-alt-open');
      }

      function openAltView(buildContentFn){
        if (storedChildren) restoreDefaultView();
        const frag = document.createDocumentFragment();
        while (specsCol.firstChild){ frag.appendChild(specsCol.firstChild); }
        storedChildren = frag;
        specsCol.classList.add('specs-alt-open');
        buildContentFn();
      }

      // ---- Vista: Tamaño Plano ----
      const medidasBtn = specsCol.querySelector(':scope > div:nth-child(1) > button');
      if (medidasBtn){
        medidasBtn.addEventListener('click', (e) => {
          if (!card.classList.contains('has-qty')) return; // deja el comportamiento normal (modal) en tarjetas sin cantidad
          e.stopPropagation();

          uidCounter++;
          const uid = 'size-' + uidCounter;

          // tamaño base leído de la fila "Medidas" (ej: "10 x 15 cm"), antes de guardar/vaciar
          const medidasValueOriginal = specsCol.querySelector(':scope > div:nth-child(1) .spec-value');
          let baseW = 10, baseH = 15;
          if (medidasValueOriginal){
            const match = medidasValueOriginal.textContent.match(/([\d.]+)\s*x\s*([\d.]+)/i);
            if (match){ baseW = parseFloat(match[1]); baseH = parseFloat(match[2]); }
          }

          openAltView(() => {
            const view = document.createElement('div');
            view.className = 'size-edit-view';

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'specs-alt-close';
            closeBtn.setAttribute('aria-label', 'Cerrar');
            closeBtn.textContent = '✕';
            closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); restoreDefaultView(); });

            const controlGroup = document.createElement('div');
            controlGroup.className = 'control-group';
            controlGroup.innerHTML =
              '<label for="' + uid + '-range">Tamaño Plano (%): <span id="' + uid + '-val">100</span></label>' +
              '<input type="range" id="' + uid + '-range" min="10" max="500" value="100">';

            const infoList = document.createElement('ul');
            infoList.className = 'size-info-list';
            infoList.id = uid + '-info';

            const actions = document.createElement('div');
            actions.className = 'size-edit-actions';
            actions.innerHTML =
              '<button type="button" class="size-edit-reset">Restablecer</button>' +
              '<button type="button" class="size-edit-apply">Aplicar</button>';

            view.appendChild(closeBtn);
            view.appendChild(controlGroup);
            view.appendChild(infoList);
            view.appendChild(actions);
            specsCol.appendChild(view);

            const rangeInput = controlGroup.querySelector('input[type="range"]');
            const valSpan = controlGroup.querySelector('span');

            function updateInfoList(pct){
              const w = (baseW * pct / 100).toFixed(1);
              const h = (baseH * pct / 100).toFixed(1);
              infoList.innerHTML =
                '<li>Ancho: ' + w + ' cm</li>' +
                '<li>Alto: ' + h + ' cm</li>';
            }

            rangeInput.addEventListener('input', () => {
              const pct = parseInt(rangeInput.value, 10) || 100;
              valSpan.textContent = pct;
              updateInfoList(pct);
            });
            updateInfoList(100);

            actions.querySelector('.size-edit-reset').addEventListener('click', (ev) => {
              ev.stopPropagation();
              rangeInput.value = 100;
              valSpan.textContent = 100;
              updateInfoList(100);
            });

            actions.querySelector('.size-edit-apply').addEventListener('click', (ev) => {
              ev.stopPropagation();
              const pct = parseInt(rangeInput.value, 10) || 100;
              const w = (baseW * pct / 100).toFixed(1);
              const h = (baseH * pct / 100).toFixed(1);
              const medidasRow = storedChildren.children[0];
              const medidasValue = medidasRow ? medidasRow.querySelector('.spec-value') : null;
              if (medidasValue) medidasValue.textContent = w + ' x ' + h + ' cm';
              card.dataset.sizePercent = pct;
              restoreDefaultView();
            });
          });
        });
      }

      // ---- Vista: Copias (engranaje) ----
      const copiasBtn = specsCol.querySelector(':scope > div.spec-row-copias > button');
      if (copiasBtn){
        copiasBtn.addEventListener('click', (e) => {
          if (!card.classList.contains('has-qty')) return;
          e.stopPropagation();

          openAltView(() => {
            const view = document.createElement('div');
            view.className = 'copias-edit-view';

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'specs-alt-close';
            closeBtn.setAttribute('aria-label', 'Cerrar');
            closeBtn.textContent = '✕';
            closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); restoreDefaultView(); });
            view.appendChild(closeBtn);

            if (assignCol){
              const scaleWrap = document.createElement('div');
              scaleWrap.className = 'copias-assign-scale';

              const clone = assignCol.cloneNode(true);
              clone.classList.remove('settings-popover', 'open');
              clone.classList.add('copias-assign-clone');
              scaleWrap.appendChild(clone);
              view.appendChild(scaleWrap);

              const options = clone.querySelectorAll('.settings-option');
              options.forEach(opt => {
                opt.addEventListener('click', (ev) => {
                  ev.stopPropagation();
                  options.forEach(o => o.classList.remove('selected'));
                  opt.classList.add('selected');
                  const groupIgual = clone.querySelector('.popover-assign-group[data-variation-group="igual"]');
                  const groupVariacion = clone.querySelector('.popover-assign-group[data-variation-group="variacion"]');
                  if (groupIgual) groupIgual.classList.toggle('open', opt.dataset.variation === 'igual');
                  if (groupVariacion) groupVariacion.classList.toggle('open', opt.dataset.variation === 'variacion');
                  card.dataset.variation = opt.dataset.variation;

                  const copiasRow = Array.from(storedChildren.children).find(el => el.classList && el.classList.contains('spec-row-copias'));
                  if (copiasRow){
                    const val = copiasRow.querySelector('.spec-value');
                    if (val) val.textContent = (opt.dataset.variation === 'variacion') ? 'Con Variaciones' : 'Iguales';
                  }
                });
              });

              const colorInput = clone.querySelector('.popover-color-input');
              if (colorInput){
                colorInput.addEventListener('input', () => {
                  const swatch = colorInput.previousElementSibling;
                  if (swatch) swatch.style.background = colorInput.value;
                });
              }
            }

            specsCol.appendChild(view);
          });
        });
      }

      // ---- Vista: Contenido (ajustes) ----
      const contenidoBtn = specsCol.querySelector(':scope > div:nth-child(5) > button');
      if (contenidoBtn){
        contenidoBtn.addEventListener('click', (e) => {
          if (!card.classList.contains('has-qty')) return;
          e.stopPropagation();

          openAltView(() => {
            const view = document.createElement('div');
            view.className = 'content-edit-view';

            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'specs-alt-close';
            closeBtn.setAttribute('aria-label', 'Cerrar');
            closeBtn.textContent = '✕';
            closeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); restoreDefaultView(); });
            view.appendChild(closeBtn);

            const fieldsWrap = document.createElement('div');
            fieldsWrap.className = 'content-edit-fields';
            fieldsWrap.innerHTML =
              '<div class="control-group"><label>Texto 1:</label><input type="text" class="content-text-input" data-field="texto1" placeholder="Campo de texto editable"></div>' +
              '<div class="control-group"><label>Texto 2:</label><input type="text" class="content-text-input" data-field="texto2" placeholder="Campo de texto editable"></div>' +
              '<div class="control-group"><label>Texto 3:</label><input type="text" class="content-text-input" data-field="texto3" placeholder="Campo de texto editable"></div>';
            view.appendChild(fieldsWrap);

            const actions = document.createElement('div');
            actions.className = 'size-edit-actions';
            actions.innerHTML =
              '<button type="button" class="size-edit-reset">Restablecer</button>' +
              '<button type="button" class="size-edit-apply">Aplicar</button>';
            view.appendChild(actions);

            const inputs = fieldsWrap.querySelectorAll('.content-text-input');
            const savedValues = card.dataset.contentTexts ? JSON.parse(card.dataset.contentTexts) : {};
            inputs.forEach(inp => {
              if (savedValues[inp.dataset.field]) inp.value = savedValues[inp.dataset.field];
            });

            actions.querySelector('.size-edit-reset').addEventListener('click', (ev) => {
              ev.stopPropagation();
              inputs.forEach(inp => { inp.value = ''; });
            });

            actions.querySelector('.size-edit-apply').addEventListener('click', (ev) => {
              ev.stopPropagation();
              const values = {};
              inputs.forEach(inp => { values[inp.dataset.field] = inp.value; });
              card.dataset.contentTexts = JSON.stringify(values);

              const contenidoRow = storedChildren.children[4];
              const contenidoValue = contenidoRow ? contenidoRow.querySelector('.spec-value') : null;
              if (contenidoValue){
                const filled = Object.values(values).filter(v => v && v.trim() !== '');
                contenidoValue.textContent = filled.length ? filled.join(' / ') : 'Sin contenido';
              }
              restoreDefaultView();
            });

            specsCol.appendChild(view);
          });
        });
      }
    });
  })();

  // ---------- Filtro de categorías: Marketing (#elements-grid) ----------
  const elementsToolbar = document.querySelector('#view-marketing .category-toolbar');
  const marketingSearchInput = document.getElementById('marketingSearchInput');

  const chosenElementsList = document.getElementById('chosen-elements-list');

  const checkIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>';

  function buildMultiThumbGrid(count, selectedCount){
    let html = '';
    for (let i = 0; i < count; i++){
      const isSelected = i < selectedCount;
      html += '<div class="popover-multi-thumb' + (isSelected ? ' selected' : '') + '">' + checkIconSvg + '</div>';
    }
    return html;
  }

  function renderChosenElements(){
    if (!chosenElementsList) return;
    chosenElementsList.innerHTML = '';

    const chosenCards = elementsGrid.querySelectorAll('.element-card.has-qty');
    if (chosenCards.length === 0){
      const empty = document.createElement('div');
      empty.className = 'qty-empty-message';
      empty.textContent = 'Aquí aparecerán los elementos que elijas.';
      chosenElementsList.appendChild(empty);
      return;
    }

    chosenCards.forEach(card => {
      const qtyEl = card.querySelector('.stepper-value');
      const row = document.createElement('div');
      row.className = 'quantities-row';

      const label = document.createElement('span');
      label.className = 'quantities-label';
      label.textContent = card.dataset.name;
      row.appendChild(label);

      const stepper = document.createElement('div');
      stepper.className = 'stepper';
      const isIgual = card.dataset.variation === 'igual';
      const isVariacion = card.dataset.variation === 'variacion';
      stepper.innerHTML =
        '<button type="button" class="stepper-btn" data-action="dec">–</button>' +
        '<span class="stepper-value qty-active">' + (qtyEl ? qtyEl.textContent : '0') + '</span>' +
        '<button type="button" class="stepper-btn" data-action="inc">+</button>' +
        '<button type="button" class="stepper-btn" data-action="search" aria-label="Buscar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></button>' +
        '<div class="stepper-settings-wrap" data-item-name="' + card.dataset.name + '">' +
          '<button type="button" class="stepper-btn stepper-settings" data-action="settings" aria-label="Ajustes de copias">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82A1.65 1.65 0 003 13.09H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' +
          '</button>' +
          '<div class="settings-popover">' +
            '<button type="button" class="popover-close-btn" aria-label="Cerrar">✕</button>' +
            '<p class="settings-popover-text">Las copias de este elemento pueden variar entre los fondos y personajes, ¿o prefieres que todas las copias sean iguales?</p>' +
            '<button type="button" class="settings-option' + (isIgual ? ' selected' : '') + '" data-variation="igual">Copias Iguales</button>' +
            '<div class="popover-assign-group' + (isIgual ? ' open' : '') + '" data-variation-group="igual">' +
              '<div class="popover-assign-label popover-multi-label">Personaje:</div>' +
              '<div class="popover-multi-grid popover-multi-grid-10" data-select-mode="single">' + buildMultiThumbGrid(10, 1) + '</div>' +
              '<div class="popover-assign-label popover-multi-label">Fondo:</div>' +
              '<div class="popover-multi-grid popover-multi-grid-5" data-select-mode="single">' + buildMultiThumbGrid(5, 1) + '</div>' +
              '<div class="popover-assign-row">' +
                '<span class="popover-assign-label">Color:</span>' +
                '<div class="swatch sw-prism popover-color-swatch"></div>' +
                '<input type="color" class="popover-color-input" value="#8ec9e0" aria-label="Elegir color">' +
                '<div class="swatch sw-white popover-color-swatch"></div>' +
                '<div class="swatch sw-sage popover-color-swatch"></div>' +
                '<div class="swatch sw-ocean popover-color-swatch"></div>' +
                '<div class="swatch sw-charcoal popover-color-swatch"></div>' +
              '</div>' +
            '</div>' +
            '<button type="button" class="settings-option' + (isVariacion ? ' selected' : '') + '" data-variation="variacion">Copias con Variaciones</button>' +
            '<div class="popover-assign-group' + (isVariacion ? ' open' : '') + '" data-variation-group="variacion">' +
              '<div class="popover-assign-label popover-multi-label">Personaje:</div>' +
              '<div class="popover-multi-grid popover-multi-grid-10" data-select-mode="multi">' + buildMultiThumbGrid(10, 10) + '</div>' +
              '<div class="popover-assign-label popover-multi-label">Fondo:</div>' +
              '<div class="popover-multi-grid popover-multi-grid-5" data-select-mode="multi">' + buildMultiThumbGrid(5, 5) + '</div>' +
              '<div class="popover-assign-row">' +
                '<span class="popover-assign-label">Color:</span>' +
                '<div class="swatch sw-prism popover-color-swatch"></div>' +
                '<input type="color" class="popover-color-input" value="#8ec9e0" aria-label="Elegir color">' +
                '<div class="swatch sw-white popover-color-swatch"></div>' +
                '<div class="swatch sw-sage popover-color-swatch"></div>' +
                '<div class="swatch sw-ocean popover-color-swatch"></div>' +
                '<div class="swatch sw-charcoal popover-color-swatch"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      row.appendChild(stepper);

      stepper.querySelectorAll('.stepper-btn').forEach(btn => {
        if (btn.dataset.action !== 'inc' && btn.dataset.action !== 'dec') return;
        btn.addEventListener('click', () => {
          const sourceQtyEl = card.querySelector('.stepper-value');
          let value = parseInt(sourceQtyEl.textContent, 10) || 0;
          if (btn.dataset.action === 'inc') value += 1;
          if (btn.dataset.action === 'dec') value = Math.max(0, value - 1);
          sourceQtyEl.textContent = value;
          sourceQtyEl.classList.toggle('qty-active', value >= 1);
          card.classList.toggle('has-qty', value >= 1);
          applyElementsCategoryFilter();
        });
      });

      chosenElementsList.appendChild(row);

      // Sincroniza el contenido del popover de ajustes (chosen-elements-list > div > div > div > div)
      // con la 4ta columna de la tarjeta en elements-grid (element-top-row > div:nth-child(4)),
      // reemplazando el contenido actual de esa columna.
      const settingsPopoverContent = row.querySelector(':scope > div > div > div');
      const specsAssignTarget = card.querySelector(':scope > .element-top-row > div:nth-child(4)');
      if (settingsPopoverContent && specsAssignTarget){
        specsAssignTarget.innerHTML = settingsPopoverContent.innerHTML;
        const textToRemove = specsAssignTarget.querySelector(':scope > p');
        if (textToRemove) textToRemove.remove();
        const closeBtnToRemove = specsAssignTarget.querySelector(':scope > button.popover-close-btn');
        if (closeBtnToRemove) closeBtnToRemove.remove();
        // Necesario para que los handlers delegados (closest('.settings-popover')) encuentren
        // este contenedor y los botones funcionen dentro de la tarjeta.
        specsAssignTarget.classList.add('settings-popover', 'settings-popover-inline', 'open');
      }
    });
  }

  function applyElementsCategoryFilter(){
    if (!elementsToolbar) return;
    const activeBtn = elementsToolbar.querySelector('.category-btn.active');
    const cat = activeBtn ? activeBtn.textContent.trim() : 'Todos';
    const searchQuery = marketingSearchInput ? marketingSearchInput.value.trim().toLowerCase() : '';
    let visibleCount = 0;
    elementsGrid.querySelectorAll('.element-card').forEach(card => {
      let show;
      if (cat === 'Todos') show = true;
      else if (cat === 'Elegidos por Tí') show = card.classList.contains('has-qty');
      else {
        show = card.dataset.marketingCategory === cat;
        if (show){
          const subWrap = activeBtn ? activeBtn.closest('.category-with-sub') : null;
          if (subWrap){
            const activeSubBtn = subWrap.querySelector('.subcategory-btn.active');
            const subcat = activeSubBtn ? activeSubBtn.dataset.subcategory : '';
            if (subcat) show = card.dataset.marketingSubcategory === subcat;
          }
        }
      }
      if (show && searchQuery){
        const name = (card.dataset.name || '').toLowerCase();
        show = name.includes(searchQuery);
      }
      card.style.display = show ? '' : 'none';
      if (show) visibleCount++;
    });

    elementsGrid.classList.toggle('filter-chosen', cat === 'Elegidos por Tí');

    const emptyMessage = document.getElementById('elements-grid-empty');
    if (emptyMessage) {
      emptyMessage.classList.toggle('show', visibleCount === 0);
    }

    const chosenBtn = Array.from(elementsToolbar.querySelectorAll('.category-btn'))
      .find(b => b.textContent.trim() === 'Elegidos por Tí');
    if (chosenBtn) {
      const hasChosenItems = elementsGrid.querySelectorAll('.element-card.has-qty').length > 0;
      chosenBtn.classList.toggle('has-items', hasChosenItems);
    }

    const totalCards = elementsGrid.querySelectorAll('.element-card').length;
    const completos = elementsGrid.querySelectorAll('.element-card.has-qty').length;
    const incompletos = totalCards - completos;
    const incompletosEl = document.getElementById('filter-count-incompletos');
    const completosEl = document.getElementById('filter-count-completos');
    if (incompletosEl) incompletosEl.textContent = incompletos;
    if (completosEl) completosEl.textContent = completos;

    const inactivos = elementsGrid.querySelectorAll('.element-lock-toggle input:checked').length;
    const activos = totalCards - inactivos;
    const activosEl = document.getElementById('filter-count-activos');
    const inactivosEl = document.getElementById('filter-count-inactivos');
    const ambosEl = document.getElementById('filter-count-ambos');
    if (activosEl) activosEl.textContent = activos;
    if (inactivosEl) inactivosEl.textContent = inactivos;
    if (ambosEl) ambosEl.textContent = totalCards;

    // "Plegables": todavía no hay un dato por tarjeta que indique si un elemento
    // es plegable o no, así que este contador queda en 0 hasta que se defina ese criterio.
    const plegablesEl = document.getElementById('filter-count-plegables');
    if (plegablesEl) plegablesEl.textContent = 0;

    renderChosenElements();
  }

  if (elementsToolbar){
    elementsToolbar.addEventListener('click', (e) => {
      const subBtn = e.target.closest('.subcategory-btn');
      if (subBtn && elementsToolbar.contains(subBtn)){
        e.stopPropagation();
        const wrap = subBtn.closest('.category-with-sub');
        const mainBtn = wrap ? wrap.querySelector(':scope > .category-btn') : null;
        if (mainBtn && !mainBtn.classList.contains('active')){
          elementsToolbar.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
          mainBtn.classList.add('active');
        }
        wrap.querySelectorAll('.subcategory-btn').forEach(b => b.classList.remove('active'));
        subBtn.classList.add('active');
        applyElementsCategoryFilter();
        return;
      }

      const btn = e.target.closest('.category-btn');
      if (btn && elementsToolbar.contains(btn)){
        elementsToolbar.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyElementsCategoryFilter();
      }
    });
  }

  if (marketingSearchInput){
    marketingSearchInput.addEventListener('input', applyElementsCategoryFilter);
  }

  applyElementsCategoryFilter();

  // Cargar elementos, texturas y fuentes guardados DESPUÉS de que elementsToolbar esté definido
  console.log('[Init] Llamando a cargarElementosGuardados después de inicializar filtros...');
  cargarElementosGuardados();
  console.log('[Init] Llamando a cargarElementosEnSidePanel para side-panel-2...');
  cargarElementosEnSidePanel();
  console.log('[Init] Llamando a cargarTexturasGuardadas después de inicializar filtros...');
  cargarTexturasGuardadas();
  console.log('[Init] Llamando a cargarFuentesGuardadas después de inicializar filtros...');
  cargarFuentesGuardadas();

  document.querySelectorAll('.stepper-btn').forEach(btn => {
    if (btn.dataset.action !== 'inc' && btn.dataset.action !== 'dec') return;
    btn.addEventListener('click', () => {
      const valueEl = btn.parentElement.querySelector('.stepper-value');
      let value = parseInt(valueEl.textContent, 10) || 0;
      if (btn.dataset.action === 'inc') value += 1;
      if (btn.dataset.action === 'dec') value = Math.max(0, value - 1);
      valueEl.textContent = value;
      valueEl.classList.toggle('qty-active', value >= 1);

      const card = btn.closest('.element-card');
      if (card){
        card.classList.toggle('has-qty', value >= 1);
        if (value >= 1) card.classList.remove('selected');
        applyElementsCategoryFilter();
      }
    });
  });

  // ---------- Selección de tarjetas de elementos ----------
  function selectElementCard(card){
    document.querySelectorAll('.element-card.selected').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
  }

  elementsGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.element-card');
    if (!card) return;
    if (e.target.closest('.stepper')) return; // no seleccionar al usar el stepper de la tarjeta
    if (card.classList.contains('has-qty')) return; // las tarjetas con cantidad asignada no son seleccionables
    selectElementCard(card);
  });

  // ---------- Menú de ajustes de copias (iguales / con variaciones) ----------
  function resetPopoverPosition(popover){
    popover.style.left = '';
    popover.style.right = '';
    popover.style.top = '';
    popover.style.bottom = '';
    popover.style.transform = '';
  }

  function keepPopoverInView(popover){
    const margin = 10;
    const rect = popover.getBoundingClientRect();

    // Ajuste horizontal: si se sale por la derecha o la izquierda, lo desplazamos.
    let shiftX = 0;
    if (rect.right > window.innerWidth - margin){
      shiftX = (window.innerWidth - margin) - rect.right;
    } else if (rect.left < margin){
      shiftX = margin - rect.left;
    }
    if (shiftX !== 0){
      popover.style.transform = 'translateX(' + shiftX + 'px)';
    }

    // Ajuste vertical: si no entra abajo, lo abrimos hacia arriba del botón.
    const updatedRect = popover.getBoundingClientRect();
    if (updatedRect.bottom > window.innerHeight - margin){
      popover.style.top = 'auto';
      popover.style.bottom = 'calc(100% + 8px)';
    }
  }

  // ---------- Vista de detalle de elemento (al hacer clic en la tarjeta) ----------
  const elementDetailOverlay = document.createElement('div');
  elementDetailOverlay.className = 'element-detail-overlay';
  elementDetailOverlay.innerHTML =
    '<div class="element-detail-modal">' +
      '<button type="button" class="element-detail-close" aria-label="Cerrar">✕</button>' +
      '<p class="element-detail-title"></p>' +
    '</div>';
  document.body.appendChild(elementDetailOverlay);
  const elementDetailTitle = elementDetailOverlay.querySelector('.element-detail-title');

  function openElementDetailModal(name){
    if (elementDetailTitle) elementDetailTitle.textContent = name;
    elementDetailOverlay.classList.add('open');
  }
  function closeElementDetailModal(){
    elementDetailOverlay.classList.remove('open');
  }

  elementDetailOverlay.querySelector('.element-detail-close').addEventListener('click', closeElementDetailModal);
  elementDetailOverlay.addEventListener('click', (e) => {
    if (e.target === elementDetailOverlay) closeElementDetailModal();
  });

  // ---------- Ventana flotante: Configuración de Medidas ----------
  const measuresModalOverlay = document.createElement('div');
  measuresModalOverlay.className = 'measures-modal-overlay';
  measuresModalOverlay.innerHTML =
    '<div class="measures-modal">' +
      '<button type="button" class="measures-modal-close" aria-label="Cerrar">✕</button>' +
      '<p class="measures-modal-title">Configuracion de Medidas</p>' +
    '</div>';
  document.body.appendChild(measuresModalOverlay);

  function openMeasuresModal(){
    measuresModalOverlay.classList.add('open');
  }
  function closeMeasuresModal(){
    measuresModalOverlay.classList.remove('open');
  }

  document.addEventListener('click', (e) => {
    const measuresBtn = e.target.closest('button[data-action="edit-medidas"]');
    if (measuresBtn){
      e.stopPropagation();
      openMeasuresModal();
      return;
    }
    if (e.target.closest('.measures-modal-close')){
      closeMeasuresModal();
      return;
    }
    if (e.target === measuresModalOverlay){
      closeMeasuresModal();
    }
  });

  document.addEventListener('click', (e) => {
    const settingsBtn = e.target.closest('.stepper-btn.stepper-settings');
    if (settingsBtn){
      e.stopPropagation();
      const popover = settingsBtn.parentElement.querySelector('.settings-popover');
      const wasOpen = popover.classList.contains('open');
      document.querySelectorAll('.settings-popover.open').forEach(p => { p.classList.remove('open'); resetPopoverPosition(p); });
      if (!wasOpen){
        resetPopoverPosition(popover);
        popover.classList.add('open');
        keepPopoverInView(popover);
      }
      return;
    }

    const option = e.target.closest('.settings-option');
    if (option){
      e.stopPropagation();
      const popover = option.closest('.settings-popover');
      popover.querySelectorAll('.settings-option').forEach(o => o.classList.remove('selected'));
      option.classList.add('selected');
      const assignGroupIgual = popover.querySelector('.popover-assign-group[data-variation-group="igual"]');
      const assignGroupVariacion = popover.querySelector('.popover-assign-group[data-variation-group="variacion"]');
      if (assignGroupIgual) assignGroupIgual.classList.toggle('open', option.dataset.variation === 'igual');
      if (assignGroupVariacion) assignGroupVariacion.classList.toggle('open', option.dataset.variation === 'variacion');
      const wrap = option.closest('.stepper-settings-wrap');
      const itemName = wrap ? wrap.dataset.itemName : null;
      const card = itemName ? elementsGrid.querySelector('.element-card[data-name="' + CSS.escape(itemName) + '"]') : option.closest('.element-card');
      if (card) card.dataset.variation = option.dataset.variation;
      if (card){
        const copiasRow = card.querySelector(':scope > .element-top-row > .element-specs .spec-row-copias');
        const copiasValue = copiasRow ? copiasRow.querySelector('.spec-value') : null;
        if (copiasValue) copiasValue.textContent = (option.dataset.variation === 'variacion') ? 'Con Variaciones' : 'Iguales';
      }
      return;
    }

    const closeBtn = e.target.closest('.popover-close-btn');
    if (closeBtn){
      e.stopPropagation();
      const popover = closeBtn.closest('.settings-popover');
      popover.classList.remove('open');
      resetPopoverPosition(popover);
      return;
    }

    const assignPick = e.target.closest('.thumb-replace, .popover-color-swatch, .popover-color-input, .popover-multi-thumb');
    if (assignPick && assignPick.closest('.settings-popover')){
      return;
    }

    document.querySelectorAll('.settings-popover.open').forEach(p => { p.classList.remove('open'); resetPopoverPosition(p); });
  });

  window.addEventListener('resize', () => {
    document.querySelectorAll('.settings-popover.open').forEach(p => { p.classList.remove('open'); resetPopoverPosition(p); });
  });

  // ---------- Ocultar / mostrar la tarjeta "Formulario" (botón "X" y botón "Formulario") ----------
  const infoCollapseBtn = document.getElementById('info-collapse-btn');
  const infoCard = document.getElementById('diseno-col-info');
  const appearanceBtn = document.getElementById('appearance-btn');

  function toggleInfoCard(){
    if (!infoCard) return;
    const hidden = infoCard.classList.toggle('hidden-card');
    if (infoCollapseBtn){
      infoCollapseBtn.setAttribute('aria-expanded', String(!hidden));
      infoCollapseBtn.setAttribute('aria-label', hidden ? 'Mostrar' : 'Cerrar');
    }
  }

  if (infoCollapseBtn) infoCollapseBtn.addEventListener('click', toggleInfoCard);
  if (appearanceBtn) appearanceBtn.addEventListener('click', toggleInfoCard);

  // ---------- Mostrar / ocultar la tarjeta flotante "¿Un Ajuste de Apariencia?" ----------
  const elementosAppearanceBtn = document.getElementById('elementos-appearance-btn');
  const elementosAppearancePanel = document.getElementById('elementos-appearance-panel');
  const elementosAppearanceCloseBtn = document.getElementById('elementos-appearance-close-btn');
  if (elementosAppearanceBtn && elementosAppearancePanel){
    elementosAppearanceBtn.addEventListener('click', () => {
      elementosAppearancePanel.classList.toggle('open');
    });
  }
  if (elementosAppearanceCloseBtn && elementosAppearancePanel){
    elementosAppearanceCloseBtn.addEventListener('click', () => {
      elementosAppearancePanel.classList.remove('open');
    });
  }

  const templateNames = [
    "Batman", "Mario", "Hadas", "Bosque", "Unicornio",
    "Dinosaurios", "Piratas", "Princesas", "Espacio", "Safari",
    "Sirenas", "Superhéroes", "Circo", "Granja", "Fútbol",
    "Ballenas", "Astronautas", "Dragones", "Camping", "Jardín",
    "Robots", "Payasos", "Estrellas", "Vaqueros", "Selva",
    "Frozen", "Spiderman", "Minecraft", "Pokémon", "Trolls",
    "Arcoíris", "Cars", "Avengers", "Barbie", "Dulces",
    "Globos", "Cielo Azul", "Tropical", "Nieve", "Otoño",
    "Mariposas", "Búhos", "Leones", "Tiburones", "Cohetes",
    "Castillos", "Hadas Madrinas", "Bosque Mágico", "Luna", "Estrellitas"
  ];

  // Mapa de plantilla -> categoría (Superhéroes / Fantasía / Aventura / Naturaleza)
  const templateCategoryMap = {
    "Batman": "Superhéroes", "Superhéroes": "Superhéroes", "Robots": "Superhéroes",
    "Spiderman": "Superhéroes", "Avengers": "Superhéroes", "Cohetes": "Superhéroes",

    "Hadas": "Fantasía", "Unicornio": "Fantasía", "Princesas": "Fantasía", "Sirenas": "Fantasía",
    "Dragones": "Fantasía", "Estrellas": "Fantasía", "Frozen": "Fantasía", "Trolls": "Fantasía",
    "Arcoíris": "Fantasía", "Barbie": "Fantasía", "Dulces": "Fantasía", "Castillos": "Fantasía",
    "Hadas Madrinas": "Fantasía", "Bosque Mágico": "Fantasía", "Luna": "Fantasía", "Estrellitas": "Fantasía",

    "Mario": "Aventura", "Dinosaurios": "Aventura", "Piratas": "Aventura", "Espacio": "Aventura",
    "Circo": "Aventura", "Fútbol": "Aventura", "Astronautas": "Aventura", "Payasos": "Aventura",
    "Vaqueros": "Aventura", "Minecraft": "Aventura", "Pokémon": "Aventura", "Cars": "Aventura",
    "Globos": "Aventura",

    "Bosque": "Naturaleza", "Safari": "Naturaleza", "Granja": "Naturaleza", "Ballenas": "Naturaleza",
    "Camping": "Naturaleza", "Jardín": "Naturaleza", "Selva": "Naturaleza", "Cielo Azul": "Naturaleza",
    "Tropical": "Naturaleza", "Nieve": "Naturaleza", "Otoño": "Naturaleza", "Mariposas": "Naturaleza",
    "Búhos": "Naturaleza", "Leones": "Naturaleza", "Tiburones": "Naturaleza"
  };

  const templateGrid = document.getElementById('template-grid');

  if (templateGrid) {
  templateNames.forEach((name, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'template-thumb';
    thumb.dataset.category = templateCategoryMap[name] || 'Otros';

    const box = document.createElement('div');
    box.className = 'template-thumb-box';

    const overlay = document.createElement('div');
    overlay.className = 'template-thumb-overlay';
    overlay.textContent = 'Elegir Diseño';
    box.appendChild(overlay);

    const label = document.createElement('div');
    label.className = 'template-thumb-name';
    label.textContent = name;

    thumb.appendChild(box);
    thumb.appendChild(label);

    thumb.addEventListener('click', () => {
      templateGrid.querySelectorAll('.template-thumb').forEach(t => t.classList.remove('selected'));
      thumb.classList.add('selected');
      goToView('elementos');
    });

    templateGrid.appendChild(thumb);
  });
  }

  // ---------- Ajuste de Apariencia: elegir colores y mover sliders ----------
  const swatchColorNames = {
    'sw-prism': 'Multicolor',
    'sw-white': 'Blanco',
    'sw-mauve': 'Malva',
    'sw-sage': 'Salvia',
    'sw-ocean': 'Ocean',
    'sw-periwinkle': 'Perivinca',
    'sw-orchid': 'Orquídea',
    'sw-clay': 'Terracota',
    'sw-charcoal': 'Carbón'
  };
  const swatchPalette = Object.keys(swatchColorNames);

  function getSwatchColorClass(swatchEl){
    return swatchPalette.find(cls => swatchEl.classList.contains(cls));
  }

  function setSwatchColor(swatchEl, colorClass){
    swatchPalette.forEach(cls => swatchEl.classList.remove(cls));
    swatchEl.classList.add(colorClass);
    const label = swatchEl.parentElement.querySelector('.swatch-label');
    if (label) label.textContent = swatchColorNames[colorClass] || '';
  }

  document.querySelectorAll('#view-elementos .swatch').forEach(swatchEl => {
    const colorInput = swatchEl.nextElementSibling && swatchEl.nextElementSibling.classList.contains('color-picker-input')
      ? swatchEl.nextElementSibling
      : null;

    swatchEl.addEventListener('click', () => {
      const group = swatchEl.closest('.swatches');

      if (group){
        // Grupo con varias opciones: seleccionamos una sola entre todas.
        group.querySelectorAll('.swatch').forEach(s => {
          s.classList.remove('selected');
          const lbl = s.parentElement.querySelector('.swatch-label');
          if (lbl && s !== swatchEl) lbl.textContent = '';
        });
        swatchEl.classList.add('selected');
        const label = swatchEl.parentElement.querySelector('.swatch-label');
        if (!colorInput){
          const currentClass = getSwatchColorClass(swatchEl);
          if (label && currentClass) label.textContent = swatchColorNames[currentClass] || '';
        }
      } else if (!colorInput){
        // Swatch único sin selector de color: recorre la paleta de colores.
        const currentClass = getSwatchColorClass(swatchEl) || swatchPalette[0];
        const currentIndex = swatchPalette.indexOf(currentClass);
        const nextClass = swatchPalette[(currentIndex + 1) % swatchPalette.length];
        setSwatchColor(swatchEl, nextClass);
        swatchEl.classList.add('selected');
      }

      if (colorInput) colorInput.click();
    });

    if (colorInput){
      colorInput.addEventListener('input', () => {
        swatchPalette.forEach(cls => swatchEl.classList.remove(cls));
        swatchEl.style.background = colorInput.value;
      });
    }
  });

  const thumbReplaceFileInput = document.getElementById('thumb-replace-file-input');
  let activeThumbReplaceTarget = null;

  if (thumbReplaceFileInput){
    document.addEventListener('click', (e) => {
      const thumbEl = e.target.closest('.thumb-replace');
      if (!thumbEl) return;
      activeThumbReplaceTarget = thumbEl;
      thumbReplaceFileInput.click();
    });

    thumbReplaceFileInput.addEventListener('change', () => {
      const file = thumbReplaceFileInput.files && thumbReplaceFileInput.files[0];
      if (!file || !activeThumbReplaceTarget) return;
      const reader = new FileReader();
      reader.onload = () => {
        activeThumbReplaceTarget.style.backgroundImage = 'url(' + reader.result + ')';
        activeThumbReplaceTarget.style.backgroundSize = 'cover';
        activeThumbReplaceTarget.style.backgroundPosition = 'center';
      };
      reader.readAsDataURL(file);
      thumbReplaceFileInput.value = '';
    });
  }

  document.addEventListener('click', (e) => {
    const multiThumb = e.target.closest('.popover-multi-thumb');
    if (!multiThumb) return;
    const grid = multiThumb.closest('.popover-multi-grid');
    const mode = grid ? grid.dataset.selectMode : 'multi';
    if (mode === 'single'){
      grid.querySelectorAll('.popover-multi-thumb').forEach(t => t.classList.remove('selected'));
      multiThumb.classList.add('selected');
    } else {
      multiThumb.classList.toggle('selected');
    }
  });

  document.addEventListener('click', (e) => {
    const colorSwatch = e.target.closest('.popover-color-swatch');
    if (colorSwatch){
      const colorInput = colorSwatch.nextElementSibling;
      if (colorInput && colorInput.type === 'color') colorInput.click();
      document.querySelectorAll('.popover-color-swatch.active').forEach(s => {
        if (s !== colorSwatch) s.classList.remove('active');
      });
      colorSwatch.classList.add('active');
      return;
    }
    document.querySelectorAll('.popover-color-swatch.active').forEach(s => s.classList.remove('active'));
  });

  document.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('popover-color-input')){
      const colorSwatch = e.target.previousElementSibling;
      if (colorSwatch) colorSwatch.style.background = e.target.value;
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.classList && e.target.classList.contains('popover-color-input')){
      const colorSwatch = e.target.previousElementSibling;
      if (colorSwatch) colorSwatch.classList.remove('active');
    }
  });

  document.querySelectorAll('#view-elementos input[type="range"]').forEach(rangeEl => {
    const updateRange = () => {
      const min = parseFloat(rangeEl.min) || 0;
      const max = parseFloat(rangeEl.max) || 100;
      const value = parseFloat(rangeEl.value) || 0;
      const percent = max > min ? ((value - min) / (max - min)) * 100 : 0;
      rangeEl.style.setProperty('--fill', percent + '%');

      const valueDisplay = rangeEl.closest('.slider-row').querySelector('.radius-value');
      if (valueDisplay) valueDisplay.textContent = Math.round(value);
    };

    rangeEl.addEventListener('input', updateRange);
    updateRange();
  });

  // ---------- Filtro de categorías: ¡Elige tú Diseño! ----------
  const templateToolbar = document.querySelector('#view-diseno .category-toolbar');
  if (templateToolbar){
    templateToolbar.querySelectorAll('.category-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        templateToolbar.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const cat = btn.textContent.trim();
        templateGrid.querySelectorAll('.template-thumb').forEach(thumb => {
          const show = (cat === 'Todos') || (thumb.dataset.category === cat);
          thumb.style.display = show ? '' : 'none';
        });
      });
    });
  }

  document.addEventListener('click', (e) => {
    document.querySelectorAll('.filter-dropdown.open').forEach(dropdown => {
      if (!dropdown.contains(e.target)) dropdown.classList.remove('open');
    });
  });

  const sidebarAccountBtn = document.getElementById('sidebar-account-btn');
  const accountMenu = document.getElementById('account-menu');

  if (sidebarAccountBtn && accountMenu){
    sidebarAccountBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      accountMenu.classList.toggle('open');
    });

    accountMenu.querySelectorAll('.account-menu-option').forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        accountMenu.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (!accountMenu.contains(e.target) && !sidebarAccountBtn.contains(e.target)){
        accountMenu.classList.remove('open');
      }
    });
  }

  // ---------- Botón de pantalla completa (dentro del menú de cuenta) ----------
  const accountMenuFullscreenBtn = document.getElementById('account-menu-fullscreen-btn');
  if (accountMenuFullscreenBtn){
    accountMenuFullscreenBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!document.fullscreenElement){
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });
  }

  // ---------- Iconos de Fecha y Hora: click abre el selector nativo ----------
  document.querySelectorAll('.datetime-item .dt-icon').forEach(icon => {
    icon.addEventListener('click', () => {
      const input = icon.nextElementSibling;
      if (!input) return;
      if (typeof input.showPicker === 'function'){
        try { input.showPicker(); } catch (err) { input.focus(); }
      } else {
        input.focus();
      }
    });
  });

  // ---------- Modal de descarga ----------
  const openDownloadModalBtn = document.getElementById('open-download-modal-btn');
  const downloadModalBackdrop = document.getElementById('download-modal-backdrop');
  const downloadModalClose = document.getElementById('download-modal-close');
  const downloadModalFileList = document.getElementById('download-modal-file-list');
  const downloadModalTotal = document.getElementById('download-modal-total');
  const downloadModalLocationBtn = document.getElementById('download-modal-location-btn');
  const downloadModalLocationText = document.getElementById('download-modal-location-text');
  const downloadModalConfirmBtn = document.getElementById('download-modal-confirm-btn');

  const fileIconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8l-5-5z"/><path d="M14 3v4a1 1 0 001 1h4"/></svg>';

  const paperSizeOptions = ['A4', 'Carta', 'Legal', 'A3', 'A5', 'Oficio'];
  const paperSizeSelectHtml =
    '<div class="download-modal-size-select-wrap">' +
      '<select class="download-modal-size-select" aria-label="Tamaño de hoja">' +
        paperSizeOptions.map(size => '<option value="' + size + '"' + (size === 'A4' ? ' selected' : '') + '>' + size + '</option>').join('') +
      '</select>' +
    '</div>';

  const downloadFiles = [
    { name: 'Invitación Imagen Digital', filename: 'Invitación Imagen Digital.jpg', size: '3.2 MB', checked: true },
    { name: 'Kit Imprimible para Cumpleaños', filename: 'Invitación PDF con Funciones.pdf', size: '4.5 MB', checked: true },
    { name: 'Papeles digicales', filename: 'Papeles digicales.pdf', size: '2.1 MB', checked: true }
  ];

  let downloadLocationChosen = false;

  function updateDownloadConfirmState(){
    const checkedCount = document.querySelectorAll('#download-modal-file-list input[type="checkbox"]:checked').length;
    downloadModalConfirmBtn.disabled = checkedCount === 0 || !downloadLocationChosen;
  }

  function updateDownloadTotal(){
    const checked = Array.from(document.querySelectorAll('#download-modal-file-list input[type="checkbox"]:checked'));
    let totalMb = 0;
    checked.forEach(input => {
      totalMb += parseFloat(input.dataset.size) || 0;
    });

    downloadModalTotal.textContent = checked.length
      ? checked.length + ' archivo' + (checked.length > 1 ? 's' : '') + ' · ' + totalMb.toFixed(1) + ' MB en total'
      : '';

    updateDownloadConfirmState();
  }

  function buildDownloadModalList(){
    downloadModalFileList.innerHTML = '';

    downloadFiles.forEach((file, index) => {
      const row = document.createElement('label');
      row.className = 'download-modal-file-row checkbox-row';
      row.innerHTML =
        '<input type="checkbox"' + (file.checked ? ' checked' : '') + ' data-filename="' + file.filename + '" data-size="' + file.size + '">' +
        '<span class="checkbox-box"></span>' +
        fileIconSvg +
        '<span class="download-modal-file-name">' + file.name + '</span>' +
        '<span class="download-modal-file-size">' + file.size + '</span>';

      const rowWithSelect = document.createElement('div');
      rowWithSelect.className = 'download-modal-file-row-with-select';
      rowWithSelect.appendChild(row);
      rowWithSelect.insertAdjacentHTML('beforeend', paperSizeSelectHtml);
      downloadModalFileList.appendChild(rowWithSelect);
    });

    downloadModalFileList.querySelectorAll('.download-modal-size-select').forEach(select => {
      select.addEventListener('click', e => e.stopPropagation());
      select.addEventListener('mousedown', e => e.stopPropagation());
      select.addEventListener('change', e => e.stopPropagation());
    });

    downloadModalFileList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', updateDownloadTotal);
    });

    updateDownloadTotal();
  }

  function openDownloadModal(){
    buildDownloadModalList();
    downloadModalBackdrop.classList.add('open');
  }

  function closeDownloadModal(){
    downloadModalBackdrop.classList.remove('open');
  }

  if (openDownloadModalBtn){
    openDownloadModalBtn.addEventListener('click', openDownloadModal);
  }

  if (downloadModalClose){
    downloadModalClose.addEventListener('click', closeDownloadModal);
  }

  if (downloadModalBackdrop){
    downloadModalBackdrop.addEventListener('click', (e) => {
      if (e.target === downloadModalBackdrop) closeDownloadModal();
    });
  }

  if (downloadModalLocationBtn){
    downloadModalLocationBtn.addEventListener('click', async () => {
      if (window.showDirectoryPicker){
        try{
          const dirHandle = await window.showDirectoryPicker();
          downloadModalLocationText.textContent = dirHandle.name;
          downloadModalLocationBtn.classList.add('chosen');
          downloadLocationChosen = true;
          updateDownloadConfirmState();
        } catch (err){
          // El usuario canceló el selector de carpeta
        }
      } else {
        downloadModalLocationText.textContent = 'Carpeta de Descargas (predeterminada)';
        downloadModalLocationBtn.classList.add('chosen');
        downloadLocationChosen = true;
        updateDownloadConfirmState();
      }
    });
  }

  if (downloadModalConfirmBtn){
    downloadModalConfirmBtn.addEventListener('click', () => {
      const originalHTML = downloadModalConfirmBtn.innerHTML;
      downloadModalConfirmBtn.disabled = true;
      downloadModalConfirmBtn.textContent = 'Descargando…';
      setTimeout(() => {
        closeDownloadModal();
        downloadModalConfirmBtn.innerHTML = originalHTML;
        downloadModalConfirmBtn.disabled = false;
      }, 900);
    });
  }

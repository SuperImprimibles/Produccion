(function() {
  'use strict';

  var triggerBtn     = document.getElementById('juntas-trigger-btn');
  var panel          = document.getElementById('juntas-panel');
  var closeBtn       = document.getElementById('juntas-panel-close');
  var saveConfirmBtn = document.getElementById('juntas-save-confirm-btn');
  var nameInput      = document.getElementById('juntas-name-input');
  var validationMsg  = document.getElementById('juntas-validation-msg');
  var list           = document.getElementById('juntas-list');
  var emptyMsg       = document.getElementById('juntas-empty-msg');
  var toast          = document.getElementById('juntas-toast');

  var inputNombre = document.getElementById('input-nombre-cumpleanero');
  var inputEdad   = document.getElementById('input-edad');
  var inputLugar  = document.getElementById('input-lugar-evento');
  var inputFecha  = document.getElementById('event-date-input');
  var inputHora   = document.getElementById('event-time-input');

  var activeJuntaId = null;
  var toastTimer    = null;

  // ── Helpers ──────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatFecha(fechaStr) {
    if (!fechaStr) return '';
    var parts = fechaStr.split('-');
    if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
    return fechaStr;
  }

  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.removeAttribute('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
      toast.setAttribute('hidden', '');
    }, 3000);
  }

  function showValidation(msg) {
    if (!validationMsg) return;
    validationMsg.textContent = msg;
    validationMsg.removeAttribute('hidden');
  }

  function hideValidation() {
    if (!validationMsg) return;
    validationMsg.setAttribute('hidden', '');
    validationMsg.textContent = '';
  }

  // ── Tarea 6.1: Renderizado ────────────────────────────────────────────

  function renderJuntaItem(junta) {
    var li = document.createElement('li');
    li.className = 'juntas-item' + (junta.id === activeJuntaId ? ' active' : '');
    li.dataset.id = junta.id;
    li.innerHTML =
      '<div class="juntas-item-body">' +
        '<span class="juntas-item-name">' + escapeHtml(junta.nombre) + '</span>' +
        '<span class="juntas-item-meta">' + escapeHtml(junta.nombreCumpleanero) + ' &middot; ' + escapeHtml(formatFecha(junta.fechaEvento)) + '</span>' +
      '</div>' +
      '<div class="juntas-item-actions">' +
        '<button type="button" class="juntas-load-btn" aria-label="Cargar junta ' + escapeHtml(junta.nombre) + '">Cargar</button>' +
        '<button type="button" class="juntas-delete-btn" aria-label="Eliminar junta ' + escapeHtml(junta.nombre) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="3 6 5 6 21 6"/>' +
            '<path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>' +
            '<path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>' +
          '</svg>' +
        '</button>' +
      '</div>';
    return li;
  }

  function renderList() {
    if (!list) return;
    var juntas = GestorJuntas.listJuntas();
    list.innerHTML = '';
    if (juntas.length === 0) {
      if (emptyMsg) emptyMsg.removeAttribute('hidden');
    } else {
      if (emptyMsg) emptyMsg.setAttribute('hidden', '');
      juntas.forEach(function(junta) {
        list.appendChild(renderJuntaItem(junta));
      });
    }
  }

  // ── Tarea 6.3: Apertura y cierre ─────────────────────────────────────

  function openPanel() {
    if (!panel) return;
    panel.removeAttribute('hidden');
    if (triggerBtn) triggerBtn.setAttribute('aria-expanded', 'true');
    renderList();
    if (nameInput) nameInput.focus();
  }

  function closePanel() {
    if (!panel) return;
    panel.setAttribute('hidden', '');
    if (triggerBtn) triggerBtn.setAttribute('aria-expanded', 'false');
    hideValidation();
  }

  if (triggerBtn) {
    triggerBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      if (panel && panel.hasAttribute('hidden')) {
        openPanel();
      } else {
        closePanel();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      closePanel();
    });
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && panel && !panel.hasAttribute('hidden')) {
      closePanel();
    }
  });

  document.addEventListener('click', function(e) {
    if (!panel || panel.hasAttribute('hidden')) return;
    if (!panel.contains(e.target) && e.target !== triggerBtn && !triggerBtn.contains(e.target)) {
      closePanel();
    }
  });

  // ── Tarea 7.1: Guardar ────────────────────────────────────────────────

  function readFormData() {
    return {
      nombreCumpleanero: inputNombre ? inputNombre.value.trim() : '',
      edad:              inputEdad   ? inputEdad.value.trim()   : '',
      lugarEvento:       inputLugar  ? inputLugar.value.trim()  : '',
      fechaEvento:       inputFecha  ? inputFecha.value         : '',
      horaEvento:        inputHora   ? inputHora.value          : ''
    };
  }

  function formHasData() {
    var d = readFormData();
    return d.nombreCumpleanero !== '' || d.edad !== '' ||
           d.lugarEvento !== '' || d.fechaEvento !== '' || d.horaEvento !== '';
  }

  if (saveConfirmBtn) {
    saveConfirmBtn.addEventListener('click', function() {
      hideValidation();
      var formData = readFormData();

      if (!formData.nombreCumpleanero) {
        showValidation('El nombre del cumpleañero/a es obligatorio para guardar.');
        return;
      }

      var nombreDesc = nameInput ? nameInput.value.trim() : '';
      if (!nombreDesc) {
        nombreDesc = GestorJuntas.buildFallbackName(formData.nombreCumpleanero, formData.fechaEvento);
        if (nameInput) nameInput.value = nombreDesc;
      }

      try {
        GestorJuntas.saveJunta(formData, nombreDesc);
        if (nameInput) nameInput.value = '';
        hideValidation();
        renderList();
        showToast('¡Junta guardada correctamente!');
      } catch (e) {
        if (e.message === 'QUOTA_EXCEEDED') {
          showValidation('No se pudo guardar: el almacenamiento del navegador está lleno.');
        } else {
          showValidation('Error al guardar la junta. Intentá de nuevo.');
        }
      }
    });
  }

  // ── Tareas 8.1 y 9.1: Cargar y Eliminar (delegación en la lista) ──────

  if (list) {
    list.addEventListener('click', function(e) {
      var loadBtn   = e.target.closest('.juntas-load-btn');
      var deleteBtn = e.target.closest('.juntas-delete-btn');

      // ── Cargar ────────────────────────────────────────────────────────
      if (loadBtn) {
        var item = loadBtn.closest('.juntas-item');
        if (!item) return;
        var id = item.dataset.id;

        if (formHasData() && id !== activeJuntaId) {
          if (!confirm('El formulario tiene datos. ¿Querés reemplazarlos con esta junta?')) return;
        }

        var junta = GestorJuntas.loadJunta(id);
        if (!junta) { showValidation('Junta no encontrada.'); return; }

        if (inputNombre) inputNombre.value = junta.nombreCumpleanero;
        if (inputEdad)   inputEdad.value   = junta.edad;
        if (inputLugar)  inputLugar.value  = junta.lugarEvento;
        if (inputFecha)  inputFecha.value  = junta.fechaEvento;
        if (inputHora)   inputHora.value   = junta.horaEvento;

        activeJuntaId = id;
        renderList();
        closePanel();
      }

      // ── Eliminar ──────────────────────────────────────────────────────
      if (deleteBtn) {
        var item = deleteBtn.closest('.juntas-item');
        if (!item) return;
        var id = item.dataset.id;
        var junta = GestorJuntas.loadJunta(id);
        var nombre = junta ? junta.nombre : 'esta junta';

        var confirmed;
        try {
          confirmed = confirm('\xBFEliminar "' + nombre + '"? Esta acci\xF3n no se puede deshacer.');
        } catch (err) {
          return; // si confirm() falla, bloquear eliminación
        }
        if (!confirmed) return;

        GestorJuntas.deleteJunta(id);
        if (activeJuntaId === id) activeJuntaId = null;
        renderList();
        showToast('"' + escapeHtml(nombre) + '" eliminada.');
      }
    });
  }

})();

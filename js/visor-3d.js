import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ============================================================
   ESTADO GLOBAL
============================================================ */
const state = {
  iw: 0, ih: 0,
  ink: null,          // Uint8Array w*h  (1 = línea/tinta, 0 = región)
  labels: null,        // Int32Array w*h  (-1 = tinta, >=0 = id de máscara/región, incluye exterior)
  inkClass: null,      // Uint8Array w*h  (0=neutro,1=pliegue,2=corte) — solo para píxeles de tinta
  masks: [],           // [{id, area, bbox, touchesBorder, centroid, contour:[{x,y}], isExterior}]
  exteriorId: -1,
  adjacency: new Map(),// key "a_b" -> {count, pts:[{x,y}]}
  fanClusters: [],     // [{x,y,ids:[...]}]
  mergeNotes: [],       // strings informativos: regiones de ruido fusionadas en la última detección
  buildLogLines: [],    // [{msg, cls}] registro de la última construcción/actualización del modelo 3D — se muestra dentro de la consola de diagnóstico
  meta: new Map(),     // id -> {name, role, parent, angle, color}
  selectedId: null,
  splitMode: false,
  splitTargetId: null,
  splitPoints: [],
  eraseMode: false,          // true mientras el botón de borrador (#sp2EraserToolBtn) está activo:
                              // habilita pintar trazos de borrado sobre #editorCanvas
  templateEraseStrokes: [],  // trazos de pincel {radius, points:[{x,y},...]} en espacio de
                              // píxeles de imagen (state.iw/state.ih); se "limpian" (blanco) de
                              // la imagen fuente antes de calcular tinta/máscaras y antes de
                              // cada redibujado, así se puede borrar sólo una parte de un
                              // elemento filtrado sin descartar toda su máscara
  threshold: 215,
  tolerance: 9,
  imageDataUrl: null,
  built: false,
  dragId: null,        // id de la máscara que se está arrastrando en el árbol de jerarquía
  hierarchyMenu: null,  // { type:'role'|'angle'|'name', id } — qué panel desplegable está abierto en el árbol
  dims: {               // Panel "Medidas": Ancho/Alto reales del diseño
    widthCm: 21,
    heightCm: 29.7,
    manual: false,       // true en cuanto el usuario toca un slider a mano: deja de recalcularse solo
    lockAspect: true,     // Bloqueo de Proporcionalidad — ver #lockAspectToggle
  },
};

const COLORS = ['#5b9dff','#ff8a5b','#4ade80','#c084fc','#f472b6','#facc15','#38bdf8','#fb7185','#a3e635','#fca5a5'];

// listas preestablecidas para el menú de nombres del árbol de jerarquía
const NAME_PRESETS = [
  { group: 'Fondo', items: Array.from({length:6}, (_,i) => `Fondo ${i+1}`) },
  { group: 'Personaje', items: Array.from({length:12}, (_,i) => `Personaje ${i+1}`) },
  { group: 'Color', items: ['Color Primario', 'Color Secundario', 'Color Terciario'] },
];

function pairKey(a,b){ return a<b ? (a+'_'+b) : (b+'_'+a); }

/* ============================================================
   DIMENSIONES REALES (panel "Medidas" / #dimensionsCard)
   Ancho/Alto (cm) se basan en el bounding box combinado de TODAS
   las máscaras. Se recalculan solos cada vez que las máscaras se
   generan/reconstruyen (ver recalcDimsFromMasks(), llamada desde
   runSegmentation() y reRunFromInk()) — salvo que el usuario ya
   haya tocado un slider a mano (state.dims.manual = true), en cuyo
   caso su valor manda hasta que use "Restaurar Medidas".
   Cuando el usuario edita a mano, se re-escala de verdad el diseño:
   el marco 2D (#dimPageFrame) y el modelo 3D (buildModel) leen
   ambos state.dims para su escala real, no un tamaño arbitrario.
============================================================ */
const DIMS_MIN_CM = 0.01, DIMS_MAX_CM = 100;
// Escala de referencia (96 DPI) usada SOLO para el recálculo automático:
// convierte el bbox de máscaras (px) a cm la primera vez / tras cada
// regeneración, mientras el usuario no haya fijado un tamaño a mano.
const DIMS_AUTO_CM_PER_PX = 2.54 / 96;
// Unidades de mundo 3D por cm de diseño real. Calibrado para que el
// tamaño por defecto (A4, 21×29.7cm) ocupe en el visor lo mismo que
// ocupaba antes (con el targetSize=260 fijo que tenía el código previo).
const DIMS_WORLD_UNITS_PER_CM = 260 / Math.hypot(21, 29.7);

function round1(v) { return Math.round(v * 100) / 100; }
function clampDimCm(v) { return Math.min(DIMS_MAX_CM, Math.max(DIMS_MIN_CM, v)); }

// Bounding box combinado (en px de la imagen) de todas las máscaras activas.
function getMasksBBoxPx() {
  if (!state.masks.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.masks.forEach(m => {
    if (!m.bbox) return;
    minX = Math.min(minX, m.bbox.minX);
    minY = Math.min(minY, m.bbox.minY);
    maxX = Math.max(maxX, m.bbox.maxX);
    maxY = Math.max(maxY, m.bbox.maxY);
  });
  if (!isFinite(minX) || maxX <= minX || maxY <= minY) return null;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
// Expuesto en window: el <script> no-módulo que dibuja el marco 2D
// (#dimPageFrame) y escala #editorCanvas en pantalla necesita el bbox real
// de la forma (no el canvas completo, que tiene relleno alrededor) — pero
// vive en otro scope, así que se lo pasamos por acá.
window.__spGetMasksBBoxPx = getMasksBBoxPx;

// Recalcula Ancho/Alto desde el conjunto de máscaras. No hace nada si el
// usuario ya fijó el tamaño a mano (state.dims.manual) — llamar SIEMPRE
// que las máscaras se generen o reconstruyan.
function recalcDimsFromMasks() {
  if (state.dims.manual) return;
  const bbox = getMasksBBoxPx();
  if (!bbox) return;
  state.dims.widthCm = round1(clampDimCm(bbox.width * DIMS_AUTO_CM_PER_PX));
  state.dims.heightCm = round1(clampDimCm(bbox.height * DIMS_AUTO_CM_PER_PX));
  syncDimsUI();
}

// Refleja state.dims en los controles del panel "Medidas" y avisa al resto
// de la app (marco 2D, modelo 3D) de que el tamaño real cambió.
function syncDimsUI() {
  const widthSlider = document.getElementById('dimWidthSlider');
  const heightSlider = document.getElementById('dimHeightSlider');
  const resetBtn = document.getElementById('dimsResetAutoBtn');
  const statusEl = document.getElementById('dimsAutoStatus');
  if (widthSlider) widthSlider.value = state.dims.widthCm;
  if (heightSlider) heightSlider.value = state.dims.heightCm;
  if (resetBtn) resetBtn.style.display = state.dims.manual ? '' : 'none';
  if (statusEl) statusEl.textContent = state.dims.manual
    ? ''
    : 'Se recalcula automáticamente según las máscaras';
  document.dispatchEvent(new CustomEvent('sp:dimsChanged', {
    detail: { widthCm: state.dims.widthCm, heightCm: state.dims.heightCm, manual: state.dims.manual }
  }));
  // Si ya había un modelo 3D construido, lo reconstruye para reflejar el
  // nuevo tamaño real (ver SCALE en buildModel(), que lee state.dims).
  if (state.built && state.masks.length) buildModel({ silent: true });
}

// Panel "Medidas": estado real (Ancho/Alto/manual/bloqueo) — el <script>
// no-módulo de más arriba solo dibuja el marco 2D; acá se decide el valor.
(function(){
  const widthSlider = document.getElementById('dimWidthSlider');
  const heightSlider = document.getElementById('dimHeightSlider');
  const lockAspectToggle = document.getElementById('lockAspectToggle');
  const resetAutoBtn = document.getElementById('dimsResetAutoBtn');
  if (!widthSlider || !heightSlider) return;

  state.dims.lockAspect = !lockAspectToggle || lockAspectToggle.checked;

  function parseDimInput(raw, fallback){
    const v = parseFloat(String(raw).replace(',', '.'));
    return isFinite(v) ? v : fallback;
  }

  // Mientras el usuario tipea no reformateamos el campo (rompería el cursor
  // y el "." mientras escribe) — solo dejamos pasar dígitos y un único punto.
  function sanitizeDecimalInput(e){
    const el = e.target;
    let v = el.value.replace(',', '.').replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    if (v !== el.value) el.value = v;
  }

  // Breve resalte visual del recuadro al ajustar con la rueda del mouse.
  function flashWheel(input){
    const box = input.closest('.number-input-box');
    if (!box) return;
    box.classList.add('wheel-active');
    clearTimeout(box._wheelTimer);
    box._wheelTimer = setTimeout(() => box.classList.remove('wheel-active'), 400);
  }

  // Confirma el Ancho: pasa a modo manual y, si el Bloqueo de Proporcionalidad
  // está activo, arrastra el Alto con él manteniendo la relación que tenía.
  function commitWidth(rawValue){
    const newWidth = clampDimCm(parseDimInput(rawValue, state.dims.widthCm));
    const ratio = state.dims.heightCm / (state.dims.widthCm || 1);
    state.dims.manual = true;
    state.dims.widthCm = round1(newWidth);
    if (state.dims.lockAspect) state.dims.heightCm = round1(clampDimCm(newWidth * ratio));
    syncDimsUI();
  }
  function commitHeight(rawValue){
    const newHeight = clampDimCm(parseDimInput(rawValue, state.dims.heightCm));
    const ratio = state.dims.widthCm / (state.dims.heightCm || 1);
    state.dims.manual = true;
    state.dims.heightCm = round1(newHeight);
    if (state.dims.lockAspect) state.dims.widthCm = round1(clampDimCm(newHeight * ratio));
    syncDimsUI();
  }

  // Escribir a mano: se confirma recién al salir del campo (blur) o con Enter
  // — así el usuario puede tipear "21.5" sin que se lo reformateemos letra
  // a letra. Girar la rueda del mouse ajusta y confirma al instante.
  widthSlider.addEventListener('input', sanitizeDecimalInput);
  heightSlider.addEventListener('input', sanitizeDecimalInput);

  widthSlider.addEventListener('change', function(){ commitWidth(widthSlider.value); });
  heightSlider.addEventListener('change', function(){ commitHeight(heightSlider.value); });

  widthSlider.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); widthSlider.blur(); } });
  heightSlider.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); heightSlider.blur(); } });

  // Rueda del mouse sobre el campo: +/- 0.1cm por paso, Shift = 1cm, Alt = 0.01cm.
  widthSlider.addEventListener('wheel', function(e){
    e.preventDefault();
    const step = e.shiftKey ? 1 : (e.altKey ? 0.01 : 0.1);
    const dir = e.deltaY < 0 ? 1 : -1;
    commitWidth(parseDimInput(widthSlider.value, state.dims.widthCm) + dir * step);
    flashWheel(widthSlider);
  }, { passive: false });
  heightSlider.addEventListener('wheel', function(e){
    e.preventDefault();
    const step = e.shiftKey ? 1 : (e.altKey ? 0.01 : 0.1);
    const dir = e.deltaY < 0 ? 1 : -1;
    commitHeight(parseDimInput(heightSlider.value, state.dims.heightCm) + dir * step);
    flashWheel(heightSlider);
  }, { passive: false });

  if (lockAspectToggle) {
    lockAspectToggle.addEventListener('change', function(){
      state.dims.lockAspect = lockAspectToggle.checked;
    });
  }

  // "Restaurar Medidas": vuelve a modo automático y recalcula ya mismo desde
  // las máscaras actuales (visible solo cuando hay un tamaño manual fijado).
  if (resetAutoBtn) {
    resetAutoBtn.addEventListener('click', function(){
      state.dims.manual = false;
      recalcDimsFromMasks();
    });
  }
})();

/* ============================================================
   1) CARGA DE IMAGEN Y BINARIZACIÓN
============================================================ */
const fileInput = document.getElementById('fileInput');
const threshInput = document.getElementById('threshInput');
const tolInput = document.getElementById('tolInput');
const segmentStatus = document.getElementById('segmentStatus');
const dropHint = document.getElementById('dropHint');
const editorCanvas = document.getElementById('editorCanvas');
const ectx = editorCanvas.getContext('2d');

let sourceImage = null; // HTMLImageElement ya cargada, sin procesar
const MAX_DIM = 640;

const fileInputName = document.getElementById('fileInputName');
fileInput.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (fileInputName) fileInputName.textContent = f ? f.name : 'Ningún archivo seleccionado';
  if (!f) return;
  const reader = new FileReader();
  reader.onload = ev => loadImageFromDataUrl(ev.target.result);
  reader.readAsDataURL(f);
});

function loadImageFromDataUrl(dataUrl) {
  const img = new Image();
  img.onload = () => {
    sourceImage = img;
    state.imageDataUrl = dataUrl;
    state.templateEraseStrokes = [];
    if (typeof syncEraserUndoBtn === 'function') syncEraserUndoBtn();
    prepareCanvasFromImage(img);
    dropHint.style.display = 'none';
    editorCanvas.classList.add('has-image');
    // apenas se carga la imagen, se detectan las caras automáticamente con
    // los valores actuales de umbral/tolerancia — no hace falta tocar un botón
    triggerAutoSegment();
  };
  img.src = dataUrl;
}

// Click en el fondo (solo visible/clickeable si no hay imagen cargada) abre el explorador de archivos
dropHint.addEventListener('click', () => {
  fileInput.click();
});

// Arrastrar y soltar una imagen sobre la pestaña, en cualquier momento (haya o no imagen cargada)
(function(){
  const dropZone = document.getElementById('editorWrap');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach(evtName => {
    dropZone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'dragend'].forEach(evtName => {
    dropZone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    if (fileInputName) fileInputName.textContent = f.name;
    const reader = new FileReader();
    reader.onload = ev => loadImageFromDataUrl(ev.target.result);
    reader.readAsDataURL(f);
  });
})();

function prepareCanvasFromImage(img) {
  let w = img.naturalWidth, h = img.naturalHeight;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));
  editorCanvas.width = w;
  editorCanvas.height = h;
  ectx.fillStyle = '#fff';
  ectx.fillRect(0, 0, w, h);
  ectx.drawImage(img, 0, 0, w, h);
  state.iw = w; state.ih = h;
}

// ---------- Vista Fuentes: extracción automática de las 76 letras desde una imagen (portado del prototipo "Gestor de Fuentes") ----------
(function(){
  const fuentesGridWrap = document.getElementById('fuentesGridWrap');
  const fuentesDropHint = document.getElementById('fuentesDropHint');
  const fuentesGrid = document.getElementById('fuentesGrid');
  const fuentesNombreInput = document.getElementById('fuentesNombreInput');
  const fuentesIncorporarBtn = document.getElementById('fuentesIncorporarBtn');
  const fuentesNombrePreview = document.getElementById('fuentesNombrePreview');
  if (!fuentesGridWrap || !fuentesDropHint || !fuentesGrid) return;

  // Orden esperado de los 76 caracteres (debe coincidir 1 a 1 con las 76 tarjetas de #fuentesGrid)
  const FUENTES_CHAR_ORDER = [
    'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ¡!', // 29: mayúsculas + Ñ + signos
    'abcdefghijklmnñopqrstuvwxyz',   // 27: minúsculas + ñ
    'ÁÉÍÓÚáéíóú',                     // 10: acentuadas
    '0123456789'                     // 10: números
  ].join('');

  let extractedFuentesChars = {}; // { char: canvas } — versión mostrada/exportada (con tinte aplicado, si hay)
  let originalFuentesChars = {};  // { char: canvas } — versión original tal cual se extrajo, nunca se pisa
  let fuentesFontName = '';
  let fuentesTintHex = null; // color elegido en #fuentesVectorizeToolColor, o null = sin tinte

  // ---------- Utilidades de color para el tinte de letras (solo cambia el matiz/Hue;
  //            no toca saturación ni luminosidad, así se preserva el sombreado/textura
  //            original de cada letra). ----------
  function hexToRgbFuentes(hex){
    hex = hex.replace('#','');
    return {
      r: parseInt(hex.substring(0,2), 16),
      g: parseInt(hex.substring(2,4), 16),
      b: parseInt(hex.substring(4,6), 16)
    };
  }
  function rgbToHslFuentes(r, g, b){
    r/=255; g/=255; b/=255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    let l = (max+min)/2, d = max-min, h = 0, s = 0;
    if(d !== 0){
      s = d / (1 - Math.abs(2*l - 1));
      switch(max){
        case r: h = 60 * (((g-b)/d) % 6); break;
        case g: h = 60 * ((b-r)/d + 2); break;
        case b: h = 60 * ((r-g)/d + 4); break;
      }
      if(h < 0) h += 360;
    }
    return { h, s, l };
  }
  function hslToRgbFuentes(h, s, l){
    const c = (1 - Math.abs(2*l - 1)) * s;
    const x = c * (1 - Math.abs((h/60) % 2 - 1));
    const m = l - c/2;
    let r=0, g=0, b=0;
    if(h < 60){ r=c; g=x; b=0; }
    else if(h < 120){ r=x; g=c; b=0; }
    else if(h < 180){ r=0; g=c; b=x; }
    else if(h < 240){ r=0; g=x; b=c; }
    else if(h < 300){ r=x; g=0; b=c; }
    else { r=c; g=0; b=x; }
    return { r:(r+m)*255, g:(g+m)*255, b:(b+m)*255 };
  }

  /* Devuelve una copia de sourceCanvas con el matiz (Hue) reemplazado por el
     de hex, dejando intactas la saturación y la luminosidad de cada píxel
     (por eso el sombreado/textura de la letra se mantiene igual, solo cambia
     "de qué color" es). Los píxeles transparentes se dejan como están. */
  function tintCanvasHue(sourceCanvas, hex){
    const out = document.createElement('canvas');
    out.width = sourceCanvas.width;
    out.height = sourceCanvas.height;
    const octx = out.getContext('2d');
    octx.drawImage(sourceCanvas, 0, 0);
    if(!hex) return out; // sin tinte: devolvemos una copia tal cual
    const targetHue = rgbToHslFuentes(hexToRgbFuentes(hex).r, hexToRgbFuentes(hex).g, hexToRgbFuentes(hex).b).h;
    const w = out.width, h = out.height;
    if(w <= 0 || h <= 0) return out;
    const imgData = octx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for(let i = 0; i < data.length; i += 4){
      if(data[i+3] === 0) continue; // transparente: no hay nada que teñir
      const hsl = rgbToHslFuentes(data[i], data[i+1], data[i+2]);
      const rgb = hslToRgbFuentes(targetHue, hsl.s, hsl.l);
      data[i] = rgb.r; data[i+1] = rgb.g; data[i+2] = rgb.b;
    }
    octx.putImageData(imgData, 0, 0);
    return out;
  }

  /* Recalcula extractedFuentesChars a partir de los originales aplicando (o
     quitando) el tinte vigente, y refresca tanto las tarjetas de la grilla
     como la vista previa del nombre. */
  function applyFuentesTint(){
    Object.keys(originalFuentesChars).forEach(function(char){
      extractedFuentesChars[char] = tintCanvasHue(originalFuentesChars[char], fuentesTintHex);
      const idx = FUENTES_CHAR_ORDER.indexOf(char);
      const card = idx !== -1 ? document.getElementById('fuenteCard' + (idx + 1)) : null;
      if(card) paintCharOnCard(card, extractedFuentesChars[char]);
    });
    renderFuentesNombrePreview();
  }

  // Puente para que el selector de color de la barra de herramientas (#fuentesVectorizeToolColor,
  // definido en otro closure) pueda avisar acá cuando el usuario elige un color nuevo.
  window.__setFuentesLetterTint = function(hex){
    fuentesTintHex = hex || null;
    applyFuentesTint();
  };

  // ---------- Utilidades de procesamiento de imagen (idénticas al prototipo) ----------
  function removeBackground(canvas, threshold){
    threshold = threshold || 240;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4){
      const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (brightness > threshold) data[i + 3] = 0;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // Devuelve { regions, labelMap }. labelMap es un Int32Array (width*height) que indica,
  // para cada píxel opaco, a qué región válida (índice en el array `regions`, empezando en 0)
  // pertenece. Los píxeles que forman parte de una mancha descartada por los filtros de tamaño
  // (p. ej. el puntito de la "i"/"j"/"¡"/"!" o el acento de "Á É Í Ó Ú", que suelen quedar como
  // una mancha aparte y demasiado chica) quedan con valor -1 ("sin dueño"), no con el valor de
  // ninguna letra vecina. Esto es lo que permite, al recortar cada letra más abajo, distinguir
  // entre "una manchita propia de esta letra" (se conserva) y "un pedazo de la letra de al lado
  // que cayó dentro del rectángulo de recorte por el padding" (se borra).
  function findConnectedRegions(canvas){
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const width = canvas.width, height = canvas.height;
    const visited = new Array(width * height).fill(false);
    const labelMap = new Int32Array(width * height).fill(-1);
    const regions = [];

    function isOpaque(x, y){
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      return data[(y * width + x) * 4 + 3] > 150;
    }

    function floodFill(startX, startY){
      const stack = [[startX, startY]];
      const region = { minX: width, maxX: 0, minY: height, maxY: 0, pixels: 0 };
      const pixelIndices = [];
      while (stack.length > 0){
        const point = stack.pop();
        const x = point[0], y = point[1];
        const index = y * width + x;
        if (visited[index] || !isOpaque(x, y)) continue;
        visited[index] = true;
        pixelIndices.push(index);
        region.pixels++;
        region.minX = Math.min(region.minX, x);
        region.maxX = Math.max(region.maxX, x);
        region.minY = Math.min(region.minY, y);
        region.maxY = Math.max(region.maxY, y);
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
        stack.push([x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]);
      }
      region.pixelIndices = pixelIndices;
      return region;
    }

    for (let y = 0; y < height; y++){
      for (let x = 0; x < width; x++){
        const index = y * width + x;
        if (!visited[index] && isOpaque(x, y)){
          const region = floodFill(x, y);
          region.width = region.maxX - region.minX + 1;
          region.height = region.maxY - region.minY + 1;
          region.centerX = (region.minX + region.maxX) / 2;
          region.centerY = (region.minY + region.maxY) / 2;
          const aspectRatio = region.width / region.height;

          if (region.pixels < 80) continue;
          if (region.width < 6) continue;
          if (region.height < 15) continue;
          if (region.width * region.height < 150) continue;
          if (region.width > width * 0.4) continue;
          if (region.height > height * 0.5) continue;
          if (aspectRatio > 20 || aspectRatio < 0.05) continue;

          const labelId = regions.length;
          region.id = labelId;
          for (let i = 0; i < region.pixelIndices.length; i++){
            labelMap[region.pixelIndices[i]] = labelId;
          }
          regions.push(region);
        }
      }
    }
    return { regions, labelMap };
  }

  function groupRegionsIntoRows(regions, rowTolerance){
    rowTolerance = rowTolerance || 0.4;
    if (regions.length === 0) return [];
    const sorted = regions.slice().sort((a, b) => a.centerY - b.centerY);
    const rows = [];
    let currentRow = [sorted[0]];
    for (let i = 1; i < sorted.length; i++){
      const region = sorted[i];
      const prevRegion = currentRow[0];
      const avgHeight = (prevRegion.height + region.height) / 2;
      const yDiff = Math.abs(region.centerY - prevRegion.centerY);
      if (yDiff < avgHeight * rowTolerance){
        currentRow.push(region);
      } else {
        rows.push(currentRow);
        currentRow = [region];
      }
    }
    rows.push(currentRow);
    rows.forEach(row => row.sort((a, b) => a.centerX - b.centerX));
    return rows;
  }

  // Recorta una letra del canvas fuente. Además del rectángulo de siempre (con su padding),
  // usa labelMap/labelId/regionIdx para "limpiar" el recorte: cualquier píxel que haya quedado
  // dentro del rectángulo pero en realidad le pertenezca a OTRA letra ya contada (por ejemplo la
  // cola de una "y" o el gancho de una "g" vecina que invade el padding) se vuelve transparente.
  // Los píxeles "sin dueño" (labelMap === -1, como el puntito de una i/j o un acento suelto) se
  // conservan tal cual, porque suelen ser parte de la letra que se está recortando.
  function extractRegion(canvas, region, paddingH, paddingV, labelMap, regionIdx){
    const minX = Math.max(0, region.minX - paddingH);
    const minY = Math.max(0, region.minY - paddingV);
    const maxX = Math.min(canvas.width - 1, region.maxX + paddingH);
    const maxY = Math.min(canvas.height - 1, region.maxY + paddingV);
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const extracted = document.createElement('canvas');
    extracted.width = width;
    extracted.height = height;
    const ectx = extracted.getContext('2d');
    ectx.drawImage(canvas, minX, minY, width, height, 0, 0, width, height);

    if (labelMap && regionIdx !== undefined){
      const canvasWidth = canvas.width;
      const imgData = ectx.getImageData(0, 0, width, height);
      const data = imgData.data;
      let touched = false;
      for (let y = 0; y < height; y++){
        for (let x = 0; x < width; x++){
          const label = labelMap[(minY + y) * canvasWidth + (minX + x)];
          if (label !== -1 && label !== regionIdx){
            data[(y * width + x) * 4 + 3] = 0;
            touched = true;
          }
        }
      }
      if (touched) ectx.putImageData(imgData, 0, 0);
    }

    return extracted;
  }

  function canvasToSVG(canvas, char){
    const dataUrl = canvas.toDataURL('image/png');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' + canvas.width + '" height="' + canvas.height + '" viewBox="0 0 ' + canvas.width + ' ' + canvas.height + '">\n' +
      '<title>' + char + '</title>\n' +
      '<image width="' + canvas.width + '" height="' + canvas.height + '" xlink:href="' + dataUrl + '"/>\n' +
      '</svg>';
  }

  // ---------- Pintar un carácter dentro de su tarjeta (#fuenteCardN) ----------
  function paintCharOnCard(card, canvas){
    if (canvas && canvas.width > 0 && canvas.height > 0){
      card.style.backgroundImage = 'url(' + canvas.toDataURL('image/png') + ')';
      card.style.backgroundSize = 'contain';
      card.style.backgroundRepeat = 'no-repeat';
      card.style.backgroundPosition = 'center';
    } else {
      card.style.backgroundImage = 'none';
    }
  }

  function clearAllCards(){
    for (let i = 1; i <= FUENTES_CHAR_ORDER.length; i++){
      const card = document.getElementById('fuenteCard' + i);
      if (card){
        card.style.backgroundImage = 'none';
        card.removeAttribute('data-char');
      }
    }
  }

  // ---------- Procesar la imagen cargada: detectar las 76 letras y llenar la grilla ----------
  function processFuentesImage(img){
    extractedFuentesChars = {};
    originalFuentesChars = {};
    clearAllCards();

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    tempCanvas.getContext('2d').drawImage(img, 0, 0);

    removeBackground(tempCanvas, 240);
    const { regions, labelMap } = findConnectedRegions(tempCanvas);
    const rows = groupRegionsIntoRows(regions, 0.4);

    const charsToShrink = 'ABCDEFGHIJ';
    const shrinkFactor = 0.77;

    let charIdx = 0;
    rows.forEach(row => {
      row.forEach(region => {
        if (charIdx >= FUENTES_CHAR_ORDER.length) return;
        const char = FUENTES_CHAR_ORDER[charIdx];
        let extracted = extractRegion(tempCanvas, region, 0, 25, labelMap, region.id);

        if (charsToShrink.indexOf(char) !== -1){
          const newWidth = Math.round(extracted.width * shrinkFactor);
          const newHeight = Math.round(extracted.height * shrinkFactor);
          const shrunk = document.createElement('canvas');
          shrunk.width = newWidth;
          shrunk.height = newHeight;
          shrunk.getContext('2d').drawImage(extracted, 0, 0, newWidth, newHeight);
          extracted = shrunk;
        }

        originalFuentesChars[char] = extracted;
        extractedFuentesChars[char] = fuentesTintHex ? tintCanvasHue(extracted, fuentesTintHex) : extracted;
        const card = document.getElementById('fuenteCard' + (charIdx + 1));
        if (card){
          card.setAttribute('data-char', char);
          paintCharOnCard(card, extractedFuentesChars[char]);
        }
        charIdx++;
      });
    });

    fuentesGridWrap.classList.add('has-image');
    requestAnimationFrame(function(){
      if (typeof layoutFuentesGrid === 'function') layoutFuentesGrid();
      window.dispatchEvent(new Event('resize'));
    });
    renderFuentesNombrePreview();
  }

  function loadFuentesImageFromFile(file){
    if (!file || !file.type || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = function(ev){
      const img = new Image();
      img.onload = function(){ processFuentesImage(img); };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  // Click en el aviso (sin imagen aún) abre el explorador de archivos
  fuentesDropHint.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) loadFuentesImageFromFile(f);
    });
    input.click();
  });

  // Arrastrar y soltar una imagen sobre la grilla
  ['dragenter', 'dragover'].forEach(evtName => {
    fuentesGridWrap.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      fuentesGridWrap.classList.add('drag-over');
    });
  });

  ['dragleave', 'dragend'].forEach(evtName => {
    fuentesGridWrap.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      fuentesGridWrap.classList.remove('drag-over');
    });
  });

  fuentesGridWrap.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    fuentesGridWrap.classList.remove('drag-over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFuentesImageFromFile(f);
  });

  // Dibuja el texto escrito en #fuentesNombreInput usando las letras recién cargadas
  function renderFuentesNombrePreview(){
    if (!fuentesNombrePreview) return;
    fuentesNombrePreview.innerHTML = '';
    const text = fuentesNombreInput ? fuentesNombreInput.value : '';
    if (!text) return;

    for (const char of text){
      if (char === ' '){
        const spacer = document.createElement('span');
        spacer.style.display = 'inline-block';
        spacer.style.width = '10px';
        fuentesNombrePreview.appendChild(spacer);
        continue;
      }
      const canvas = extractedFuentesChars[char];
      if (canvas){
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.alt = char;
        fuentesNombrePreview.appendChild(img);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'fuentes-preview-fallback';
        fallback.textContent = char;
        fuentesNombrePreview.appendChild(fallback);
      }
    }
  }

  // Nombre de la fuente (metadato usado al incorporar/exportar)
  if (fuentesNombreInput){
    fuentesNombreInput.addEventListener('input', () => {
      fuentesFontName = fuentesNombreInput.value.trim();
      renderFuentesNombrePreview();
    });
  }

  // Botón "Incorporar": exporta cada carácter detectado como SVG individual
  if (fuentesIncorporarBtn){
    fuentesIncorporarBtn.addEventListener('click', () => {
      const chars = Object.keys(extractedFuentesChars);
      if (chars.length === 0){
        alert('Primero arrastrá o cargá una imagen con las letras de la fuente.');
        return;
      }
      const prefix = fuentesFontName ? fuentesFontName.replace(/[/\\?%*:|"<>\s]/g, '_') : 'fuente';
      chars.forEach(char => {
        const canvas = extractedFuentesChars[char];
        const svg = canvasToSVG(canvas, char);
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeChar = char.replace(/[/\\?%*:|"<>]/g, '_');
        a.download = prefix + '_' + safeChar + '.svg';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
      alert('¡' + chars.length + ' letras incorporadas y exportadas como SVG!');
    });
  }
})();

// ---------- Vista Elementos: grilla de imágenes con recorte de fondo automático, ajuste manual (borrador/color/tolerancia) y cuadros de texto ----------
  (function(){
    'use strict';

    var canvasWrap   = document.getElementById('texturasCanvasWrap');
    var grid         = document.getElementById('texturasGrid');
    var fileInput    = document.getElementById('texturasFileInput');

    var modalOverlay = document.getElementById('texturasVectorizeModalOverlay');
    var modalCanvas  = document.getElementById('texturasVectorizeModalCanvas');
    var modalClose   = document.getElementById('texturasVectorizeModalClose');
    var modalApply   = document.getElementById('texturasVectorizeModalApply');
    var categorySelect = document.getElementById('texturasVectorizeCategorySelect');
    var toleranceVal  = document.getElementById('texturasVectorizeToleranceVal');
    var brushOverlay  = document.getElementById('texturasVectorizeBrushOverlay');
    var brushCursor   = document.getElementById('texturasVectorizeBrushCursor');
    var smoothCheck   = document.getElementById('texturasVectorizeSmoothCheck');

    var toolEraser = document.getElementById('texturasVectorizeToolEraser');
    var toolColorInput = document.getElementById('texturasVectorizeToolColor');
    var toolColorPicker = document.getElementById('texturasVectorizeToolColorPicker');
    var colorEyedropper  = document.getElementById('texturasVectorizeColorEyedropper');
    var colorSwatchTrigger = document.getElementById('texturasVectorizeColorSwatchTrigger');
    var comicPalette = document.getElementById('texturasVectorizeComicPalette');
    var comicPaletteBtns = comicPalette ? comicPalette.querySelectorAll('.vcp-item') : [];
    var comicPaletteTarget = null; // <input type="color"> que va a recibir el valor elegido
    var firstDetectedColorInput = null; // <input> del primer color detectado, sincronizado con #texturasVectorizeColorSwatchTrigger

    /* -------- Paleta estilo cómic (From Uiverse.io by chase2k25): un popover
                único y reutilizable, no atado a ningún "pincel" (ya no
                existe). openComicPalette(anchorEl, targetInput) la ancla
                junto a anchorEl y, al elegir un color, actualiza
                targetInput y dispara su evento 'input' — así se conecta a
                la lógica de selección de color que ya existía en cada
                lugar (el "color actual" del toolbar, o el reemplazo de un
                color detectado), sin duplicar código. -------- */
    if(comicPalette){
      document.body.appendChild(comicPalette); // se independiza del layout de origen para poder anclarse (fixed) a cualquier disparador, en cualquier parte de la pantalla
    }

    function isComicPaletteTrigger(el){
      return !!(el && el.closest && (el.closest('.vcp-trigger') || el.closest('.vectorize-color-swatch')));
    }

    function positionComicPalette(anchorEl){
      if(!comicPalette || !anchorEl) return;
      var rect = anchorEl.getBoundingClientRect();
      var x = Math.max(90, Math.min(window.innerWidth - 90, rect.left + rect.width / 2));
      var y = rect.bottom + 10;
      comicPalette.style.left = x + 'px';
      comicPalette.style.top = y + 'px';
    }

    function closeComicPalette(){
      if(!comicPalette) return;
      comicPalette.classList.remove('open');
      if(colorSwatchTrigger) colorSwatchTrigger.setAttribute('aria-expanded', 'false');
      comicPaletteTarget = null;
    }

    /* Recalcula los 10 colores sugeridos de la paleta cómic a partir de baseHex:
       se mantienen su saturación y luminosidad (la "tonalidad" del color detectado
       de la máscara actual), variando solo el matiz entre ellos, de modo que todos
       combinen visualmente con el color de base en lugar de ser un arcoíris fijo. */
    function updateComicPaletteTones(baseHex){
      if(!comicPaletteBtns || !comicPaletteBtns.length) return;
      var rgb = hexToRgb(baseHex || '#3aa8c9');
      var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      var count = comicPaletteBtns.length;
      comicPaletteBtns.forEach(function(btn, i){
        var h = (hsl.h + (360 / count) * i) % 360;
        var rgbOut = hslToRgb(h, hsl.s, hsl.l);
        var hex = rgbToHex(rgbOut.r, rgbOut.g, rgbOut.b);
        btn.style.setProperty('--color', hex);
        btn.dataset.color = hex;
        btn.setAttribute('aria-color', hex);
      });
    }

    function openComicPalette(anchorEl, targetInput){
      if(!comicPalette || !targetInput) return;
      comicPaletteTarget = targetInput;
      updateComicPaletteTones(targetInput.value);
      positionComicPalette(anchorEl);
      comicPalette.classList.add('open');
      if(colorSwatchTrigger) colorSwatchTrigger.setAttribute('aria-expanded', String(anchorEl === colorSwatchTrigger));
      var currentHex = (targetInput.value || '').toLowerCase();
      comicPaletteBtns.forEach(function(b){
        b.classList.toggle('selected', b.dataset.color.toLowerCase() === currentHex);
      });
    }

    // Preview en vivo: al pasar el mouse por un color de la paleta (sin
    // hacer clic todavia), se aplica ese color al canvas para mostrar como
    // quedaria; al sacar el mouse sin elegir, se restaura el color anterior.
    // Guarda el valor previo a la vista previa mientras el mouse sigue sobre
    // algun cuadradito de la paleta (null = no hay preview activo).
    var vcpPreviewOriginal = null;

    if(comicPalette){
      comicPaletteBtns.forEach(function(btn){
        btn.addEventListener('mouseenter', function(){
          if(comicPaletteTarget !== toolColorInput) return; // preview solo aplica al color de pincel/borrador
          if(vcpPreviewOriginal === null) vcpPreviewOriginal = toolColorInput.value;
          toolColorInput.value = btn.dataset.color;
          toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        });
        btn.addEventListener('mouseleave', function(){
          if(vcpPreviewOriginal === null) return;
          toolColorInput.value = vcpPreviewOriginal;
          toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
          vcpPreviewOriginal = null;
        });
        btn.addEventListener('click', function(){
          if(!comicPaletteTarget) return;
          vcpPreviewOriginal = null; // el color ya quedo elegido: que el mouseleave no lo revierta
          comicPaletteTarget.value = btn.dataset.color;
          comicPaletteTarget.dispatchEvent(new Event('input', { bubbles:true }));
          closeComicPalette();
        });
      });
      document.addEventListener('click', function(e){
        if(!comicPalette.classList.contains('open')) return;
        if(comicPalette.contains(e.target)) return;
        if(isComicPaletteTrigger(e.target)) return;
        closeComicPalette();
      });
    }

    if(toolColorInput && toolColorPicker){
      function paintColorUI(hex){
        toolColorPicker.style.setProperty('--tool-color-current', hex);
      }

      paintColorUI(toolColorInput.value);

      toolColorInput.addEventListener('input', function(){
        paintColorUI(toolColorInput.value);
        // el primer color detectado del panel se mantiene sincronizado con el
        // color del toolbar: se aplica el color elegido tal cual (no una rotación
        // de tono), igual que si el usuario lo hubiera cambiado desde ese swatch
        if(firstDetectedColorInput && firstDetectedColorInput.value !== toolColorInput.value){
          firstDetectedColorInput.value = toolColorInput.value;
          firstDetectedColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        }
      });

      if(colorEyedropper){
        colorEyedropper.addEventListener('click', function(){
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

      if(colorSwatchTrigger && comicPalette){
        colorSwatchTrigger.addEventListener('click', function(e){
          e.stopPropagation();
          if(comicPalette.classList.contains('open') && comicPaletteTarget === toolColorInput){
            closeComicPalette();
          } else {
            openComicPalette(colorSwatchTrigger, toolColorInput);
          }
        });
      }
    }
    var toolUndo   = document.getElementById('texturasVectorizeToolUndo');
    var toolRedo   = document.getElementById('texturasVectorizeToolRedo');
    var modalCanvasWrapEl = document.querySelector('.texturas-modal-canvaswrap');
    var canvasZoomEl = document.getElementById('texturasVectorizeCanvasZoom');

    /* -------- Deshacer / Rehacer trazos de borrador -------- */
    if(toolUndo){
      toolUndo.addEventListener('click', function(){
        if(!activeModalId) return;
        var item = items[activeModalId];
        if(!item || !item.eraseStrokes.length) return;
        item.eraseRedoStack.push(item.eraseStrokes.pop());
        refreshModalPreview();
      });
    }
    if(toolRedo){
      toolRedo.addEventListener('click', function(){
        if(!activeModalId) return;
        var item = items[activeModalId];
        if(!item || !item.eraseRedoStack.length) return;
        item.eraseStrokes.push(item.eraseRedoStack.pop());
        refreshModalPreview();
      });
    }

    /* -------- Líneas guía de alineación (centrado + distancia entre cuadros) -------- */
    var alignGuidesEl = document.createElement('div');
    alignGuidesEl.className = 'vectorize-align-guides';
    alignGuidesEl.id = 'texturasVectorizeAlignGuides';
    canvasZoomEl.appendChild(alignGuidesEl);

    var GUIDE_SNAP_PCT = 0.6; /* umbral de imán, en % del ancho/alto del canvas */

    function clearAlignGuides(){
      alignGuidesEl.innerHTML = '';
    }

    function addGuideLine(type, posPct){
      var line = document.createElement('div');
      line.className = 'vectorize-guide-line visible ' + type;
      if(type === 'v'){ line.style.left = posPct + '%'; }
      else { line.style.top = posPct + '%'; }
      alignGuidesEl.appendChild(line);
    }

    function addGuideGap(type, aPct, bPct, crossPct, label){
      var gap = document.createElement('div');
      gap.className = 'vectorize-guide-gap visible ' + type;
      if(type === 'horiz'){
        gap.style.left = Math.min(aPct,bPct) + '%';
        gap.style.width = Math.abs(bPct-aPct) + '%';
        gap.style.top = crossPct + '%';
      } else {
        gap.style.top = Math.min(aPct,bPct) + '%';
        gap.style.height = Math.abs(bPct-aPct) + '%';
        gap.style.left = crossPct + '%';
      }
      var lbl = document.createElement('span');
      lbl.className = 'vectorize-guide-gap-label';
      lbl.textContent = label;
      gap.appendChild(lbl);
      alignGuidesEl.appendChild(gap);
    }

    /* Calcula, para el cuadro activo (con su x/y/w/h en % propuestos), a qué otros
       cuadros (o al centro del canvas) se puede "imantar" y devuelve la posición
       final ajustada más las líneas/guías que corresponda dibujar. */
    function computeAlignSnap(id, instId, xPct, yPct, wPct, hPct){
      var item = items[id];
      var others = (item && item.textboxes ? item.textboxes : []).filter(function(t){ return t.instId !== instId; });

      var myLeft = xPct, myRight = xPct + wPct, myCx = xPct + wPct/2;
      var myTop = yPct, myBottom = yPct + hPct, myCy = yPct + hPct/2;

      var vTargets = [{ v:50, key:'cx' }];   /* centro horizontal del canvas */
      var hTargets = [{ v:50, key:'cy' }];   /* centro vertical del canvas */

      others.forEach(function(t){
        var l = t.xPct, r = t.xPct + t.wPct, cx = t.xPct + t.wPct/2;
        var tp = t.yPct, bt = t.yPct + t.hPct, cy = t.yPct + t.hPct/2;
        vTargets.push({ v:l, key:'left' }, { v:r, key:'right' }, { v:cx, key:'cx' });
        hTargets.push({ v:tp, key:'top' }, { v:bt, key:'bottom' }, { v:cy, key:'cy' });
      });

      var lines = [];
      var dx = 0, dy = 0;
      var bestV = null, bestH = null;

      [{ pos:myLeft, key:'left' }, { pos:myCx, key:'cx' }, { pos:myRight, key:'right' }].forEach(function(mine){
        vTargets.forEach(function(t){
          var diff = Math.abs(mine.pos - t.v);
          if(diff <= GUIDE_SNAP_PCT && (!bestV || diff < bestV.diff)){
            bestV = { diff:diff, target:t.v, delta:t.v - mine.pos };
          }
        });
      });
      [{ pos:myTop, key:'top' }, { pos:myCy, key:'cy' }, { pos:myBottom, key:'bottom' }].forEach(function(mine){
        hTargets.forEach(function(t){
          var diff = Math.abs(mine.pos - t.v);
          if(diff <= GUIDE_SNAP_PCT && (!bestH || diff < bestH.diff)){
            bestH = { diff:diff, target:t.v, delta:t.v - mine.pos };
          }
        });
      });

      if(bestV){ dx = bestV.delta; }
      if(bestH){ dy = bestH.delta; }

      var newX = xPct + dx, newY = yPct + dy;
      var newLeft = newX, newRight = newX + wPct, newCx = newX + wPct/2;
      var newTop = newY, newBottom = newY + hPct, newCy = newY + hPct/2;

      clearAlignGuides();
      if(bestV){ addGuideLine('v', bestV.target); }
      if(bestH){ addGuideLine('h', bestH.target); }

      /* -------- Distribución: si el cuadro queda a igual distancia de sus dos
                  vecinos más cercanos (izq/der o arriba/abajo), lo marcamos -------- */
      var leftNeighbors = others.filter(function(t){ return (t.xPct + t.wPct) <= newLeft + 0.3; })
        .sort(function(a,b){ return (newLeft-(a.xPct+a.wPct)) - (newLeft-(b.xPct+b.wPct)); });
      var rightNeighbors = others.filter(function(t){ return t.xPct >= newRight - 0.3; })
        .sort(function(a,b){ return (a.xPct-newRight) - (b.xPct-newRight); });

      if(leftNeighbors.length && rightNeighbors.length){
        var gapL = newLeft - (leftNeighbors[0].xPct + leftNeighbors[0].wPct);
        var gapR = rightNeighbors[0].xPct - newRight;
        if(gapL > 0 && gapR > 0 && Math.abs(gapL-gapR) <= GUIDE_SNAP_PCT){
          var crossY = newCy;
          addGuideGap('horiz', leftNeighbors[0].xPct + leftNeighbors[0].wPct, newLeft, crossY, Math.round(gapL) + '%');
          addGuideGap('horiz', newRight, rightNeighbors[0].xPct, crossY, Math.round(gapR) + '%');
        }
      }

      var topNeighbors = others.filter(function(t){ return (t.yPct + t.hPct) <= newTop + 0.3; })
        .sort(function(a,b){ return (newTop-(a.yPct+a.hPct)) - (newTop-(b.yPct+b.hPct)); });
      var bottomNeighbors = others.filter(function(t){ return t.yPct >= newBottom - 0.3; })
        .sort(function(a,b){ return (a.yPct-newBottom) - (b.yPct-newBottom); });

      if(topNeighbors.length && bottomNeighbors.length){
        var gapT = newTop - (topNeighbors[0].yPct + topNeighbors[0].hPct);
        var gapB = bottomNeighbors[0].yPct - newBottom;
        if(gapT > 0 && gapB > 0 && Math.abs(gapT-gapB) <= GUIDE_SNAP_PCT){
          var crossX = newCx;
          addGuideGap('vert', topNeighbors[0].yPct + topNeighbors[0].hPct, newTop, crossX, Math.round(gapT) + '%');
          addGuideGap('vert', newBottom, bottomNeighbors[0].yPct, crossX, Math.round(gapB) + '%');
        }
      }

      return { xPct:newX, yPct:newY };
    }

    /* -------- Biblioteca de plantillas de "Cuadros de Textos": cada una es una
                composición SVG real (no un simple número) que se puede insertar
                sobre el elemento, con su propia forma decorativa. -------- */
    var TEXTBOX_TEMPLATES = [
      { id:'edad', label:'Edad', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'nombre', label:'Nombre', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'foto', label:'Foto', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'gracias', label:'¡Gracias por Venir!', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'bienvenidos', label:'¡Bienvenidos!', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'letra', label:'Letra', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' }
    ];
    var TEXTBOX_TEMPLATES_BY_ID = {};
    TEXTBOX_TEMPLATES.forEach(function(t){ TEXTBOX_TEMPLATES_BY_ID[t.id] = t; });
    var tbSeq = 0;

    /* -------- Barra de herramientas: pincel / borrador (excluyentes, y
                desactivables: por defecto ninguna está activa; un clic
                selecciona la herramienta, y volver a clickearla la apaga) -------- */
    /* -------- Barra de herramientas: el pincel es el modo por defecto
                (el color lo controla el regulador/gotero); el borrador es
                un toggle: activado = borra, desactivado = pinta -------- */
    if(toolEraser){
      toolEraser.addEventListener('click', function(){
        var wasActive = toolEraser.classList.contains('active');
        toolEraser.classList.toggle('active', !wasActive);
        toolEraser.setAttribute('aria-pressed', String(!wasActive));
        if(window.__syncTexturasVectorizeEraserCursor) window.__syncTexturasVectorizeEraserCursor();
      });
    }

    /* El único modo de dibujo disponible ahora es el borrador: ya no se usa
       un "pincel" de pintado, así que sin el borrador activo el mouse no
       traza nada (ni se muestra el círculo guía) sobre el canvas. */
    function activeBrushTool(){
      if(toolEraser && toolEraser.classList.contains('active')) return 'eraser';
      return null;
    }

    /* -------- Valor de tolerancia: el control visual "scrubbable" fue
                eliminado de la vista texturas, así que el valor se guarda
                en una variable interna en lugar de leer el DOM -------- */
    var TOLERANCE_MIN = toleranceVal ? (parseInt(toleranceVal.dataset.min, 10) || 2) : 2;
    var TOLERANCE_MAX = toleranceVal ? (parseInt(toleranceVal.dataset.max, 10) || 120) : 120;
    var toleranceValueInternal = toleranceVal ? (parseInt(toleranceVal.dataset.value, 10) || 32) : 32;

    function getToleranceValue(){
      return toleranceValueInternal || TOLERANCE_MIN;
    }

    function setToleranceValue(v, silent){
      v = Math.max(TOLERANCE_MIN, Math.min(TOLERANCE_MAX, Math.round(v)));
      toleranceValueInternal = v;
      if(toleranceVal){
        toleranceVal.dataset.value = v;
        toleranceVal.textContent = v;
        toleranceVal.setAttribute('aria-valuenow', v);
      }
      if(!silent) refreshModalPreview();
    }

    if(toleranceVal){
      (function(){
        var dragging = false;
        var startX = 0;
        var startValue = 0;
        var SENSITIVITY = 0.6; // px de mouse por unidad de tolerancia

        function onPointerMove(e){
          if(!dragging) return;
          var dx = e.clientX - startX;
          setToleranceValue(startValue + dx * SENSITIVITY);
        }
        function onPointerUp(){
          if(!dragging) return;
          dragging = false;
          toleranceVal.classList.remove('is-scrubbing');
          document.removeEventListener('mousemove', onPointerMove);
          document.removeEventListener('mouseup', onPointerUp);
        }

        toleranceVal.addEventListener('mousedown', function(e){
          e.preventDefault();
          dragging = true;
          startX = e.clientX;
          startValue = getToleranceValue();
          toleranceVal.classList.add('is-scrubbing');
          document.addEventListener('mousemove', onPointerMove);
          document.addEventListener('mouseup', onPointerUp);
        });

        // Accesibilidad: también se puede ajustar con las flechas del teclado
        toleranceVal.addEventListener('keydown', function(e){
          if(e.key === 'ArrowRight' || e.key === 'ArrowUp'){
            e.preventDefault();
            setToleranceValue(getToleranceValue() + 1);
          } else if(e.key === 'ArrowLeft' || e.key === 'ArrowDown'){
            e.preventDefault();
            setToleranceValue(getToleranceValue() - 1);
          }
        });
      })();
    }

    /* -------- Borrador real: mientras está activo, el círculo guía sigue al
                mouse y, al arrastrar, borra de verdad los píxeles del canvas
                (deja transparencia), en vez de solo pintar una máscara que se
                desvanecía sin dejar cambios. El trazo se guarda en % del
                ancho/alto del elemento para poder reaplicarlo siempre que se
                redibuje la imagen (cambio de tolerancia, de color, o al
                incorporar el ajuste final). -------- */
    (function(){
      var isStroking = false;
      var lastPt = null;
      var currentStroke = null;
      var ERASER_RADIUS_DISPLAY = 24; // radio visual del borrador, en px de pantalla

      function syncOverlaySize(){
        // ya no se usa un canvas de overlay separado: el borrador dibuja
        // directo sobre modalCanvas. Se mantiene esta función (llamada al
        // abrir el modal / redimensionar) sólo para refrescar el cursor.
        syncCursorVisibility();
      }
      window.__syncTexturasVectorizeBrushOverlay = syncOverlaySize;
      window.__syncTexturasVectorizeEraserCursor = syncCursorVisibility;

      function canvasPointFromEvent(e){
        var rect = modalCanvas.getBoundingClientRect();
        var scaleX = modalCanvas.width / rect.width;
        var scaleY = modalCanvas.height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
          scaleX: scaleX
        };
      }

      function eraseAt(ctx, pt, radiusCanvasPx){
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radiusCanvasPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      function eraseSegment(ctx, p1, p2, radiusCanvasPx){
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = radiusCanvasPx * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
      }

      /* -------- Muestreo de color cercano ("corrector"): en vez de dejar un
                  agujero transparente, se toma el color del contorno justo
                  afuera del círculo del pincel (promediando varios puntos en
                  anillo) y se rellena con ese color sólido. Funciona muy bien
                  sobre fondos/ilustraciones de colores planos. Si no hay
                  píxeles válidos alrededor (por ej. en un borde del canvas
                  rodeado de transparencia) se cae de nuevo al borrado
                  transparente normal, para no pintar un color inventado. -------- */
      function sampleFillColor(ctx, w, h, pt, radiusCanvasPx){
        var margin = Math.max(6, radiusCanvasPx * 0.5);
        var sampleR = radiusCanvasPx + margin;
        var boxX0 = Math.max(0, Math.floor(pt.x - sampleR));
        var boxY0 = Math.max(0, Math.floor(pt.y - sampleR));
        var boxX1 = Math.min(w, Math.ceil(pt.x + sampleR));
        var boxY1 = Math.min(h, Math.ceil(pt.y + sampleR));
        var boxW = boxX1 - boxX0, boxH = boxY1 - boxY0;
        if(boxW <= 0 || boxH <= 0) return null;
        var data;
        try { data = ctx.getImageData(boxX0, boxY0, boxW, boxH).data; }
        catch(e){ return null; }
        var rSum = 0, gSum = 0, bSum = 0, count = 0;
        var angles = 16;
        for(var i = 0; i < angles; i++){
          var theta = (i / angles) * Math.PI * 2;
          var sx = Math.round(pt.x + Math.cos(theta) * sampleR) - boxX0;
          var sy = Math.round(pt.y + Math.sin(theta) * sampleR) - boxY0;
          if(sx < 0 || sy < 0 || sx >= boxW || sy >= boxH) continue;
          var idx = (sy * boxW + sx) * 4;
          var a = data[idx + 3];
          if(a < 40) continue; // ignora transparencia (fondo ya recortado)
          rSum += data[idx]; gSum += data[idx+1]; bSum += data[idx+2];
          count++;
        }
        if(!count) return null;
        return { r: Math.round(rSum/count), g: Math.round(gSum/count), b: Math.round(bSum/count) };
      }

      function fillAt(ctx, pt, radiusCanvasPx, color){
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radiusCanvasPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      function fillSegment(ctx, p1, p2, radiusCanvasPx, color){
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgb(' + color.r + ',' + color.g + ',' + color.b + ')';
        ctx.lineWidth = radiusCanvasPx * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
      }

      /* Dab/segmento "corrector": intenta rellenar con el color cercano;
         si no encuentra un color válido alrededor, borra transparente como
         antes (fallback). Devuelve el color usado (o null si fue borrado
         transparente) para poder guardarlo en el trazo y reproducirlo igual
         más adelante (undo/redo, cambios de tolerancia/color, etc). */
      function correctAt(ctx, w, h, pt, radiusCanvasPx){
        var color = sampleFillColor(ctx, w, h, pt, radiusCanvasPx);
        if(color) fillAt(ctx, pt, radiusCanvasPx, color);
        else eraseAt(ctx, pt, radiusCanvasPx);
        return color;
      }

      function correctSegment(ctx, w, h, p1, p2, radiusCanvasPx){
        var color = sampleFillColor(ctx, w, h, p2, radiusCanvasPx);
        if(color) fillSegment(ctx, p1, p2, radiusCanvasPx, color);
        else eraseSegment(ctx, p1, p2, radiusCanvasPx);
        return color;
      }

      function updateCursorPosition(e){
        if(!brushCursor || !modalCanvasWrapEl) return;
        var wrapRect = modalCanvasWrapEl.getBoundingClientRect();
        brushCursor.style.left = (e.clientX - wrapRect.left) + 'px';
        brushCursor.style.top  = (e.clientY - wrapRect.top) + 'px';
      }

      function showCursor(){
        if(!brushCursor) return;
        if(activeBrushTool() !== 'eraser'){ hideCursor(); return; }
        brushCursor.classList.add('tool-eraser');
        brushCursor.classList.add('visible');
      }

      function hideCursor(){
        if(brushCursor) brushCursor.classList.remove('visible');
      }

      // Al activar/desactivar el borrador (sin mover el mouse) el cursor
      // debe aparecer/ocultarse igual; usamos la última posición conocida.
      var lastClientEvt = null;
      function syncCursorVisibility(){
        if(activeBrushTool() === 'eraser' && lastClientEvt){
          updateCursorPosition(lastClientEvt);
          showCursor();
        } else {
          hideCursor();
        }
      }

      function endStroke(){
        if(!isStroking) return;
        isStroking = false;
        lastPt = null;
        if(currentStroke && activeModalId){
          var item = items[activeModalId];
          if(item){
            item.eraseStrokes.push(currentStroke);
            item.eraseRedoStack.length = 0; // un trazo nuevo invalida el "rehacer"
          }
        }
        currentStroke = null;
      }

      if(modalCanvasWrapEl){
        modalCanvasWrapEl.addEventListener('mouseenter', function(e){
          lastClientEvt = e;
          updateCursorPosition(e);
          showCursor();
        });
        modalCanvasWrapEl.addEventListener('mousemove', function(e){
          lastClientEvt = e;
          updateCursorPosition(e);
          showCursor();
          if(isStroking){
            var pt = canvasPointFromEvent(e);
            var radiusPx = ERASER_RADIUS_DISPLAY * pt.scaleX;
            var ctx = modalCanvas.getContext('2d');
            var usedColor = lastPt
              ? correctSegment(ctx, modalCanvas.width, modalCanvas.height, lastPt, pt, radiusPx)
              : correctAt(ctx, modalCanvas.width, modalCanvas.height, pt, radiusPx);
            if(currentStroke){
              currentStroke.points.push({ xPct: pt.x / modalCanvas.width * 100, yPct: pt.y / modalCanvas.height * 100, color: usedColor });
            }
            lastPt = pt;
          }
        });
        modalCanvasWrapEl.addEventListener('mouseleave', function(){
          hideCursor();
          endStroke();
        });
        modalCanvasWrapEl.addEventListener('mousedown', function(e){
          if(e.button !== 0) return;
          if(activeBrushTool() !== 'eraser') return; // sin el borrador activo, el mouse no borra nada
          isStroking = true;
          lastPt = null;
          var pt = canvasPointFromEvent(e);
          var radiusPx = ERASER_RADIUS_DISPLAY * pt.scaleX;
          var radiusPct = radiusPx / modalCanvas.width * 100;
          var ctx = modalCanvas.getContext('2d');
          var usedColor = correctAt(ctx, modalCanvas.width, modalCanvas.height, pt, radiusPx);
          currentStroke = { rPct: radiusPct, points: [{ xPct: pt.x / modalCanvas.width * 100, yPct: pt.y / modalCanvas.height * 100, color: usedColor }] };
          lastPt = pt;
        });

        document.addEventListener('mouseup', endStroke);
      }
    })();

    /* -------- Zoom con la rueda del mouse, centrado en el puntero.
                No cambia el tamaño del contenedor (overflow:hidden), sólo
                escala visualmente el contenido (canvas + trazo + cuadros
                de texto) mediante transform. Reemplaza el comportamiento
                de "encoger el pincel" con la rueda: acá la rueda hace zoom. -------- */
    var zoomScale = 1;
    var zoomPanX = 0;
    var zoomPanY = 0;
    var ZOOM_MIN = 1;
    var ZOOM_MAX = 6;

    function applyZoomTransform(){
      if(!canvasZoomEl) return;
      canvasZoomEl.style.transform = 'translate(' + zoomPanX + 'px,' + zoomPanY + 'px) scale(' + zoomScale + ')';
    }

    function resetZoom(){
      zoomScale = 1;
      zoomPanX = 0;
      zoomPanY = 0;
      applyZoomTransform();
    }
    window.__resetTexturasVectorizeZoom = resetZoom;

    if(modalCanvasWrapEl && canvasZoomEl){
      modalCanvasWrapEl.addEventListener('wheel', function(e){
        e.preventDefault();

        var wrapRect = modalCanvasWrapEl.getBoundingClientRect();
        var mouseX = e.clientX - wrapRect.left;
        var mouseY = e.clientY - wrapRect.top;

        var oldScale = zoomScale;
        var zoomFactor = Math.exp(-e.deltaY * 0.0015);
        var newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldScale * zoomFactor));
        if(newScale === oldScale) return;

        // punto del contenido que está bajo el mouse, antes de aplicar el nuevo zoom
        var contentX = (mouseX - zoomPanX) / oldScale;
        var contentY = (mouseY - zoomPanY) / oldScale;

        zoomScale = newScale;
        zoomPanX = mouseX - contentX * zoomScale;
        zoomPanY = mouseY - contentY * zoomScale;

        if(zoomScale <= ZOOM_MIN){
          // vuelve a encajar exactamente en el contenedor, sin desplazamiento
          zoomScale = ZOOM_MIN;
          zoomPanX = 0;
          zoomPanY = 0;
        }
        applyZoomTransform();
      }, { passive: false });
    }

    var items = {};   // id -> { img, tolerance, cardEl }
    var itemSeq = 0;
    var activeModalId = null;
    window.__texturasItems = items; // referencia viva para el picker de #textureModalBackdrop
    function refreshHasImage(canvasWrapEl, gridEl){
      var has = gridEl.children.length > 0;
      canvasWrapEl.classList.toggle('has-image', has);
    }

    /* -------- Markup del loader animado: solo el helado con desvanecido, sin texto -------- */
    function loadingHTML(){
      return '' +
        '<div class="texturas-loading">' +
          '<div class="texturas-loading-pop"></div>' +
        '</div>';
    }

    /* -------- Duración mínima visible del loader, para que la animación
                no "parpadee" cuando el procesamiento es muy rápido -------- */
    var MIN_LOADING_MS = 1000;
    function afterMinDuration(startTime, fn){
      var wait = MIN_LOADING_MS - (Date.now() - startTime);
      if(wait > 0) setTimeout(fn, wait); else fn();
    }

    /* -------- Crear la tarjeta y procesar la imagen -------- */
    var pendingStarts = {}; // id -> timestamp de inicio del loader, para la duración mínima de 1s

    /* -------- Conecta una grilla de subida (click / drag&drop / pegado) con
                el mismo pipeline de Texturas (sin recorte de fondo): permite
                reutilizar esta lógica en más de una grilla, p.ej. también en
                "Fondos" de la Vista Temáticas. -------- */
    function attachUploadGrid(canvasWrapEl, gridEl, fileInputEl){
      if(!canvasWrapEl || !gridEl || !fileInputEl) return;

      /* -------- Click / drag & drop para abrir el selector de archivos -------- */
      canvasWrapEl.addEventListener('click', function(e){
        if(e.target.closest('.texturas-upload-card')) return;
        fileInputEl.click();
      });

      fileInputEl.addEventListener('click', function(e){ e.stopPropagation(); });

      fileInputEl.addEventListener('change', function(){
        handleFiles(fileInputEl.files);
        fileInputEl.value = '';
      });

      ['dragenter','dragover'].forEach(function(evt){
        canvasWrapEl.addEventListener(evt, function(e){
          e.preventDefault(); e.stopPropagation();
          canvasWrapEl.classList.add('drag-over');
        });
      });
      ['dragleave','dragend'].forEach(function(evt){
        canvasWrapEl.addEventListener(evt, function(e){
          if(evt === 'dragleave' && canvasWrapEl.contains(e.relatedTarget)) return;
          canvasWrapEl.classList.remove('drag-over');
        });
      });
      canvasWrapEl.addEventListener('drop', function(e){
        e.preventDefault(); e.stopPropagation();
        canvasWrapEl.classList.remove('drag-over');
        if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
          handleFiles(e.dataTransfer.files);
        }
      });

      function handleFiles(fileList){
        Array.prototype.forEach.call(fileList, function(file){
          if(!/^image\//.test(file.type)) return;
          addElementFromFile(file);
        });
      }

      /* -------- Pegar imagen desde el portapapeles (Ctrl+V / Cmd+V), sólo
                  cuando esta grilla es la que está visible en pantalla -------- */
      document.addEventListener('paste', function(e){
        // Si el modal de ajuste está abierto, no interferir con lo que se esté haciendo ahí
        if(modalOverlay.classList.contains('open')) return;
        // Si esta grilla no está visible (otra vista/panel activo), no interceptar el pegado
        if(!canvasWrapEl.offsetParent) return;
        // No interferir si se está pegando texto dentro de un input/textarea editable
        var active = document.activeElement;
        if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

        var clipboardItems = (e.clipboardData || window.clipboardData) ? (e.clipboardData || window.clipboardData).items : null;
        if(!clipboardItems) return;

        var imageFiles = [];
        Array.prototype.forEach.call(clipboardItems, function(item){
          if(item.kind === 'file' && /^image\//.test(item.type)){
            var file = item.getAsFile();
            if(file) imageFiles.push(file);
          }
        });

        if(imageFiles.length){
          e.preventDefault();
          handleFiles(imageFiles);
        }
      });

      /* -------- Al clickear el elemento (SVG generado o imagen de respaldo)
                  se abre el modal de ajuste de recorte -------- */
      gridEl.addEventListener('click', function(e){
        if(e.target.closest('.texturas-upload-remove')) return;
        var card = e.target.closest('.texturas-upload-card');
        if(!card) return;
        var id = card.dataset.id;
        var item = items[id];
        if(!item) return;
        e.stopPropagation();
        openAdjustModal(id);
      });

      function addElementFromFile(file){
        var id = 'el' + (++itemSeq);
        pendingStarts[id] = Date.now();
        var card = document.createElement('div');
        card.className = 'texturas-upload-card';
        card.dataset.id = id;
        card.innerHTML =
          '<div class="texturas-upload-svgwrap">' + loadingHTML() + '</div>' +
          '<div class="texturas-textboxes-layer"></div>' +
          '<button type="button" class="texturas-upload-remove" title="Quitar">×</button>';
        gridEl.appendChild(card);
        refreshHasImage(canvasWrapEl, gridEl);

        card.querySelector('.texturas-upload-remove').addEventListener('click', function(e){
          e.stopPropagation();
          var wrapEl = card.querySelector('.texturas-upload-svgwrap');
          if(svgResizeObserver && wrapEl) svgResizeObserver.unobserve(wrapEl);
          card.remove();
          delete items[id];
          delete pendingStarts[id];
          refreshHasImage(canvasWrapEl, gridEl);
        });

        var reader = new FileReader();
        reader.onload = function(ev){
          var img = new Image();
          img.onload = function(){
            items[id] = { img: img, tolerance: 32, cardEl: card, textboxes: [], eraseStrokes: [], eraseRedoStack: [] };
            runPipeline(id);
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
    }

    attachUploadGrid(canvasWrap, grid, fileInput);

    // Reutiliza el pipeline de Texturas (misma imagen incorporada tal cual,
    // sin recorte automático de fondo) para la grilla de "Fondos" de la
    // Vista Temáticas, usando el mismo modal compartido de Texturas.
    attachUploadGrid(
      document.getElementById('tematicasFondosGrid'),
      document.getElementById('tematicasFondosCards'),
      document.getElementById('tematicasFondosFileInput')
    );

    // Misma lógica de subida (sin recorte de fondo) para la sección "Fondos"
    // del panel lateral de Plantillas (#side-panel-2).
    attachUploadGrid(
      document.getElementById('sp2FondosGrid'),
      document.getElementById('sp2FondosCards'),
      document.getElementById('sp2FondosFileInput')
    );

    /* -------- Quitar fondo: flood fill conectado desde los bordes, usando como
                referencia el color más frecuente del perímetro. 100% automático,
                sin selección manual de color. -------- */
    // ---------- Vista Texturas: NO se elimina el fondo de las imágenes ----------
    // A diferencia de "Elementos", acá la imagen se incorpora tal cual, con su
    // fondo original intacto (sin recorte automático ni por color).
    function removeBackground(ctx, width, height, tolerance){
      // No-op intencional: se deja la imagen sin procesar.
    }

    /* -------- Erosiona 'n' píxeles el borde de la figura para comerse el halo
                de color mezclado que deja el anti-aliasing original -------- */
    function erodeEdges(ctx, width, height, iterations){
      for(var it=0; it<iterations; it++){
        var imgData = ctx.getImageData(0, 0, width, height);
        var data = imgData.data;
        var toKill = [];
        for(var y=0; y<height; y++){
          for(var x=0; x<width; x++){
            var i = (y*width + x);
            if(data[i*4+3] === 0) continue; // ya es transparente
            // si algún vecino directo es transparente, este píxel es borde -> lo comemos
            var neighborTransparent =
              (x>0 && data[(i-1)*4+3] === 0) ||
              (x<width-1 && data[(i+1)*4+3] === 0) ||
              (y>0 && data[(i-width)*4+3] === 0) ||
              (y<height-1 && data[(i+width)*4+3] === 0);
            if(neighborTransparent) toKill.push(i);
          }
        }
        toKill.forEach(function(i){ data[i*4+3] = 0; });
        ctx.putImageData(imgData, 0, 0);
      }
    }

    /* -------- Pipeline: quitar fondo + vectorizar a SVG -------- */
    function runPipeline(id){
      var item = items[id];
      if(!item) return;
      var img = item.img;
      var MAXDIM = 900;
      var scale = Math.min(1, MAXDIM / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));

      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      removeBackground(ctx, w, h, item.tolerance);
      applyColorOverrides(ctx, w, h, item.colorOverrides, item.palette);
      applyEraseStrokes(ctx, w, h, item.eraseStrokes, item.palette, item.colorOverrides);

      // el loader se muestra desde que se agregó el archivo (o desde ahora, si
      // se vuelve a correr el pipeline al "Incorporar" un ajuste manual)
      var startTime = pendingStarts[id] || Date.now();
      delete pendingStarts[id];

      var wrap = item.cardEl.querySelector('.texturas-upload-svgwrap');
      wrap.style.display = '';
      wrap.style.fontSize = '';
      wrap.style.color = '';
      wrap.innerHTML = loadingHTML();

      var pngDataUrl = canvas.toDataURL('image/png');

      var options = {
        ltres: 1, qtres: 1, pathomit: 20,
        blurradius: smoothCheck && smoothCheck.checked ? 1 : 0,
        blurdelta: 20,
        strokewidth: 0,
        numberofcolors: 12,
        colorsampling: 1,
        mincolorratio: 0,
        scale: 1,
        roundcoords: 1,
        viewbox: true,
        desc: false
      };

      try{
        ImageTracer.imageToSVG(pngDataUrl, function(svgstr){
          afterMinDuration(startTime, function(){
            wrap.innerHTML = svgstr;
            fitSvgToContainer(wrap);
          });
        }, options);
      }catch(err){
        // fallback: si algo falla en la vectorización, mostramos el PNG sin fondo
        afterMinDuration(startTime, function(){
          wrap.innerHTML = '';
          var fallbackImg = document.createElement('img');
          fallbackImg.src = pngDataUrl;
          wrap.appendChild(fallbackImg);
        });
      }
    }

    /* -------- Hace que el svg mida el espacio real disponible en su contenedor
                y se ajuste cada vez que ese espacio cambia (resize, layout, etc.) -------- */
    var svgResizeObserver = ('ResizeObserver' in window) ? new ResizeObserver(function(entries){
      entries.forEach(function(entry){
        var el = entry.target;
        var svg = el.querySelector(':scope > svg');
        if(!svg) return;
        var rect = entry.contentRect;
        var w = Math.max(1, Math.round(rect.width));
        var h = Math.max(1, Math.round(rect.height));
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      });
    }) : null;

    function fitSvgToContainer(wrapEl){
      var svg = wrapEl.querySelector(':scope > svg');
      if(!svg) return;
      // la imagen debe cubrir todo el cuadrado sin deformarse (recorta el
      // sobrante en vez de dejar franjas vacías alrededor)
      svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      // medición inmediata (por si el ResizeObserver tarda un frame)
      var rect = wrapEl.getBoundingClientRect();
      if(rect.width > 0 && rect.height > 0){
        svg.setAttribute('width', Math.round(rect.width));
        svg.setAttribute('height', Math.round(rect.height));
      }
      if(svgResizeObserver) svgResizeObserver.observe(wrapEl);
    }

    /* -------- Cuadros de Textos: picker con miniaturas reales de cada plantilla -------- */
    var textboxesGrid = document.getElementById('texturasVectorizeTextboxesGrid');
    var colorsGrid = document.getElementById('texturasVectorizeColorsGrid');
    var COLOR_QUANT_STEP = 24; /* agrupa tonos cercanos como "el mismo color" */

    function quantKey(r, g, b){
      var s = COLOR_QUANT_STEP;
      return Math.round(r/s)*s + ',' + Math.round(g/s)*s + ',' + Math.round(b/s)*s;
    }
    function rgbToHex(r, g, b){
      function h(n){ n = Math.max(0, Math.min(255, Math.round(n))); var s = n.toString(16); return s.length < 2 ? '0'+s : s; }
      return '#' + h(r) + h(g) + h(b);
    }
    function hexToRgb(hex){
      hex = hex.replace('#','');
      return {
        r: parseInt(hex.substring(0,2), 16),
        g: parseInt(hex.substring(2,4), 16),
        b: parseInt(hex.substring(4,6), 16)
      };
    }
    function rgbToHsl(r, g, b){
      r/=255; g/=255; b/=255;
      var max = Math.max(r,g,b), min = Math.min(r,g,b);
      var l = (max+min)/2, d = max-min, h = 0, s = 0;
      if(d !== 0){
        s = d / (1 - Math.abs(2*l - 1));
        switch(max){
          case r: h = 60 * (((g-b)/d) % 6); break;
          case g: h = 60 * ((b-r)/d + 2); break;
          case b: h = 60 * ((r-g)/d + 4); break;
        }
        if(h < 0) h += 360;
      }
      return { h:h, s:s, l:l };
    }
    function hslToRgb(h, s, l){
      var c = (1 - Math.abs(2*l - 1)) * s;
      var x = c * (1 - Math.abs((h/60) % 2 - 1));
      var m = l - c/2;
      var r=0, g=0, b=0;
      if(h < 60){ r=c; g=x; b=0; }
      else if(h < 120){ r=x; g=c; b=0; }
      else if(h < 180){ r=0; g=c; b=x; }
      else if(h < 240){ r=0; g=x; b=c; }
      else if(h < 300){ r=x; g=0; b=c; }
      else { r=c; g=0; b=x; }
      return { r:(r+m)*255, g:(g+m)*255, b:(b+m)*255 };
    }

    /* Recorre los píxeles y agrupa por color cuantizado; devuelve los N colores
       más frecuentes (ignorando los que son casi transparentes). */
    function extractPalette(ctx, w, h, maxColors){
      var data = ctx.getImageData(0, 0, w, h).data;
      var buckets = {};
      var totalOpaque = 0;
      for(var i = 0; i < data.length; i += 4){
        var a = data[i+3];
        if(a < 20) continue;
        totalOpaque++;
        var r = data[i], g = data[i+1], b = data[i+2];
        var key = quantKey(r, g, b);
        var bucket = buckets[key];
        if(!bucket){ bucket = buckets[key] = { r:0, g:0, b:0, count:0 }; }
        bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
      }
      var list = Object.keys(buckets).map(function(key){
        var bkt = buckets[key];
        return { key:key, count:bkt.count, r: bkt.r/bkt.count, g: bkt.g/bkt.count, b: bkt.b/bkt.count };
      });
      list.sort(function(a,b){ return b.count - a.count; });
      var shown = list.slice(0, maxColors);
      var shownCount = shown.reduce(function(sum, c){ return sum + c.count; }, 0);
      return {
        colors: shown,
        totalOpaque: totalOpaque,
        leftoverBuckets: list.length - shown.length,
        leftoverPixelsPct: totalOpaque ? Math.round((1 - shownCount / totalOpaque) * 100) : 0
      };
    }

    /* Aplica los cambios de color guardados. Para cada píxel opaco busca, entre los
       colores detectados (palette), cuál es el más parecido en color real (distancia
       RGB) — no por bucket exacto ni por tono — y si ese color tiene un cambio
       guardado, lo aplica. Así, los tonos "de sobra" que no tienen su propio cuadrado
       en la grilla también se mueven junto con el color detectado al que más se
       parecen. */
    function applyColorOverrides(ctx, w, h, overrides, palette){
      if(!overrides || !palette || !palette.length) return;
      var keys = Object.keys(overrides);
      if(!keys.length) return;
      var imgData = ctx.getImageData(0, 0, w, h);
      var data = imgData.data;
      var n = palette.length;
      for(var i = 0; i < data.length; i += 4){
        var a = data[i+3];
        if(a < 20) continue;
        var r = data[i], g = data[i+1], b = data[i+2];
        var bestKey = null, bestDist = Infinity;
        for(var j = 0; j < n; j++){
          var p = palette[j];
          var dr = r - p.r, dg = g - p.g, db = b - p.b;
          var dist = dr*dr + dg*dg + db*db;
          if(dist < bestDist){ bestDist = dist; bestKey = p.key; }
        }
        var newHex = overrides[bestKey];
        if(!newHex) continue;
        var rgb = hexToRgb(newHex);
        data[i] = rgb.r; data[i+1] = rgb.g; data[i+2] = rgb.b;
      }
      ctx.putImageData(imgData, 0, 0);
    }

    /* Busca, dentro de la paleta detectada, la entrada más cercana a un color
       dado (misma métrica que usa applyColorOverrides para pintar píxeles). */
    function nearestPaletteKey(r, g, b, palette){
      if(!palette || !palette.length) return null;
      var bestKey = null, bestDist = Infinity;
      for(var j = 0; j < palette.length; j++){
        var p = palette[j];
        var dr = r - p.r, dg = g - p.g, db = b - p.b;
        var dist = dr*dr + dg*dg + db*db;
        if(dist < bestDist){ bestDist = dist; bestKey = p.key; }
      }
      return bestKey;
    }

    /* Resuelve el color con el que se debe repintar un punto/segmento del
       "corrector": si el color que se guardó al pintarlo coincide con algún
       color de la paleta que el usuario ya recoloreó, se usa el color nuevo
       en vez del guardado — así las marcas del corrector siguen el cambio
       de color en vez de quedar "pegadas" al tono original. */
    function resolveStrokeColor(storedColor, palette, overrides){
      if(!storedColor) return null;
      if(overrides && palette && palette.length){
        var key = nearestPaletteKey(storedColor.r, storedColor.g, storedColor.b, palette);
        var newHex = key && overrides[key];
        if(newHex) return hexToRgb(newHex);
      }
      return storedColor;
    }

    /* -------- Aplica los trazos de borrador manual guardados para este elemento.
                Cada trazo se guarda en coordenadas relativas (% del ancho/alto),
                así que se puede volver a aplicar sobre cualquier canvas (la
                preview chica del modal o el canvas grande del pipeline final)
                y sobrevive a los cambios de tolerancia/color, que vuelven a
                dibujar la imagen desde cero.

                palette/overrides (opcionales) son la paleta detectada y los
                cambios de color guardados en ese momento: se usan para volver
                a mapear el color de cada punto del trazo, de forma que las
                marcas del "corrector" seguán el cambio de color en vez de
                quedar pegadas al tono que tenían cuando se pintaron. -------- */
    function applyEraseStrokes(ctx, w, h, strokes, palette, overrides){
      if(!strokes || !strokes.length) return;
      strokes.forEach(function(stroke){
        var pts = stroke.points;
        if(!pts || !pts.length) return;
        var rPx = (stroke.rPct / 100) * w;

        function toXY(p){ return { x: (p.xPct/100)*w, y: (p.yPct/100)*h }; }

        // Primer punto del trazo: dab con su color guardado (remapeado según
        // los cambios de color vigentes), o transparente si en su momento no
        // se encontró un color válido cerca.
        var p0 = toXY(pts[0]);
        var color0 = resolveStrokeColor(pts[0].color, palette, overrides);
        ctx.save();
        if(color0){
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = 'rgb(' + color0.r + ',' + color0.g + ',' + color0.b + ')';
        } else {
          ctx.globalCompositeOperation = 'destination-out';
        }
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, rPx, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();

        // Resto del trazo: cada segmento usa el color guardado en su punto
        // final (el mismo criterio que se usó al dibujar en vivo), remapeado
        // igual que el primer punto.
        for(var i = 1; i < pts.length; i++){
          var a = toXY(pts[i-1]);
          var b = toXY(pts[i]);
          var colorI = resolveStrokeColor(pts[i].color, palette, overrides);
          ctx.save();
          if(colorI){
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = 'rgb(' + colorI.r + ',' + colorI.g + ',' + colorI.b + ')';
          } else {
            ctx.globalCompositeOperation = 'destination-out';
          }
          ctx.lineWidth = rPx * 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.restore();
        }
      });
    }


    /* Extrae la paleta del elemento activo (a partir del canvas del modal, ya con
       el fondo removido) y dibuja las muestras editables en #texturasVectorizeColorsGrid. */
    function renderColorPalette(id){
      if(!colorsGrid) return;
      colorsGrid.innerHTML = '';
      var item = items[id];
      if(!item) return;

      var ctx = modalCanvas.getContext('2d');
      var result = extractPalette(ctx, modalCanvas.width, modalCanvas.height, 12);
      item.palette = result.colors;
      item.lockedColors = item.lockedColors || {};

      if(!item.palette.length){
        firstDetectedColorInput = null;
        var empty = document.createElement('div');
        empty.className = 'vectorize-colors-empty';
        empty.textContent = 'Sin colores detectados todavía.';
        colorsGrid.appendChild(empty);
        return;
      }

      item.palette.forEach(function(c, idx){
        var hex = (item.colorOverrides && item.colorOverrides[c.key]) || rgbToHex(c.r, c.g, c.b);
        var isLocked = !!item.lockedColors[c.key];

        var swatch = document.createElement('div');
        swatch.className = 'vectorize-color-swatch' + (isLocked ? ' locked' : '');
        swatch.style.background = hex;
        swatch.title = 'Clic: cambiar color · Doble clic: bloquear/desbloquear (evita que este color se mueva con la rotación de tono)';
        swatch.dataset.key = c.key;

        var lockBadge = document.createElement('span');
        lockBadge.className = 'vectorize-color-swatch-lock';
        lockBadge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
        swatch.appendChild(lockBadge);

        var input = document.createElement('input');
        input.type = 'color';
        input.value = hex;
        if(idx === 0){
          // el primer color detectado del panel se mantiene sincronizado con
          // #texturasVectorizeColorSwatchTrigger, pero al clickear este swatch se usa el
          // selector nativo del navegador (no la paleta cómic)
          firstDetectedColorInput = input;
          if(toolColorInput){
            toolColorInput.value = hex;
            toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
          }
          input.addEventListener('input', function(){
            if(toolColorInput){
              toolColorInput.value = input.value;
              toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
            }
          });
        }
        // los demás colores detectados usan el selector nativo del navegador y se
        // autoajustan solos (rotación de tono) cuando el primero cambia
        input.addEventListener('input', function(){
          if(item.lockedColors[c.key]) return;
          var newHex = input.value;
          var newRgb = hexToRgb(newHex);
          var origHsl = rgbToHsl(c.r, c.g, c.b);
          var newHsl  = rgbToHsl(newRgb.r, newRgb.g, newRgb.b);
          var hueDelta = newHsl.h - origHsl.h;

          item.colorOverrides = item.colorOverrides || {};

          item.palette.forEach(function(p){
            // los colores bloqueados no se tocan, ni siquiera el que disparó el cambio
            if(item.lockedColors[p.key] && p.key !== c.key) return;

            var finalHex;
            if(p.key === c.key){
              // el color que el usuario tocó directamente se aplica tal cual lo eligió
              finalHex = newHex;
            } else {
              // los demás (no bloqueados) rotan su tono la misma cantidad, conservando
              // su propia saturación y luminosidad (su "tono" claro/oscuro no cambia)
              var hsl = rgbToHsl(p.r, p.g, p.b);
              var h = (hsl.h + hueDelta) % 360;
              if(h < 0) h += 360;
              var rgb = hslToRgb(h, hsl.s, hsl.l);
              finalHex = rgbToHex(rgb.r, rgb.g, rgb.b);
            }
            item.colorOverrides[p.key] = finalHex;
            var sw = colorsGrid.querySelector('[data-key="' + p.key + '"]');
            if(sw){
              sw.style.background = finalHex;
              var inp = sw.querySelector('input');
              if(inp) inp.value = finalHex;
            }
          });

          // volvemos a partir de la imagen original (+ recorte de fondo) para que el
          // "match" de cada color se haga siempre contra el color de base, y no contra
          // un color ya modificado en una edición anterior
          ctx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
          ctx.drawImage(item.img, 0, 0, modalCanvas.width, modalCanvas.height);
          removeBackground(ctx, modalCanvas.width, modalCanvas.height, item.tolerance);
          applyColorOverrides(ctx, modalCanvas.width, modalCanvas.height, item.colorOverrides, item.palette);
          applyEraseStrokes(ctx, modalCanvas.width, modalCanvas.height, item.eraseStrokes, item.palette, item.colorOverrides);
        });

        swatch.addEventListener('dblclick', function(e){
          e.preventDefault();
          item.lockedColors[c.key] = !item.lockedColors[c.key];
          swatch.classList.toggle('locked', item.lockedColors[c.key]);
        });

        swatch.appendChild(input);
        colorsGrid.appendChild(swatch);
      });
    }

    /* -------- Botón "Restablecer colores originales": borra todos los overrides
                y bloqueos del elemento activo y vuelve a pintar desde cero -------- */
    var colorsResetBtn = document.getElementById('texturasVectorizeColorsReset');
    if(colorsResetBtn){
      colorsResetBtn.addEventListener('click', function(){
        if(!activeModalId) return;
        var item = items[activeModalId];
        if(!item) return;
        item.colorOverrides = {};
        item.lockedColors = {};
        refreshModalPreview();
        renderColorPalette(activeModalId);
      });
    }

    function buildTextboxPicker(){
      if(!textboxesGrid) return;
      textboxesGrid.innerHTML = TEXTBOX_TEMPLATES.map(function(tpl){
        return '<div class="vectorize-textbox-item vectorize-textbox-item-field" data-template="' + tpl.id + '" title="' + tpl.label + '" aria-label="' + tpl.label + '">' +
          '<div class="vtb-field-preview">' +
            '<span class="vtb-field-rotate"></span>' +
            '<span class="vtb-field-box">' +
              '<span class="vtb-field-corner tl"></span>' +
              '<span class="vtb-field-corner tr"></span>' +
              '<span class="vtb-field-corner bl"></span>' +
              '<span class="vtb-field-corner br"></span>' +
              '<span class="vtb-field-label">' + tpl.label + '</span>' +
            '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    buildTextboxPicker();

    if(textboxesGrid){
      textboxesGrid.addEventListener('click', function(e){
        var itemEl = e.target.closest('.vectorize-textbox-item');
        if(!itemEl || !activeModalId) return;
        addTextboxInstance(activeModalId, itemEl.dataset.template);
      });
    }

    /* -------- Agrega una instancia real de la plantilla elegida sobre el elemento activo -------- */
    function addTextboxInstance(id, templateId){
      var item = items[id];
      var tpl = TEXTBOX_TEMPLATES_BY_ID[templateId];
      if(!item || !tpl) return;

      var vb = tpl.viewBox.split(' ').map(Number);
      var shapeAspect = vb[3] / vb[2]; // alto/ancho de la plantilla
      var canvasAspect = (modalCanvas.width && modalCanvas.height) ? (modalCanvas.width / modalCanvas.height) : 1;

      var wPct = 55;
      var hPct = wPct * shapeAspect * canvasAspect;
      hPct = Math.max(8, Math.min(70, hPct));

      var tb = {
        instId: 'tb' + (++tbSeq),
        templateId: templateId,
        xPct: Math.max(2, (100 - wPct) / 2),
        yPct: Math.max(2, (100 - hPct) / 2),
        wPct: wPct,
        hPct: hPct,
        rotation: 0,
        text: ''
      };
      item.textboxes.push(tb);
      renderModalTextboxes(id);
    }

    /* -------- Dibuja (o vuelve a dibujar) todas las instancias del elemento activo
                sobre el canvas del modal, ya interactivas -------- */
    function renderModalTextboxes(id){
      if(!modalCanvasWrapEl) return;
      modalCanvasWrapEl.querySelectorAll('.vectorize-tb-instance').forEach(function(el){ el.remove(); });
      var item = items[id];
      if(!item || !item.textboxes) return;

      item.textboxes.forEach(function(tb){
        var tpl = TEXTBOX_TEMPLATES_BY_ID[tb.templateId];
        if(!tpl) return;

        var el = document.createElement('div');
        el.className = 'vectorize-tb-instance';
        el.dataset.inst = tb.instId;
        el.style.left = tb.xPct + '%';
        el.style.top = tb.yPct + '%';
        el.style.width = tb.wPct + '%';
        el.style.height = tb.hPct + '%';
        el.style.transform = 'rotate(' + (tb.rotation || 0) + 'deg)';
        el.innerHTML =
          '<svg viewBox="' + tpl.viewBox + '" preserveAspectRatio="none">' + tpl.shape + '</svg>' +
          '<div class="vectorize-tb-text" contenteditable="true" spellcheck="false" data-placeholder="' + tpl.label + '..."></div>' +
          '<button type="button" class="vectorize-tb-remove" title="Quitar" aria-label="Quitar">×</button>' +
          '<span class="vectorize-tb-rotate" title="Rotar"></span>' +
          '<span class="vectorize-tb-resize tl" data-corner="tl" title="Cambiar tamaño"></span>' +
          '<span class="vectorize-tb-resize tr" data-corner="tr" title="Cambiar tamaño"></span>' +
          '<span class="vectorize-tb-resize bl" data-corner="bl" title="Cambiar tamaño"></span>' +
          '<span class="vectorize-tb-resize br" data-corner="br" title="Cambiar tamaño"></span>';
        el.querySelector('.vectorize-tb-text').textContent = tb.text || '';

        canvasZoomEl.appendChild(el);
        bindTbInstanceEvents(id, tb, el);
      });
    }

    /* -------- Interacciones de cada instancia: mover, redimensionar, editar texto, quitar -------- */
    function bindTbInstanceEvents(id, tb, el){
      var textEl     = el.querySelector('.vectorize-tb-text');
      var removeBtn  = el.querySelector('.vectorize-tb-remove');
      var resizeEls  = el.querySelectorAll('.vectorize-tb-resize');
      var rotateEl   = el.querySelector('.vectorize-tb-rotate');

      textEl.addEventListener('input', function(){ tb.text = textEl.textContent; });
      textEl.addEventListener('mousedown', function(e){ e.stopPropagation(); });

      removeBtn.addEventListener('click', function(e){
        e.stopPropagation();
        var item = items[id];
        if(item){
          item.textboxes = item.textboxes.filter(function(t){ return t.instId !== tb.instId; });
        }
        el.remove();
      });

      el.addEventListener('mousedown', function(e){
        if(e.target === removeBtn || e.target.classList.contains('vectorize-tb-resize') || e.target === rotateEl || e.target === textEl) return;
        e.preventDefault();
        var wrapRect = canvasZoomEl.getBoundingClientRect();
        var startX = e.clientX, startY = e.clientY;
        var startXPct = tb.xPct, startYPct = tb.yPct;
        el.classList.add('dragging');

        function onMove(ev){
          var dxPct = (ev.clientX - startX) / wrapRect.width * 100;
          var dyPct = (ev.clientY - startY) / wrapRect.height * 100;
          tb.xPct = Math.max(0, Math.min(100 - tb.wPct, startXPct + dxPct));
          tb.yPct = Math.max(0, Math.min(100 - tb.hPct, startYPct + dyPct));
          el.style.left = tb.xPct + '%';
          el.style.top = tb.yPct + '%';
        }
        function onUp(){
          el.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      resizeEls.forEach(function(handleEl){
        var corner = handleEl.dataset.corner || 'br';
        handleEl.addEventListener('mousedown', function(e){
          e.preventDefault();
          e.stopPropagation();
          var wrapRect = canvasZoomEl.getBoundingClientRect();
          var startX = e.clientX, startY = e.clientY;
          var startW = tb.wPct, startH = tb.hPct;
          var startXPct = tb.xPct, startYPct = tb.yPct;
          var rightEdge = startXPct + startW;
          var bottomEdge = startYPct + startH;

          function onMove(ev){
            var dxPct = (ev.clientX - startX) / wrapRect.width * 100;
            var dyPct = (ev.clientY - startY) / wrapRect.height * 100;
            var newX = startXPct, newY = startYPct, newW = startW, newH = startH;

            if(corner === 'br'){
              newW = Math.max(10, Math.min(100 - startXPct, startW + dxPct));
              newH = Math.max(6, Math.min(100 - startYPct, startH + dyPct));
            } else if(corner === 'bl'){
              newW = Math.max(10, Math.min(rightEdge, startW - dxPct));
              newX = rightEdge - newW;
              newH = Math.max(6, Math.min(100 - startYPct, startH + dyPct));
            } else if(corner === 'tr'){
              newW = Math.max(10, Math.min(100 - startXPct, startW + dxPct));
              newH = Math.max(6, Math.min(bottomEdge, startH - dyPct));
              newY = bottomEdge - newH;
            } else if(corner === 'tl'){
              newW = Math.max(10, Math.min(rightEdge, startW - dxPct));
              newX = rightEdge - newW;
              newH = Math.max(6, Math.min(bottomEdge, startH - dyPct));
              newY = bottomEdge - newH;
            }

            tb.xPct = newX;
            tb.yPct = newY;
            tb.wPct = newW;
            tb.hPct = newH;
            el.style.left = tb.xPct + '%';
            el.style.top = tb.yPct + '%';
            el.style.width = tb.wPct + '%';
            el.style.height = tb.hPct + '%';
          }
          function onUp(){
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });

      if(rotateEl){
        rotateEl.addEventListener('mousedown', function(e){
          e.preventDefault();
          e.stopPropagation();
          var startRotation = tb.rotation || 0;

          function angleAtEvent(ev){
            var rect = el.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            return Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
          }

          var startAngle = angleAtEvent(e);

          function onMove(ev){
            var currentAngle = angleAtEvent(ev);
            var delta = currentAngle - startAngle;
            var rotation = Math.round(startRotation + delta);
            // normalizamos a [0, 360)
            rotation = ((rotation % 360) + 360) % 360;
            tb.rotation = rotation;
            el.style.transform = 'rotate(' + rotation + 'deg)';
          }
          function onUp(){
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }
    }

    /* -------- Traslada los cuadros de texto ya definidos a la tarjeta final del elemento -------- */
    function renderTextboxesOnCard(id){
      var item = items[id];
      if(!item || !item.cardEl) return;
      var layer = item.cardEl.querySelector('.texturas-textboxes-layer');
      if(!layer) return;
      layer.innerHTML = '';

      (item.textboxes || []).forEach(function(tb){
        var tpl = TEXTBOX_TEMPLATES_BY_ID[tb.templateId];
        if(!tpl) return;
        var wrap = document.createElement('div');
        wrap.className = 'texturas-tb-final';
        wrap.style.left = tb.xPct + '%';
        wrap.style.top = tb.yPct + '%';
        wrap.style.width = tb.wPct + '%';
        wrap.style.height = tb.hPct + '%';
        wrap.style.transform = 'rotate(' + (tb.rotation || 0) + 'deg)';
        wrap.innerHTML =
          '<svg viewBox="' + tpl.viewBox + '" preserveAspectRatio="none">' + tpl.shape + '</svg>' +
          '<div class="texturas-tb-final-text"></div>';
        wrap.querySelector('.texturas-tb-final-text').textContent = tb.text || '';
        layer.appendChild(wrap);
      });
    }

    /* -------- Modal de ajuste de recorte (automático) -------- */

    function openAdjustModal(id){
      var item = items[id];
      if(!item) return;
      activeModalId = id;

      var img = item.img;
      var maxW = 320;
      var scale = Math.min(1, maxW / img.naturalWidth);
      var w = Math.round(img.naturalWidth * scale);
      var h = Math.round(img.naturalHeight * scale);
      modalCanvas.width = w;
      modalCanvas.height = h;
      var ctx = modalCanvas.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img, 0, 0, w, h);
      // aplicamos el recorte de fondo automático actual (según la tolerancia vigente)
      // para previsualizar la transparencia real sobre la cuadrícula azul
      removeBackground(ctx, w, h, item.tolerance);
      // primero extraemos/pintamos la paleta (a partir de los colores originales),
      // y sólo después reaplicamos los cambios de color que el usuario ya haya hecho
      renderColorPalette(id);
      applyColorOverrides(ctx, w, h, item.colorOverrides, item.palette);
      applyEraseStrokes(ctx, w, h, item.eraseStrokes, item.palette, item.colorOverrides);

      setToleranceValue(item.tolerance, true);
      if(window.__syncTexturasVectorizeBrushOverlay) window.__syncTexturasVectorizeBrushOverlay();
      if(window.__resetTexturasVectorizeZoom) window.__resetTexturasVectorizeZoom();

      modalOverlay.classList.add('open');
      // vuelve a dibujar los cuadros de texto que ya tenía este elemento (si los tenía)
      renderModalTextboxes(id);
    }

    function closeAdjustModal(){
      modalOverlay.classList.remove('open');
      if(modalCanvasWrapEl){
        modalCanvasWrapEl.querySelectorAll('.vectorize-tb-instance').forEach(function(el){ el.remove(); });
      }
      if(toolEraser){
        toolEraser.classList.remove('active');
        toolEraser.setAttribute('aria-pressed', 'false');
      }
      if(window.__resetTexturasVectorizeZoom) window.__resetTexturasVectorizeZoom();
      closeComicPalette();
      activeModalId = null;
    }

    modalClose.addEventListener('click', closeAdjustModal);
    modalOverlay.addEventListener('click', function(e){
      if(e.target === modalOverlay) closeAdjustModal();
    });

    /* -------- Selector de categoría, con opción de crear una nueva --------
       Vinculado con el menú de subcategorías de #texturasCategoryWrap: las
       opciones del <select> se generan a partir de esos botones, y crear una
       categoría nueva desde el <select> agrega también su botón al menú. */
    var texturasSubcategoryMenu = document.querySelector('#texturasCategoryWrap > div');

    function syncCategorySelectFromSubcategories(){
      if(!categorySelect || !texturasSubcategoryMenu) return;
      var currentValue = categorySelect.value;
      var newOption = categorySelect.querySelector('option[value="__new__"]');
      Array.prototype.slice.call(categorySelect.querySelectorAll('option')).forEach(function(opt){
        if(opt.value !== '' && opt.value !== '__new__') opt.remove();
      });
      Array.prototype.forEach.call(texturasSubcategoryMenu.querySelectorAll('.subcategory-btn'), function(btn){
        var nombre = btn.dataset.subcategory;
        if(!nombre) return; // se salta el botón "Todas"
        var opt = document.createElement('option');
        opt.value = nombre;
        opt.textContent = nombre;
        categorySelect.insertBefore(opt, newOption);
      });
      var stillExists = Array.prototype.some.call(categorySelect.options, function(opt){
        return opt.value === currentValue;
      });
      categorySelect.value = stillExists ? currentValue : '';
    }
    syncCategorySelectFromSubcategories();

    if(categorySelect){
      categorySelect.addEventListener('change', function(){
        if(categorySelect.value !== '__new__') return;

        var nombre = window.prompt('Nombre de la nueva categoría:');
        // Volvemos al placeholder si se cancela o se deja vacío
        if(!nombre || !nombre.trim()){
          categorySelect.value = '';
          return;
        }
        nombre = nombre.trim();

        // Si ya existe una opción con ese nombre, simplemente la seleccionamos
        var existente = Array.prototype.find.call(categorySelect.options, function(opt){
          return opt.value !== '__new__' && opt.textContent === nombre;
        });
        if(existente){
          categorySelect.value = existente.value;
          return;
        }

        var nuevaOpcion = document.createElement('option');
        nuevaOpcion.value = nombre;
        nuevaOpcion.textContent = nombre;
        // La insertamos justo antes de "+ Crear nueva categoría", que queda al final
        categorySelect.insertBefore(nuevaOpcion, categorySelect.querySelector('option[value="__new__"]'));
        categorySelect.value = nuevaOpcion.value;

        // Agregamos el botón correspondiente al menú de subcategorías de "Texturas",
        // si todavía no existe uno con ese nombre
        if(texturasSubcategoryMenu){
          var yaExisteBtn = Array.prototype.some.call(texturasSubcategoryMenu.querySelectorAll('.subcategory-btn'), function(b){
            return b.dataset.subcategory === nombre;
          });
          if(!yaExisteBtn){
            var nuevoBtn = document.createElement('button');
            nuevoBtn.type = 'button';
            nuevoBtn.className = 'subcategory-btn';
            nuevoBtn.dataset.subcategory = nombre;
            nuevoBtn.textContent = nombre;
            texturasSubcategoryMenu.appendChild(nuevoBtn);
          }
        }
      });
    }

    function refreshModalPreview(){
      if(!activeModalId) return;
      var item = items[activeModalId];
      if(!item) return;
      var img = item.img;
      var w = modalCanvas.width, h = modalCanvas.height;
      var ctx = modalCanvas.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img, 0, 0, w, h);
      var liveTolerance = getToleranceValue();
      removeBackground(ctx, w, h, liveTolerance);
      applyColorOverrides(ctx, w, h, item.colorOverrides, item.palette);
      applyEraseStrokes(ctx, w, h, item.eraseStrokes, item.palette, item.colorOverrides);
    }

    modalApply.addEventListener('click', function(){
      if(!activeModalId) return;
      var item = items[activeModalId];
      item.tolerance = getToleranceValue();
      item.category = (categorySelect && categorySelect.value !== '__new__') ? categorySelect.value : (item.category || '');
      runPipeline(activeModalId);
      renderTextboxesOnCard(activeModalId);
      
      // ══════════════════════════════════════════════════════════════════════
      // GUARDAR TEXTURA EN LOCALSTORAGE
      // ══════════════════════════════════════════════════════════════════════
      try {
        // Obtener el canvas procesado de la textura
        var canvas = modalCanvas;
        if (canvas && canvas.width > 0 && canvas.height > 0) {
          var preview = canvas.toDataURL('image/png');
          
          // Obtener la subcategoría seleccionada
          var subcategoria = (categorySelect && categorySelect.value !== '__new__') ? categorySelect.value : '';
          
          // Guardar textura usando GestorTexturas
          var texturaGuardada = GestorTexturas.guardar({
            nombre: activeModalId || 'Textura sin nombre',
            preview: preview,
            categoria: 'Texturas',
            subcategoria: subcategoria,
            tolerance: item.tolerance || 32
          });
          
          console.log('[Textura Incorporada]', texturaGuardada.nombre, 'v' + texturaGuardada.version, 'subcategoría:', texturaGuardada.subcategoria);
          
          // Mostrar notificación breve (opcional)
          // Puedes agregar una notificación toast aquí si querés
        }
      } catch (err) {
        console.error('[Error al guardar textura]', err);
        if (err.message === 'QUOTA_EXCEEDED') {
          alert('No hay suficiente espacio en el almacenamiento local. Eliminá algunas texturas antiguas.');
        } else if (err.message === 'STORAGE_DISABLED') {
          alert('El almacenamiento local está deshabilitado en tu navegador.');
        }
      }
      // ══════════════════════════════════════════════════════════════════════
      
      closeAdjustModal();
    });

  })();
// ---------- Vista Elementos: grilla de imágenes con recorte de fondo automático, ajuste manual (borrador/color/tolerancia) y cuadros de texto ----------
  (function(){
    'use strict';

    var canvasWrap   = document.getElementById('elementosCanvasWrap');
    var grid         = document.getElementById('elementosGrid');
    var fileInput    = document.getElementById('elementosFileInput');

    // DEBUG: Verificar que los elementos existan
    console.log('[Elementos] canvasWrap:', canvasWrap);
    console.log('[Elementos] grid:', grid);
    console.log('[Elementos] fileInput:', fileInput);
    if(!canvasWrap || !grid || !fileInput) {
      console.error('[Elementos] FALTA algún elemento del DOM - el drag&drop no funcionará');
    }

    var modalOverlay = document.getElementById('vectorizeModalOverlay');
    var modalCanvas  = document.getElementById('vectorizeModalCanvas');
    var modalClose   = document.getElementById('vectorizeModalClose');
    var modalApply   = document.getElementById('vectorizeModalApply');
    var categorySelect = document.getElementById('vectorizeCategorySelect');
    var toleranceVal  = document.getElementById('vectorizeToleranceVal');
    var brushOverlay  = document.getElementById('vectorizeBrushOverlay');
    var brushCursor   = document.getElementById('vectorizeBrushCursor');
    var smoothCheck   = document.getElementById('vectorizeSmoothCheck');

    var toolEraser = document.getElementById('vectorizeToolEraser');
    var toolColorInput = document.getElementById('vectorizeToolColor');
    var toolColorPicker = document.getElementById('vectorizeToolColorPicker');
    var colorEyedropper  = document.getElementById('vectorizeColorEyedropper');
    var colorSwatchTrigger = document.getElementById('vectorizeColorSwatchTrigger');
    var comicPalette = document.getElementById('vectorizeComicPalette');
    var comicPaletteBtns = comicPalette ? comicPalette.querySelectorAll('.vcp-item') : [];
    var comicPaletteTarget = null; // <input type="color"> que va a recibir el valor elegido
    var firstDetectedColorInput = null; // <input> del primer color detectado, sincronizado con #vectorizeColorSwatchTrigger

    /* -------- Paleta estilo cómic (From Uiverse.io by chase2k25): un popover
                único y reutilizable, no atado a ningún "pincel" (ya no
                existe). openComicPalette(anchorEl, targetInput) la ancla
                junto a anchorEl y, al elegir un color, actualiza
                targetInput y dispara su evento 'input' — así se conecta a
                la lógica de selección de color que ya existía en cada
                lugar (el "color actual" del toolbar, o el reemplazo de un
                color detectado), sin duplicar código. -------- */
    if(comicPalette){
      document.body.appendChild(comicPalette); // se independiza del layout de origen para poder anclarse (fixed) a cualquier disparador, en cualquier parte de la pantalla
    }

    function isComicPaletteTrigger(el){
      return !!(el && el.closest && (el.closest('.vcp-trigger') || el.closest('.vectorize-color-swatch')));
    }

    function positionComicPalette(anchorEl){
      if(!comicPalette || !anchorEl) return;
      var rect = anchorEl.getBoundingClientRect();
      var x = Math.max(90, Math.min(window.innerWidth - 90, rect.left + rect.width / 2));
      var y = rect.bottom + 10;
      comicPalette.style.left = x + 'px';
      comicPalette.style.top = y + 'px';
    }

    function closeComicPalette(){
      if(!comicPalette) return;
      comicPalette.classList.remove('open');
      if(colorSwatchTrigger) colorSwatchTrigger.setAttribute('aria-expanded', 'false');
      comicPaletteTarget = null;
    }

    /* Recalcula los 10 colores sugeridos de la paleta cómic a partir de baseHex:
       se mantienen su saturación y luminosidad (la "tonalidad" del color detectado
       de la máscara actual), variando solo el matiz entre ellos, de modo que todos
       combinen visualmente con el color de base en lugar de ser un arcoíris fijo. */
    function updateComicPaletteTones(baseHex){
      if(!comicPaletteBtns || !comicPaletteBtns.length) return;
      var rgb = hexToRgb(baseHex || '#3aa8c9');
      var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      var count = comicPaletteBtns.length;
      comicPaletteBtns.forEach(function(btn, i){
        var h = (hsl.h + (360 / count) * i) % 360;
        var rgbOut = hslToRgb(h, hsl.s, hsl.l);
        var hex = rgbToHex(rgbOut.r, rgbOut.g, rgbOut.b);
        btn.style.setProperty('--color', hex);
        btn.dataset.color = hex;
        btn.setAttribute('aria-color', hex);
      });
    }

    function openComicPalette(anchorEl, targetInput){
      if(!comicPalette || !targetInput) return;
      comicPaletteTarget = targetInput;
      updateComicPaletteTones(targetInput.value);
      positionComicPalette(anchorEl);
      comicPalette.classList.add('open');
      if(colorSwatchTrigger) colorSwatchTrigger.setAttribute('aria-expanded', String(anchorEl === colorSwatchTrigger));
      var currentHex = (targetInput.value || '').toLowerCase();
      comicPaletteBtns.forEach(function(b){
        b.classList.toggle('selected', b.dataset.color.toLowerCase() === currentHex);
      });
    }

    // Preview en vivo: al pasar el mouse por un color de la paleta (sin
    // hacer clic todavia), se aplica ese color al canvas para mostrar como
    // quedaria; al sacar el mouse sin elegir, se restaura el color anterior.
    // Guarda el valor previo a la vista previa mientras el mouse sigue sobre
    // algun cuadradito de la paleta (null = no hay preview activo).
    var vcpPreviewOriginal = null;

    if(comicPalette){
      comicPaletteBtns.forEach(function(btn){
        btn.addEventListener('mouseenter', function(){
          if(comicPaletteTarget !== toolColorInput) return; // preview solo aplica al color de pincel/borrador
          if(vcpPreviewOriginal === null) vcpPreviewOriginal = toolColorInput.value;
          toolColorInput.value = btn.dataset.color;
          toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        });
        btn.addEventListener('mouseleave', function(){
          if(vcpPreviewOriginal === null) return;
          toolColorInput.value = vcpPreviewOriginal;
          toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
          vcpPreviewOriginal = null;
        });
        btn.addEventListener('click', function(){
          if(!comicPaletteTarget) return;
          vcpPreviewOriginal = null; // el color ya quedo elegido: que el mouseleave no lo revierta
          comicPaletteTarget.value = btn.dataset.color;
          comicPaletteTarget.dispatchEvent(new Event('input', { bubbles:true }));
          closeComicPalette();
        });
      });
      document.addEventListener('click', function(e){
        if(!comicPalette.classList.contains('open')) return;
        if(comicPalette.contains(e.target)) return;
        if(isComicPaletteTrigger(e.target)) return;
        closeComicPalette();
      });
    }

    if(toolColorInput && toolColorPicker){
      function paintColorUI(hex){
        toolColorPicker.style.setProperty('--tool-color-current', hex);
      }

      paintColorUI(toolColorInput.value);

      toolColorInput.addEventListener('input', function(){
        paintColorUI(toolColorInput.value);
        // el primer color detectado del panel se mantiene sincronizado con el
        // color del toolbar: se aplica el color elegido tal cual (no una rotación
        // de tono), igual que si el usuario lo hubiera cambiado desde ese swatch
        if(firstDetectedColorInput && firstDetectedColorInput.value !== toolColorInput.value){
          firstDetectedColorInput.value = toolColorInput.value;
          firstDetectedColorInput.dispatchEvent(new Event('input', { bubbles:true }));
        }
      });

      if(colorEyedropper){
        colorEyedropper.addEventListener('click', function(){
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

      if(colorSwatchTrigger && comicPalette){
        colorSwatchTrigger.addEventListener('click', function(e){
          e.stopPropagation();
          if(comicPalette.classList.contains('open') && comicPaletteTarget === toolColorInput){
            closeComicPalette();
          } else {
            openComicPalette(colorSwatchTrigger, toolColorInput);
          }
        });
      }
    }
    var toolUndo   = document.getElementById('vectorizeToolUndo');
    var toolRedo   = document.getElementById('vectorizeToolRedo');
    var modalCanvasWrapEl = document.querySelector('.vectorize-modal-canvaswrap');
    var canvasZoomEl = document.getElementById('vectorizeCanvasZoom');

    /* -------- Deshacer / Rehacer trazos de borrador -------- */
    if(toolUndo){
      toolUndo.addEventListener('click', function(){
        if(!activeModalId) return;
        var item = items[activeModalId];
        if(!item || !item.eraseStrokes.length) return;
        item.eraseRedoStack.push(item.eraseStrokes.pop());
        refreshModalPreview();
      });
    }
    if(toolRedo){
      toolRedo.addEventListener('click', function(){
        if(!activeModalId) return;
        var item = items[activeModalId];
        if(!item || !item.eraseRedoStack.length) return;
        item.eraseStrokes.push(item.eraseRedoStack.pop());
        refreshModalPreview();
      });
    }

    /* -------- Líneas guía de alineación (centrado + distancia entre cuadros) -------- */
    var alignGuidesEl = document.createElement('div');
    alignGuidesEl.className = 'vectorize-align-guides';
    alignGuidesEl.id = 'vectorizeAlignGuides';
    canvasZoomEl.appendChild(alignGuidesEl);

    var GUIDE_SNAP_PCT = 0.6; /* umbral de imán, en % del ancho/alto del canvas */

    function clearAlignGuides(){
      alignGuidesEl.innerHTML = '';
    }

    function addGuideLine(type, posPct){
      var line = document.createElement('div');
      line.className = 'vectorize-guide-line visible ' + type;
      if(type === 'v'){ line.style.left = posPct + '%'; }
      else { line.style.top = posPct + '%'; }
      alignGuidesEl.appendChild(line);
    }

    function addGuideGap(type, aPct, bPct, crossPct, label){
      var gap = document.createElement('div');
      gap.className = 'vectorize-guide-gap visible ' + type;
      if(type === 'horiz'){
        gap.style.left = Math.min(aPct,bPct) + '%';
        gap.style.width = Math.abs(bPct-aPct) + '%';
        gap.style.top = crossPct + '%';
      } else {
        gap.style.top = Math.min(aPct,bPct) + '%';
        gap.style.height = Math.abs(bPct-aPct) + '%';
        gap.style.left = crossPct + '%';
      }
      var lbl = document.createElement('span');
      lbl.className = 'vectorize-guide-gap-label';
      lbl.textContent = label;
      gap.appendChild(lbl);
      alignGuidesEl.appendChild(gap);
    }

    /* Calcula, para el cuadro activo (con su x/y/w/h en % propuestos), a qué otros
       cuadros (o al centro del canvas) se puede "imantar" y devuelve la posición
       final ajustada más las líneas/guías que corresponda dibujar. */
    function computeAlignSnap(id, instId, xPct, yPct, wPct, hPct){
      var item = items[id];
      var others = (item && item.textboxes ? item.textboxes : []).filter(function(t){ return t.instId !== instId; });

      var myLeft = xPct, myRight = xPct + wPct, myCx = xPct + wPct/2;
      var myTop = yPct, myBottom = yPct + hPct, myCy = yPct + hPct/2;

      var vTargets = [{ v:50, key:'cx' }];   /* centro horizontal del canvas */
      var hTargets = [{ v:50, key:'cy' }];   /* centro vertical del canvas */

      others.forEach(function(t){
        var l = t.xPct, r = t.xPct + t.wPct, cx = t.xPct + t.wPct/2;
        var tp = t.yPct, bt = t.yPct + t.hPct, cy = t.yPct + t.hPct/2;
        vTargets.push({ v:l, key:'left' }, { v:r, key:'right' }, { v:cx, key:'cx' });
        hTargets.push({ v:tp, key:'top' }, { v:bt, key:'bottom' }, { v:cy, key:'cy' });
      });

      var lines = [];
      var dx = 0, dy = 0;
      var bestV = null, bestH = null;

      [{ pos:myLeft, key:'left' }, { pos:myCx, key:'cx' }, { pos:myRight, key:'right' }].forEach(function(mine){
        vTargets.forEach(function(t){
          var diff = Math.abs(mine.pos - t.v);
          if(diff <= GUIDE_SNAP_PCT && (!bestV || diff < bestV.diff)){
            bestV = { diff:diff, target:t.v, delta:t.v - mine.pos };
          }
        });
      });
      [{ pos:myTop, key:'top' }, { pos:myCy, key:'cy' }, { pos:myBottom, key:'bottom' }].forEach(function(mine){
        hTargets.forEach(function(t){
          var diff = Math.abs(mine.pos - t.v);
          if(diff <= GUIDE_SNAP_PCT && (!bestH || diff < bestH.diff)){
            bestH = { diff:diff, target:t.v, delta:t.v - mine.pos };
          }
        });
      });

      if(bestV){ dx = bestV.delta; }
      if(bestH){ dy = bestH.delta; }

      var newX = xPct + dx, newY = yPct + dy;
      var newLeft = newX, newRight = newX + wPct, newCx = newX + wPct/2;
      var newTop = newY, newBottom = newY + hPct, newCy = newY + hPct/2;

      clearAlignGuides();
      if(bestV){ addGuideLine('v', bestV.target); }
      if(bestH){ addGuideLine('h', bestH.target); }

      /* -------- Distribución: si el cuadro queda a igual distancia de sus dos
                  vecinos más cercanos (izq/der o arriba/abajo), lo marcamos -------- */
      var leftNeighbors = others.filter(function(t){ return (t.xPct + t.wPct) <= newLeft + 0.3; })
        .sort(function(a,b){ return (newLeft-(a.xPct+a.wPct)) - (newLeft-(b.xPct+b.wPct)); });
      var rightNeighbors = others.filter(function(t){ return t.xPct >= newRight - 0.3; })
        .sort(function(a,b){ return (a.xPct-newRight) - (b.xPct-newRight); });

      if(leftNeighbors.length && rightNeighbors.length){
        var gapL = newLeft - (leftNeighbors[0].xPct + leftNeighbors[0].wPct);
        var gapR = rightNeighbors[0].xPct - newRight;
        if(gapL > 0 && gapR > 0 && Math.abs(gapL-gapR) <= GUIDE_SNAP_PCT){
          var crossY = newCy;
          addGuideGap('horiz', leftNeighbors[0].xPct + leftNeighbors[0].wPct, newLeft, crossY, Math.round(gapL) + '%');
          addGuideGap('horiz', newRight, rightNeighbors[0].xPct, crossY, Math.round(gapR) + '%');
        }
      }

      var topNeighbors = others.filter(function(t){ return (t.yPct + t.hPct) <= newTop + 0.3; })
        .sort(function(a,b){ return (newTop-(a.yPct+a.hPct)) - (newTop-(b.yPct+b.hPct)); });
      var bottomNeighbors = others.filter(function(t){ return t.yPct >= newBottom - 0.3; })
        .sort(function(a,b){ return (a.yPct-newBottom) - (b.yPct-newBottom); });

      if(topNeighbors.length && bottomNeighbors.length){
        var gapT = newTop - (topNeighbors[0].yPct + topNeighbors[0].hPct);
        var gapB = bottomNeighbors[0].yPct - newBottom;
        if(gapT > 0 && gapB > 0 && Math.abs(gapT-gapB) <= GUIDE_SNAP_PCT){
          var crossX = newCx;
          addGuideGap('vert', topNeighbors[0].yPct + topNeighbors[0].hPct, newTop, crossX, Math.round(gapT) + '%');
          addGuideGap('vert', newBottom, bottomNeighbors[0].yPct, crossX, Math.round(gapB) + '%');
        }
      }

      return { xPct:newX, yPct:newY };
    }

    /* -------- Biblioteca de plantillas de "Cuadros de Textos": cada una es una
                composición SVG real (no un simple número) que se puede insertar
                sobre el elemento, con su propia forma decorativa. -------- */
    var TEXTBOX_TEMPLATES = [
      { id:'edad', label:'Edad', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'nombre', label:'Nombre', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'foto', label:'Foto', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'gracias', label:'¡Gracias por Venir!', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'bienvenidos', label:'¡Bienvenidos!', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' },
      { id:'letra', label:'Letra', viewBox:'0 0 220 70',
        shape:'<rect x="4" y="4" width="212" height="62" rx="6"/>' }
    ];
    var TEXTBOX_TEMPLATES_BY_ID = {};
    TEXTBOX_TEMPLATES.forEach(function(t){ TEXTBOX_TEMPLATES_BY_ID[t.id] = t; });
    var tbSeq = 0;

    /* -------- Barra de herramientas: pincel / borrador (excluyentes, y
                desactivables: por defecto ninguna está activa; un clic
                selecciona la herramienta, y volver a clickearla la apaga) -------- */
    /* -------- Barra de herramientas: el pincel es el modo por defecto
                (el color lo controla el regulador/gotero); el borrador es
                un toggle: activado = borra, desactivado = pinta -------- */
    if(toolEraser){
      toolEraser.addEventListener('click', function(){
        var wasActive = toolEraser.classList.contains('active');
        toolEraser.classList.toggle('active', !wasActive);
        toolEraser.setAttribute('aria-pressed', String(!wasActive));
        if(window.__syncVectorizeEraserCursor) window.__syncVectorizeEraserCursor();
      });
    }

    /* El único modo de dibujo disponible ahora es el borrador: ya no se usa
       un "pincel" de pintado, así que sin el borrador activo el mouse no
       traza nada (ni se muestra el círculo guía) sobre el canvas. */
    function activeBrushTool(){
      if(toolEraser && toolEraser.classList.contains('active')) return 'eraser';
      return null;
    }

    /* -------- Valor de tolerancia "scrubbable": se ajusta arrastrando el
                número con el mouse en lugar de un slider -------- */
    var TOLERANCE_MIN = parseInt(toleranceVal.dataset.min, 10) || 2;
    var TOLERANCE_MAX = parseInt(toleranceVal.dataset.max, 10) || 120;

    function getToleranceValue(){
      return parseInt(toleranceVal.dataset.value, 10) || TOLERANCE_MIN;
    }

    function setToleranceValue(v, silent){
      v = Math.max(TOLERANCE_MIN, Math.min(TOLERANCE_MAX, Math.round(v)));
      toleranceVal.dataset.value = v;
      toleranceVal.textContent = v;
      toleranceVal.setAttribute('aria-valuenow', v);
      if(!silent) refreshModalPreview();
    }

    (function(){
      var dragging = false;
      var startX = 0;
      var startValue = 0;
      var SENSITIVITY = 0.6; // px de mouse por unidad de tolerancia

      function onPointerMove(e){
        if(!dragging) return;
        var dx = e.clientX - startX;
        setToleranceValue(startValue + dx * SENSITIVITY);
      }
      function onPointerUp(){
        if(!dragging) return;
        dragging = false;
        toleranceVal.classList.remove('is-scrubbing');
        document.removeEventListener('mousemove', onPointerMove);
        document.removeEventListener('mouseup', onPointerUp);
      }

      toleranceVal.addEventListener('mousedown', function(e){
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startValue = getToleranceValue();
        toleranceVal.classList.add('is-scrubbing');
        document.addEventListener('mousemove', onPointerMove);
        document.addEventListener('mouseup', onPointerUp);
      });

      // Accesibilidad: también se puede ajustar con las flechas del teclado
      toleranceVal.addEventListener('keydown', function(e){
        if(e.key === 'ArrowRight' || e.key === 'ArrowUp'){
          e.preventDefault();
          setToleranceValue(getToleranceValue() + 1);
        } else if(e.key === 'ArrowLeft' || e.key === 'ArrowDown'){
          e.preventDefault();
          setToleranceValue(getToleranceValue() - 1);
        }
      });
    })();

    /* -------- Borrador real: mientras está activo, el círculo guía sigue al
                mouse y, al arrastrar, borra de verdad los píxeles del canvas
                (deja transparencia), en vez de solo pintar una máscara que se
                desvanecía sin dejar cambios. El trazo se guarda en % del
                ancho/alto del elemento para poder reaplicarlo siempre que se
                redibuje la imagen (cambio de tolerancia, de color, o al
                incorporar el ajuste final). -------- */
    (function(){
      var isStroking = false;
      var lastPt = null;
      var currentStroke = null;
      var ERASER_RADIUS_DISPLAY = 24; // radio visual del borrador, en px de pantalla

      function syncOverlaySize(){
        // ya no se usa un canvas de overlay separado: el borrador dibuja
        // directo sobre modalCanvas. Se mantiene esta función (llamada al
        // abrir el modal / redimensionar) sólo para refrescar el cursor.
        syncCursorVisibility();
      }
      window.__syncVectorizeBrushOverlay = syncOverlaySize;
      window.__syncVectorizeEraserCursor = syncCursorVisibility;

      function canvasPointFromEvent(e){
        var rect = modalCanvas.getBoundingClientRect();
        var scaleX = modalCanvas.width / rect.width;
        var scaleY = modalCanvas.height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
          scaleX: scaleX
        };
      }

      function eraseAt(ctx, pt, radiusCanvasPx){
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radiusCanvasPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      function eraseSegment(ctx, p1, p2, radiusCanvasPx){
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.lineWidth = radiusCanvasPx * 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.restore();
      }

      function updateCursorPosition(e){
        if(!brushCursor || !modalCanvasWrapEl) return;
        var wrapRect = modalCanvasWrapEl.getBoundingClientRect();
        brushCursor.style.left = (e.clientX - wrapRect.left) + 'px';
        brushCursor.style.top  = (e.clientY - wrapRect.top) + 'px';
      }

      function showCursor(){
        if(!brushCursor) return;
        if(activeBrushTool() !== 'eraser'){ hideCursor(); return; }
        brushCursor.classList.add('tool-eraser');
        brushCursor.classList.add('visible');
      }

      function hideCursor(){
        if(brushCursor) brushCursor.classList.remove('visible');
      }

      // Al activar/desactivar el borrador (sin mover el mouse) el cursor
      // debe aparecer/ocultarse igual; usamos la última posición conocida.
      var lastClientEvt = null;
      function syncCursorVisibility(){
        if(activeBrushTool() === 'eraser' && lastClientEvt){
          updateCursorPosition(lastClientEvt);
          showCursor();
        } else {
          hideCursor();
        }
      }

      function endStroke(){
        if(!isStroking) return;
        isStroking = false;
        lastPt = null;
        if(currentStroke && activeModalId){
          var item = items[activeModalId];
          if(item){
            item.eraseStrokes.push(currentStroke);
            item.eraseRedoStack.length = 0; // un trazo nuevo invalida el "rehacer"
          }
        }
        currentStroke = null;
      }

      if(modalCanvasWrapEl){
        modalCanvasWrapEl.addEventListener('mouseenter', function(e){
          lastClientEvt = e;
          updateCursorPosition(e);
          showCursor();
        });
        modalCanvasWrapEl.addEventListener('mousemove', function(e){
          lastClientEvt = e;
          updateCursorPosition(e);
          showCursor();
          if(isStroking){
            var pt = canvasPointFromEvent(e);
            var radiusPx = ERASER_RADIUS_DISPLAY * pt.scaleX;
            var ctx = modalCanvas.getContext('2d');
            if(lastPt) eraseSegment(ctx, lastPt, pt, radiusPx); else eraseAt(ctx, pt, radiusPx);
            if(currentStroke){
              currentStroke.points.push({ xPct: pt.x / modalCanvas.width * 100, yPct: pt.y / modalCanvas.height * 100 });
            }
            lastPt = pt;
          }
        });
        modalCanvasWrapEl.addEventListener('mouseleave', function(){
          hideCursor();
          endStroke();
        });
        modalCanvasWrapEl.addEventListener('mousedown', function(e){
          if(e.button !== 0) return;
          if(activeBrushTool() !== 'eraser') return; // sin el borrador activo, el mouse no borra nada
          isStroking = true;
          lastPt = null;
          var pt = canvasPointFromEvent(e);
          var radiusPx = ERASER_RADIUS_DISPLAY * pt.scaleX;
          var radiusPct = radiusPx / modalCanvas.width * 100;
          currentStroke = { rPct: radiusPct, points: [{ xPct: pt.x / modalCanvas.width * 100, yPct: pt.y / modalCanvas.height * 100 }] };
          var ctx = modalCanvas.getContext('2d');
          eraseAt(ctx, pt, radiusPx);
          lastPt = pt;
        });
        document.addEventListener('mouseup', endStroke);
      }
    })();

    /* -------- Zoom con la rueda del mouse, centrado en el puntero.
                No cambia el tamaño del contenedor (overflow:hidden), sólo
                escala visualmente el contenido (canvas + trazo + cuadros
                de texto) mediante transform. Reemplaza el comportamiento
                de "encoger el pincel" con la rueda: acá la rueda hace zoom. -------- */
    var zoomScale = 1;
    var zoomPanX = 0;
    var zoomPanY = 0;
    var ZOOM_MIN = 1;
    var ZOOM_MAX = 6;

    function applyZoomTransform(){
      if(!canvasZoomEl) return;
      canvasZoomEl.style.transform = 'translate(' + zoomPanX + 'px,' + zoomPanY + 'px) scale(' + zoomScale + ')';
    }

    function resetZoom(){
      zoomScale = 1;
      zoomPanX = 0;
      zoomPanY = 0;
      applyZoomTransform();
    }
    window.__resetVectorizeZoom = resetZoom;

    if(modalCanvasWrapEl && canvasZoomEl){
      modalCanvasWrapEl.addEventListener('wheel', function(e){
        e.preventDefault();

        var wrapRect = modalCanvasWrapEl.getBoundingClientRect();
        var mouseX = e.clientX - wrapRect.left;
        var mouseY = e.clientY - wrapRect.top;

        var oldScale = zoomScale;
        var zoomFactor = Math.exp(-e.deltaY * 0.0015);
        var newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, oldScale * zoomFactor));
        if(newScale === oldScale) return;

        // punto del contenido que está bajo el mouse, antes de aplicar el nuevo zoom
        var contentX = (mouseX - zoomPanX) / oldScale;
        var contentY = (mouseY - zoomPanY) / oldScale;

        zoomScale = newScale;
        zoomPanX = mouseX - contentX * zoomScale;
        zoomPanY = mouseY - contentY * zoomScale;

        if(zoomScale <= ZOOM_MIN){
          // vuelve a encajar exactamente en el contenedor, sin desplazamiento
          zoomScale = ZOOM_MIN;
          zoomPanX = 0;
          zoomPanY = 0;
        }
        applyZoomTransform();
      }, { passive: false });
    }

    var items = {};   // id -> { img, tolerance, cardEl }
    var itemSeq = 0;
    var activeModalId = null;
    var pendingStarts = {}; // id -> timestamp de inicio del loader, para la duración mínima de 1s

    /* -------- Markup del loader animado: solo el helado con desvanecido, sin texto -------- */
    function loadingHTML(){
      return '' +
        '<div class="elementos-loading">' +
          '<div class="elementos-loading-pop"></div>' +
        '</div>';
    }

    /* -------- Duración mínima visible del loader, para que la animación
                no "parpadee" cuando el procesamiento es muy rápido -------- */
    var MIN_LOADING_MS = 1000;
    function afterMinDuration(startTime, fn){
      var wait = MIN_LOADING_MS - (Date.now() - startTime);
      if(wait > 0) setTimeout(fn, wait); else fn();
    }

    function refreshHasImage(canvasWrapEl, gridEl){
      var has = gridEl.children.length > 0;
      canvasWrapEl.classList.toggle('has-image', has);
    }

    /* -------- Conecta una grilla de subida de imágenes (click / arrastrar y
                soltar / pegado, recorte automático de fondo, vectorizado y
                modal de ajuste manual) al mismo modal compartido de la Vista
                Elementos. Así se puede reutilizar toda esa funcionalidad en
                otros paneles (p.ej. "Personajes" de la Vista Temáticas) sin
                duplicar el modal ni la lógica de procesamiento. -------- */
    function attachUploadGrid(canvasWrapEl, gridEl, fileInputEl, extraCardClass){
      console.log('[attachUploadGrid] Inicializando con:', { canvasWrapEl, gridEl, fileInputEl, extraCardClass });
      if(!canvasWrapEl || !gridEl || !fileInputEl) {
        console.error('[attachUploadGrid] FALTA algún elemento - abortando inicialización');
        return;
      }
      console.log('[attachUploadGrid] ✅ Todos los elementos presentes - registrando listeners');

      /* -------- Click / drag & drop para abrir el selector de archivos -------- */
      canvasWrapEl.addEventListener('click', function(e){
        console.log('[attachUploadGrid] Click detectado en canvasWrap');
        if(e.target.closest('.elementos-upload-card')) {
          console.log('[attachUploadGrid] Click en tarjeta - ignorado');
          return;
        }
        console.log('[attachUploadGrid] Abriendo selector de archivos');
        fileInputEl.click();
      });

      fileInputEl.addEventListener('click', function(e){ e.stopPropagation(); });

      fileInputEl.addEventListener('change', function(){
        console.log('[attachUploadGrid] Change en fileInput - archivos:', fileInputEl.files.length);
        handleFiles(fileInputEl.files);
        fileInputEl.value = '';
      });

      ['dragenter','dragover'].forEach(function(evt){
        canvasWrapEl.addEventListener(evt, function(e){
          console.log('[attachUploadGrid] ' + evt + ' detectado');
          e.preventDefault(); e.stopPropagation();
          canvasWrapEl.classList.add('drag-over');
        });
      });
      ['dragleave','dragend'].forEach(function(evt){
        canvasWrapEl.addEventListener(evt, function(e){
          console.log('[attachUploadGrid] ' + evt + ' detectado');
          if(evt === 'dragleave' && canvasWrapEl.contains(e.relatedTarget)) return;
          canvasWrapEl.classList.remove('drag-over');
        });
      });
      canvasWrapEl.addEventListener('drop', function(e){
        console.log('[attachUploadGrid] DROP detectado!', e.dataTransfer);
        e.preventDefault(); e.stopPropagation();
        canvasWrapEl.classList.remove('drag-over');
        if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length){
          console.log('[attachUploadGrid] Archivos en drop:', e.dataTransfer.files.length);
          handleFiles(e.dataTransfer.files);
        } else {
          console.error('[attachUploadGrid] No se encontraron archivos en el drop');
        }
      });

      function handleFiles(fileList){
        console.log('[attachUploadGrid] handleFiles llamado con', fileList.length, 'archivos');
        Array.prototype.forEach.call(fileList, function(file){
          console.log('[attachUploadGrid] Procesando archivo:', file.name, file.type);
          if(!/^image\//.test(file.type)) {
            console.warn('[attachUploadGrid] No es imagen - ignorado:', file.name);
            return;
          }
          console.log('[attachUploadGrid] Imagen válida - agregando:', file.name);
          addElementFromFile(file);
        });
      }

      /* -------- Pegar imagen desde el portapapeles (Ctrl+V / Cmd+V), sólo
                  cuando esta grilla es la que está visible en pantalla -------- */
      document.addEventListener('paste', function(e){
        // Si el modal de ajuste está abierto, no interferir con lo que se esté haciendo ahí
        if(modalOverlay.classList.contains('open')) return;
        // Si esta grilla no está visible (otra vista/panel activo), no interceptar el pegado
        if(!canvasWrapEl.offsetParent) return;
        // No interferir si se está pegando texto dentro de un input/textarea editable
        var active = document.activeElement;
        if(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

        var clipboardItems = (e.clipboardData || window.clipboardData) ? (e.clipboardData || window.clipboardData).items : null;
        if(!clipboardItems) return;

        var imageFiles = [];
        Array.prototype.forEach.call(clipboardItems, function(item){
          if(item.kind === 'file' && /^image\//.test(item.type)){
            var file = item.getAsFile();
            if(file) imageFiles.push(file);
          }
        });

        if(imageFiles.length){
          e.preventDefault();
          handleFiles(imageFiles);
        }
      });

      /* -------- Al clickear el elemento (SVG generado o imagen de respaldo)
                  se abre el modal de ajuste de recorte -------- */
      gridEl.addEventListener('click', function(e){
        if(e.target.closest('.elementos-upload-remove')) return;
        var card = e.target.closest('.elementos-upload-card');
        if(!card) return;
        var id = card.dataset.id;
        var item = items[id];
        if(!item) return;
        e.stopPropagation();
        openAdjustModal(id);
      });

      /* -------- Crear la tarjeta y procesar la imagen -------- */
      function addElementFromFile(file){
        var id = 'el' + (++itemSeq);
        pendingStarts[id] = Date.now();
        var card = document.createElement('div');
        card.className = 'elementos-upload-card' + (extraCardClass ? ' ' + extraCardClass : '');
        card.dataset.id = id;
        card.innerHTML =
          '<div class="elementos-upload-svgwrap">' + loadingHTML() + '</div>' +
          '<div class="elementos-textboxes-layer"></div>' +
          '<button type="button" class="elementos-upload-remove" title="Quitar">×</button>';
        gridEl.appendChild(card);
        refreshHasImage(canvasWrapEl, gridEl);

        card.querySelector('.elementos-upload-remove').addEventListener('click', function(e){
          e.stopPropagation();
          var wrapEl = card.querySelector('.elementos-upload-svgwrap');
          if(svgResizeObserver && wrapEl) svgResizeObserver.unobserve(wrapEl);
          card.remove();
          delete items[id];
          delete pendingStarts[id];
          refreshHasImage(canvasWrapEl, gridEl);
        });

        var reader = new FileReader();
        reader.onload = function(ev){
          var img = new Image();
          img.onload = function(){
            items[id] = { img: img, tolerance: 32, cardEl: card, textboxes: [], eraseStrokes: [], eraseRedoStack: [] };
            runPipeline(id);
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      }
    }

    attachUploadGrid(canvasWrap, grid, fileInput, '');

    // Reutiliza toda la Vista Elementos (subida, recorte automático de fondo,
    // vectorizado y modal de ajuste manual con borrador/color/tolerancia/
    // cuadros de texto) para la grilla de "Personajes" de la Vista Temáticas,
    // usando el mismo modal compartido de arriba.
    attachUploadGrid(
      document.getElementById('tematicasPersonajesGrid'),
      document.getElementById('tematicasPersonajesCards'),
      document.getElementById('tematicasPersonajesFileInput'),
      'sp2-personajes-card'
    );

    // Misma lógica de subida/recorte/vectorizado para la sección "Personajes"
    // del panel lateral de Plantillas (#side-panel-2).
    attachUploadGrid(
      document.getElementById('sp2PersonajesGrid'),
      document.getElementById('sp2PersonajesCards'),
      document.getElementById('sp2PersonajesFileInput'),
      'sp2-personajes-card'
    );

    /* -------- Quitar fondo: flood fill conectado desde los bordes, usando como
                referencia el color más frecuente del perímetro. 100% automático,
                sin selección manual de color. -------- */
    function removeBackground(ctx, width, height, tolerance){
      var imgData = ctx.getImageData(0, 0, width, height);
      var data = imgData.data;

      // color más frecuente del perímetro completo como referencia (más robusto
      // que solo 4 esquinas, que pueden caer justo sobre un artefacto de
      // compresión o antialiasing)
      var freq = {};
      var bestKey = null, bestCount = 0;
      function sampleBorderPixel(x, y){
        var i = (y*width + x) * 4;
        var qr = data[i] >> 3, qg = data[i+1] >> 3, qb = data[i+2] >> 3; // cuantizado para agrupar tonos parecidos
        var key = qr + '_' + qg + '_' + qb;
        if(!freq[key]) freq[key] = { count:0, r:0, g:0, b:0 };
        var f = freq[key];
        f.count++; f.r += data[i]; f.g += data[i+1]; f.b += data[i+2];
        if(f.count > bestCount){
          bestCount = f.count;
          bestKey = key;
        }
      }
      for(var bx=0; bx<width; bx++){ sampleBorderPixel(bx, 0); sampleBorderPixel(bx, height-1); }
      for(var by=0; by<height; by++){ sampleBorderPixel(0, by); sampleBorderPixel(width-1, by); }
      var winner = freq[bestKey];
      var refColor = [winner.r/winner.count, winner.g/winner.count, winner.b/winner.count];

      function matchesTarget(px){
        var dr = data[px]-refColor[0], dg = data[px+1]-refColor[1], db = data[px+2]-refColor[2];
        return Math.sqrt(dr*dr+dg*dg+db*db) <= tolerance;
      }

      var visited = new Uint8Array(width*height);
      var stack = [];
      function idx(x,y){ return y*width+x; }
      for(var x=0;x<width;x++){ stack.push(idx(x,0)); stack.push(idx(x,height-1)); }
      for(var y=0;y<height;y++){ stack.push(idx(0,y)); stack.push(idx(width-1,y)); }

      while(stack.length){
        var i = stack.pop();
        if(visited[i]) continue;
        visited[i] = 1;
        var px = i*4;
        if(matchesTarget(px)){
          data[px+3] = 0;
          var x0 = i % width, y0 = (i / width) | 0;
          if(x0>0) stack.push(idx(x0-1,y0));
          if(x0<width-1) stack.push(idx(x0+1,y0));
          if(y0>0) stack.push(idx(x0,y0-1));
          if(y0<height-1) stack.push(idx(x0,y0+1));
        }
      }
      ctx.putImageData(imgData, 0, 0);
      erodeEdges(ctx, width, height, 1);
    }

    /* -------- Erosiona 'n' píxeles el borde de la figura para comerse el halo
                de color mezclado que deja el anti-aliasing original -------- */
    function erodeEdges(ctx, width, height, iterations){
      for(var it=0; it<iterations; it++){
        var imgData = ctx.getImageData(0, 0, width, height);
        var data = imgData.data;
        var toKill = [];
        for(var y=0; y<height; y++){
          for(var x=0; x<width; x++){
            var i = (y*width + x);
            if(data[i*4+3] === 0) continue; // ya es transparente
            // si algún vecino directo es transparente, este píxel es borde -> lo comemos
            var neighborTransparent =
              (x>0 && data[(i-1)*4+3] === 0) ||
              (x<width-1 && data[(i+1)*4+3] === 0) ||
              (y>0 && data[(i-width)*4+3] === 0) ||
              (y<height-1 && data[(i+width)*4+3] === 0);
            if(neighborTransparent) toKill.push(i);
          }
        }
        toKill.forEach(function(i){ data[i*4+3] = 0; });
        ctx.putImageData(imgData, 0, 0);
      }
    }

    /* -------- Pipeline: quitar fondo + vectorizar a SVG -------- */
    function runPipeline(id){
      var item = items[id];
      if(!item) return;
      var img = item.img;
      var MAXDIM = 900;
      var scale = Math.min(1, MAXDIM / Math.max(img.naturalWidth, img.naturalHeight));
      var w = Math.max(1, Math.round(img.naturalWidth * scale));
      var h = Math.max(1, Math.round(img.naturalHeight * scale));

      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);

      removeBackground(ctx, w, h, item.tolerance);
      applyColorOverrides(ctx, w, h, item.colorOverrides, item.palette);
      applyEraseStrokes(ctx, w, h, item.eraseStrokes);

      // el loader se muestra desde que se agregó el archivo (o desde ahora, si
      // se vuelve a correr el pipeline al "Incorporar" un ajuste manual)
      var startTime = pendingStarts[id] || Date.now();
      delete pendingStarts[id];

      var wrap = item.cardEl.querySelector('.elementos-upload-svgwrap');
      wrap.style.display = '';
      wrap.style.fontSize = '';
      wrap.style.color = '';
      wrap.innerHTML = loadingHTML();

      var pngDataUrl = canvas.toDataURL('image/png');

      var options = {
        ltres: 1, qtres: 1, pathomit: 20,
        blurradius: smoothCheck && smoothCheck.checked ? 1 : 0,
        blurdelta: 20,
        strokewidth: 0,
        numberofcolors: 12,
        colorsampling: 1,
        mincolorratio: 0,
        scale: 1,
        roundcoords: 1,
        viewbox: true,
        desc: false
      };

      try{
        ImageTracer.imageToSVG(pngDataUrl, function(svgstr){
          afterMinDuration(startTime, function(){
            wrap.innerHTML = svgstr;
            fitSvgToContainer(wrap);
          });
        }, options);
      }catch(err){
        // fallback: si algo falla en la vectorización, mostramos el PNG sin fondo
        afterMinDuration(startTime, function(){
          wrap.innerHTML = '';
          var fallbackImg = document.createElement('img');
          fallbackImg.src = pngDataUrl;
          wrap.appendChild(fallbackImg);
        });
      }
    }

    /* -------- Hace que el svg mida el espacio real disponible en su contenedor
                y se ajuste cada vez que ese espacio cambia (resize, layout, etc.) -------- */
    var svgResizeObserver = ('ResizeObserver' in window) ? new ResizeObserver(function(entries){
      entries.forEach(function(entry){
        var el = entry.target;
        var svg = el.querySelector(':scope > svg');
        if(!svg) return;
        var rect = entry.contentRect;
        var w = Math.max(1, Math.round(rect.width));
        var h = Math.max(1, Math.round(rect.height));
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
      });
    }) : null;

    function fitSvgToContainer(wrapEl){
      var svg = wrapEl.querySelector(':scope > svg');
      if(!svg) return;
      // medición inmediata (por si el ResizeObserver tarda un frame)
      var rect = wrapEl.getBoundingClientRect();
      if(rect.width > 0 && rect.height > 0){
        svg.setAttribute('width', Math.round(rect.width));
        svg.setAttribute('height', Math.round(rect.height));
      }
      if(svgResizeObserver) svgResizeObserver.observe(wrapEl);
    }

    /* -------- Cuadros de Textos: picker con miniaturas reales de cada plantilla -------- */
    var textboxesGrid = document.getElementById('vectorizeTextboxesGrid');
    var colorsGrid = document.getElementById('vectorizeColorsGrid');
    var COLOR_QUANT_STEP = 24; /* agrupa tonos cercanos como "el mismo color" */

    function quantKey(r, g, b){
      var s = COLOR_QUANT_STEP;
      return Math.round(r/s)*s + ',' + Math.round(g/s)*s + ',' + Math.round(b/s)*s;
    }
    function rgbToHex(r, g, b){
      function h(n){ n = Math.max(0, Math.min(255, Math.round(n))); var s = n.toString(16); return s.length < 2 ? '0'+s : s; }
      return '#' + h(r) + h(g) + h(b);
    }
    function hexToRgb(hex){
      hex = hex.replace('#','');
      return {
        r: parseInt(hex.substring(0,2), 16),
        g: parseInt(hex.substring(2,4), 16),
        b: parseInt(hex.substring(4,6), 16)
      };
    }
    function rgbToHsl(r, g, b){
      r/=255; g/=255; b/=255;
      var max = Math.max(r,g,b), min = Math.min(r,g,b);
      var l = (max+min)/2, d = max-min, h = 0, s = 0;
      if(d !== 0){
        s = d / (1 - Math.abs(2*l - 1));
        switch(max){
          case r: h = 60 * (((g-b)/d) % 6); break;
          case g: h = 60 * ((b-r)/d + 2); break;
          case b: h = 60 * ((r-g)/d + 4); break;
        }
        if(h < 0) h += 360;
      }
      return { h:h, s:s, l:l };
    }
    function hslToRgb(h, s, l){
      var c = (1 - Math.abs(2*l - 1)) * s;
      var x = c * (1 - Math.abs((h/60) % 2 - 1));
      var m = l - c/2;
      var r=0, g=0, b=0;
      if(h < 60){ r=c; g=x; b=0; }
      else if(h < 120){ r=x; g=c; b=0; }
      else if(h < 180){ r=0; g=c; b=x; }
      else if(h < 240){ r=0; g=x; b=c; }
      else if(h < 300){ r=x; g=0; b=c; }
      else { r=c; g=0; b=x; }
      return { r:(r+m)*255, g:(g+m)*255, b:(b+m)*255 };
    }

    /* Recorre los píxeles y agrupa por color cuantizado; devuelve los N colores
       más frecuentes (ignorando los que son casi transparentes). */
    function extractPalette(ctx, w, h, maxColors){
      var data = ctx.getImageData(0, 0, w, h).data;
      var buckets = {};
      var totalOpaque = 0;
      for(var i = 0; i < data.length; i += 4){
        var a = data[i+3];
        if(a < 20) continue;
        totalOpaque++;
        var r = data[i], g = data[i+1], b = data[i+2];
        var key = quantKey(r, g, b);
        var bucket = buckets[key];
        if(!bucket){ bucket = buckets[key] = { r:0, g:0, b:0, count:0 }; }
        bucket.r += r; bucket.g += g; bucket.b += b; bucket.count++;
      }
      var list = Object.keys(buckets).map(function(key){
        var bkt = buckets[key];
        return { key:key, count:bkt.count, r: bkt.r/bkt.count, g: bkt.g/bkt.count, b: bkt.b/bkt.count };
      });
      list.sort(function(a,b){ return b.count - a.count; });
      var shown = list.slice(0, maxColors);
      var shownCount = shown.reduce(function(sum, c){ return sum + c.count; }, 0);
      return {
        colors: shown,
        totalOpaque: totalOpaque,
        leftoverBuckets: list.length - shown.length,
        leftoverPixelsPct: totalOpaque ? Math.round((1 - shownCount / totalOpaque) * 100) : 0
      };
    }

    /* Aplica los cambios de color guardados. Para cada píxel opaco busca, entre los
       colores detectados (palette), cuál es el más parecido en color real (distancia
       RGB) — no por bucket exacto ni por tono — y si ese color tiene un cambio
       guardado, lo aplica. Así, los tonos "de sobra" que no tienen su propio cuadrado
       en la grilla también se mueven junto con el color detectado al que más se
       parecen. */
    function applyColorOverrides(ctx, w, h, overrides, palette){
      if(!overrides || !palette || !palette.length) return;
      var keys = Object.keys(overrides);
      if(!keys.length) return;
      var imgData = ctx.getImageData(0, 0, w, h);
      var data = imgData.data;
      var n = palette.length;
      for(var i = 0; i < data.length; i += 4){
        var a = data[i+3];
        if(a < 20) continue;
        var r = data[i], g = data[i+1], b = data[i+2];
        var bestKey = null, bestDist = Infinity;
        for(var j = 0; j < n; j++){
          var p = palette[j];
          var dr = r - p.r, dg = g - p.g, db = b - p.b;
          var dist = dr*dr + dg*dg + db*db;
          if(dist < bestDist){ bestDist = dist; bestKey = p.key; }
        }
        var newHex = overrides[bestKey];
        if(!newHex) continue;
        var rgb = hexToRgb(newHex);
        data[i] = rgb.r; data[i+1] = rgb.g; data[i+2] = rgb.b;
      }
      ctx.putImageData(imgData, 0, 0);
    }

    /* -------- Aplica los trazos de borrador manual guardados para este elemento.
                Cada trazo se guarda en coordenadas relativas (% del ancho/alto),
                así que se puede volver a aplicar sobre cualquier canvas (la
                preview chica del modal o el canvas grande del pipeline final)
                y sobrevive a los cambios de tolerancia/color, que vuelven a
                dibujar la imagen desde cero. -------- */
    function applyEraseStrokes(ctx, w, h, strokes){
      if(!strokes || !strokes.length) return;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      strokes.forEach(function(stroke){
        var pts = stroke.points;
        if(!pts || !pts.length) return;
        var rPx = (stroke.rPct / 100) * w;
        if(pts.length === 1){
          ctx.beginPath();
          ctx.arc((pts[0].xPct/100)*w, (pts[0].yPct/100)*h, rPx, 0, Math.PI*2);
          ctx.fill();
        } else {
          ctx.lineWidth = rPx * 2;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo((pts[0].xPct/100)*w, (pts[0].yPct/100)*h);
          for(var i=1; i<pts.length; i++){
            ctx.lineTo((pts[i].xPct/100)*w, (pts[i].yPct/100)*h);
          }
          ctx.stroke();
        }
      });
      ctx.restore();
    }

    /* Extrae la paleta del elemento activo (a partir del canvas del modal, ya con
       el fondo removido) y dibuja las muestras editables en #vectorizeColorsGrid. */
    function renderColorPalette(id){
      if(!colorsGrid) return;
      colorsGrid.innerHTML = '';
      var item = items[id];
      if(!item) return;

      var ctx = modalCanvas.getContext('2d');
      var result = extractPalette(ctx, modalCanvas.width, modalCanvas.height, 12);
      item.palette = result.colors;
      item.lockedColors = item.lockedColors || {};

      if(!item.palette.length){
        firstDetectedColorInput = null;
        var empty = document.createElement('div');
        empty.className = 'vectorize-colors-empty';
        empty.textContent = 'Sin colores detectados todavía.';
        colorsGrid.appendChild(empty);
        return;
      }

      item.palette.forEach(function(c, idx){
        var hex = (item.colorOverrides && item.colorOverrides[c.key]) || rgbToHex(c.r, c.g, c.b);
        var isLocked = !!item.lockedColors[c.key];

        var swatch = document.createElement('div');
        swatch.className = 'vectorize-color-swatch' + (isLocked ? ' locked' : '');
        swatch.style.background = hex;
        swatch.title = 'Clic: cambiar color · Doble clic: bloquear/desbloquear (evita que este color se mueva con la rotación de tono)';
        swatch.dataset.key = c.key;

        var lockBadge = document.createElement('span');
        lockBadge.className = 'vectorize-color-swatch-lock';
        lockBadge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
        swatch.appendChild(lockBadge);

        var input = document.createElement('input');
        input.type = 'color';
        input.value = hex;
        if(idx === 0){
          // el primer color detectado del panel se mantiene sincronizado con
          // #vectorizeColorSwatchTrigger, pero al clickear este swatch se usa el
          // selector nativo del navegador (no la paleta cómic)
          firstDetectedColorInput = input;
          if(toolColorInput){
            toolColorInput.value = hex;
            toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
          }
          input.addEventListener('input', function(){
            if(toolColorInput){
              toolColorInput.value = input.value;
              toolColorInput.dispatchEvent(new Event('input', { bubbles:true }));
            }
          });
        }
        // los demás colores detectados usan el selector nativo del navegador y se
        // autoajustan solos (rotación de tono) cuando el primero cambia
        input.addEventListener('input', function(){
          if(item.lockedColors[c.key]) return;
          var newHex = input.value;
          var newRgb = hexToRgb(newHex);
          var origHsl = rgbToHsl(c.r, c.g, c.b);
          var newHsl  = rgbToHsl(newRgb.r, newRgb.g, newRgb.b);
          var hueDelta = newHsl.h - origHsl.h;

          item.colorOverrides = item.colorOverrides || {};

          item.palette.forEach(function(p){
            // los colores bloqueados no se tocan, ni siquiera el que disparó el cambio
            if(item.lockedColors[p.key] && p.key !== c.key) return;

            var finalHex;
            if(p.key === c.key){
              // el color que el usuario tocó directamente se aplica tal cual lo eligió
              finalHex = newHex;
            } else {
              // los demás (no bloqueados) rotan su tono la misma cantidad, conservando
              // su propia saturación y luminosidad (su "tono" claro/oscuro no cambia)
              var hsl = rgbToHsl(p.r, p.g, p.b);
              var h = (hsl.h + hueDelta) % 360;
              if(h < 0) h += 360;
              var rgb = hslToRgb(h, hsl.s, hsl.l);
              finalHex = rgbToHex(rgb.r, rgb.g, rgb.b);
            }
            item.colorOverrides[p.key] = finalHex;
            var sw = colorsGrid.querySelector('[data-key="' + p.key + '"]');
            if(sw){
              sw.style.background = finalHex;
              var inp = sw.querySelector('input');
              if(inp) inp.value = finalHex;
            }
          });

          // volvemos a partir de la imagen original (+ recorte de fondo) para que el
          // "match" de cada color se haga siempre contra el color de base, y no contra
          // un color ya modificado en una edición anterior
          ctx.clearRect(0, 0, modalCanvas.width, modalCanvas.height);
          ctx.drawImage(item.img, 0, 0, modalCanvas.width, modalCanvas.height);
          removeBackground(ctx, modalCanvas.width, modalCanvas.height, item.tolerance);
          applyColorOverrides(ctx, modalCanvas.width, modalCanvas.height, item.colorOverrides, item.palette);
          applyEraseStrokes(ctx, modalCanvas.width, modalCanvas.height, item.eraseStrokes);
        });

        swatch.addEventListener('dblclick', function(e){
          e.preventDefault();
          item.lockedColors[c.key] = !item.lockedColors[c.key];
          swatch.classList.toggle('locked', item.lockedColors[c.key]);
        });

        swatch.appendChild(input);
        colorsGrid.appendChild(swatch);
      });
    }

    /* -------- Botón "Restablecer colores originales": borra todos los overrides
                y bloqueos del elemento activo y vuelve a pintar desde cero -------- */
    var colorsResetBtn = document.getElementById('vectorizeColorsReset');
    if(colorsResetBtn){
      colorsResetBtn.addEventListener('click', function(){
        if(!activeModalId) return;
        var item = items[activeModalId];
        if(!item) return;
        item.colorOverrides = {};
        item.lockedColors = {};
        refreshModalPreview();
        renderColorPalette(activeModalId);
      });
    }

    function buildTextboxPicker(){
      if(!textboxesGrid) return;
      textboxesGrid.innerHTML = TEXTBOX_TEMPLATES.map(function(tpl){
        return '<div class="vectorize-textbox-item vectorize-textbox-item-field" data-template="' + tpl.id + '" title="' + tpl.label + '" aria-label="' + tpl.label + '">' +
          '<div class="vtb-field-preview">' +
            '<span class="vtb-field-rotate"></span>' +
            '<span class="vtb-field-box">' +
              '<span class="vtb-field-corner tl"></span>' +
              '<span class="vtb-field-corner tr"></span>' +
              '<span class="vtb-field-corner bl"></span>' +
              '<span class="vtb-field-corner br"></span>' +
              '<span class="vtb-field-label">' + tpl.label + '</span>' +
            '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }
    buildTextboxPicker();

    if(textboxesGrid){
      textboxesGrid.addEventListener('click', function(e){
        var itemEl = e.target.closest('.vectorize-textbox-item');
        if(!itemEl || !activeModalId) return;
        addTextboxInstance(activeModalId, itemEl.dataset.template);
      });
    }

    /* -------- Agrega una instancia real de la plantilla elegida sobre el elemento activo -------- */
    function addTextboxInstance(id, templateId){
      var item = items[id];
      var tpl = TEXTBOX_TEMPLATES_BY_ID[templateId];
      if(!item || !tpl) return;

      var vb = tpl.viewBox.split(' ').map(Number);
      var shapeAspect = vb[3] / vb[2]; // alto/ancho de la plantilla
      var canvasAspect = (modalCanvas.width && modalCanvas.height) ? (modalCanvas.width / modalCanvas.height) : 1;

      var wPct = 55;
      var hPct = wPct * shapeAspect * canvasAspect;
      hPct = Math.max(8, Math.min(70, hPct));

      var tb = {
        instId: 'tb' + (++tbSeq),
        templateId: templateId,
        xPct: Math.max(2, (100 - wPct) / 2),
        yPct: Math.max(2, (100 - hPct) / 2),
        wPct: wPct,
        hPct: hPct,
        rotation: 0,
        text: ''
      };
      item.textboxes.push(tb);
      renderModalTextboxes(id);
    }

    /* -------- Dibuja (o vuelve a dibujar) todas las instancias del elemento activo
                sobre el canvas del modal, ya interactivas -------- */
    function renderModalTextboxes(id){
      if(!modalCanvasWrapEl) return;
      modalCanvasWrapEl.querySelectorAll('.vectorize-tb-instance').forEach(function(el){ el.remove(); });
      var item = items[id];
      if(!item || !item.textboxes) return;

      item.textboxes.forEach(function(tb){
        var tpl = TEXTBOX_TEMPLATES_BY_ID[tb.templateId];
        if(!tpl) return;

        var el = document.createElement('div');
        el.className = 'vectorize-tb-instance';
        el.dataset.inst = tb.instId;
        el.style.left = tb.xPct + '%';
        el.style.top = tb.yPct + '%';
        el.style.width = tb.wPct + '%';
        el.style.height = tb.hPct + '%';
        el.style.transform = 'rotate(' + (tb.rotation || 0) + 'deg)';
        el.innerHTML =
          '<svg viewBox="' + tpl.viewBox + '" preserveAspectRatio="none">' + tpl.shape + '</svg>' +
          '<div class="vectorize-tb-text" contenteditable="true" spellcheck="false" data-placeholder="' + tpl.label + '..."></div>' +
          '<button type="button" class="vectorize-tb-remove" title="Quitar" aria-label="Quitar">×</button>' +
          '<span class="vectorize-tb-rotate" title="Rotar"></span>' +
          '<span class="vectorize-tb-resize tl" data-corner="tl" title="Cambiar tamaño"></span>' +
          '<span class="vectorize-tb-resize tr" data-corner="tr" title="Cambiar tamaño"></span>' +
          '<span class="vectorize-tb-resize bl" data-corner="bl" title="Cambiar tamaño"></span>' +
          '<span class="vectorize-tb-resize br" data-corner="br" title="Cambiar tamaño"></span>';
        el.querySelector('.vectorize-tb-text').textContent = tb.text || '';

        canvasZoomEl.appendChild(el);
        bindTbInstanceEvents(id, tb, el);
      });
    }

    /* -------- Interacciones de cada instancia: mover, redimensionar, editar texto, quitar -------- */
    function bindTbInstanceEvents(id, tb, el){
      var textEl     = el.querySelector('.vectorize-tb-text');
      var removeBtn  = el.querySelector('.vectorize-tb-remove');
      var resizeEls  = el.querySelectorAll('.vectorize-tb-resize');
      var rotateEl   = el.querySelector('.vectorize-tb-rotate');

      textEl.addEventListener('input', function(){ tb.text = textEl.textContent; });
      textEl.addEventListener('mousedown', function(e){ e.stopPropagation(); });

      removeBtn.addEventListener('click', function(e){
        e.stopPropagation();
        var item = items[id];
        if(item){
          item.textboxes = item.textboxes.filter(function(t){ return t.instId !== tb.instId; });
        }
        el.remove();
      });

      el.addEventListener('mousedown', function(e){
        if(e.target === removeBtn || e.target.classList.contains('vectorize-tb-resize') || e.target === rotateEl || e.target === textEl) return;
        e.preventDefault();
        var wrapRect = canvasZoomEl.getBoundingClientRect();
        var startX = e.clientX, startY = e.clientY;
        var startXPct = tb.xPct, startYPct = tb.yPct;
        el.classList.add('dragging');

        function onMove(ev){
          var dxPct = (ev.clientX - startX) / wrapRect.width * 100;
          var dyPct = (ev.clientY - startY) / wrapRect.height * 100;
          tb.xPct = Math.max(0, Math.min(100 - tb.wPct, startXPct + dxPct));
          tb.yPct = Math.max(0, Math.min(100 - tb.hPct, startYPct + dyPct));
          el.style.left = tb.xPct + '%';
          el.style.top = tb.yPct + '%';
        }
        function onUp(){
          el.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      resizeEls.forEach(function(handleEl){
        var corner = handleEl.dataset.corner || 'br';
        handleEl.addEventListener('mousedown', function(e){
          e.preventDefault();
          e.stopPropagation();
          var wrapRect = canvasZoomEl.getBoundingClientRect();
          var startX = e.clientX, startY = e.clientY;
          var startW = tb.wPct, startH = tb.hPct;
          var startXPct = tb.xPct, startYPct = tb.yPct;
          var rightEdge = startXPct + startW;
          var bottomEdge = startYPct + startH;

          function onMove(ev){
            var dxPct = (ev.clientX - startX) / wrapRect.width * 100;
            var dyPct = (ev.clientY - startY) / wrapRect.height * 100;
            var newX = startXPct, newY = startYPct, newW = startW, newH = startH;

            if(corner === 'br'){
              newW = Math.max(10, Math.min(100 - startXPct, startW + dxPct));
              newH = Math.max(6, Math.min(100 - startYPct, startH + dyPct));
            } else if(corner === 'bl'){
              newW = Math.max(10, Math.min(rightEdge, startW - dxPct));
              newX = rightEdge - newW;
              newH = Math.max(6, Math.min(100 - startYPct, startH + dyPct));
            } else if(corner === 'tr'){
              newW = Math.max(10, Math.min(100 - startXPct, startW + dxPct));
              newH = Math.max(6, Math.min(bottomEdge, startH - dyPct));
              newY = bottomEdge - newH;
            } else if(corner === 'tl'){
              newW = Math.max(10, Math.min(rightEdge, startW - dxPct));
              newX = rightEdge - newW;
              newH = Math.max(6, Math.min(bottomEdge, startH - dyPct));
              newY = bottomEdge - newH;
            }

            tb.xPct = newX;
            tb.yPct = newY;
            tb.wPct = newW;
            tb.hPct = newH;
            el.style.left = tb.xPct + '%';
            el.style.top = tb.yPct + '%';
            el.style.width = tb.wPct + '%';
            el.style.height = tb.hPct + '%';
          }
          function onUp(){
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      });

      if(rotateEl){
        rotateEl.addEventListener('mousedown', function(e){
          e.preventDefault();
          e.stopPropagation();
          var startRotation = tb.rotation || 0;

          function angleAtEvent(ev){
            var rect = el.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            return Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180 / Math.PI;
          }

          var startAngle = angleAtEvent(e);

          function onMove(ev){
            var currentAngle = angleAtEvent(ev);
            var delta = currentAngle - startAngle;
            var rotation = Math.round(startRotation + delta);
            // normalizamos a [0, 360)
            rotation = ((rotation % 360) + 360) % 360;
            tb.rotation = rotation;
            el.style.transform = 'rotate(' + rotation + 'deg)';
          }
          function onUp(){
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }
    }

    /* -------- Traslada los cuadros de texto ya definidos a la tarjeta final del elemento -------- */
    function renderTextboxesOnCard(id){
      var item = items[id];
      if(!item || !item.cardEl) return;
      var layer = item.cardEl.querySelector('.elementos-textboxes-layer');
      if(!layer) return;
      layer.innerHTML = '';

      (item.textboxes || []).forEach(function(tb){
        var tpl = TEXTBOX_TEMPLATES_BY_ID[tb.templateId];
        if(!tpl) return;
        var wrap = document.createElement('div');
        wrap.className = 'elementos-tb-final';
        wrap.style.left = tb.xPct + '%';
        wrap.style.top = tb.yPct + '%';
        wrap.style.width = tb.wPct + '%';
        wrap.style.height = tb.hPct + '%';
        wrap.style.transform = 'rotate(' + (tb.rotation || 0) + 'deg)';
        wrap.innerHTML =
          '<svg viewBox="' + tpl.viewBox + '" preserveAspectRatio="none">' + tpl.shape + '</svg>' +
          '<div class="elementos-tb-final-text"></div>';
        wrap.querySelector('.elementos-tb-final-text').textContent = tb.text || '';
        layer.appendChild(wrap);
      });
    }

    /* -------- Modal de ajuste de recorte (automático) -------- */

    function openAdjustModal(id){
      var item = items[id];
      if(!item) return;
      activeModalId = id;

      var img = item.img;
      var maxW = 320;
      var scale = Math.min(1, maxW / img.naturalWidth);
      var w = Math.round(img.naturalWidth * scale);
      var h = Math.round(img.naturalHeight * scale);
      modalCanvas.width = w;
      modalCanvas.height = h;
      var ctx = modalCanvas.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img, 0, 0, w, h);
      // aplicamos el recorte de fondo automático actual (según la tolerancia vigente)
      // para previsualizar la transparencia real sobre la cuadrícula azul
      removeBackground(ctx, w, h, item.tolerance);
      // primero extraemos/pintamos la paleta (a partir de los colores originales),
      // y sólo después reaplicamos los cambios de color que el usuario ya haya hecho
      renderColorPalette(id);
      applyColorOverrides(ctx, w, h, item.colorOverrides, item.palette);
      applyEraseStrokes(ctx, w, h, item.eraseStrokes);

      setToleranceValue(item.tolerance, true);
      if(window.__syncVectorizeBrushOverlay) window.__syncVectorizeBrushOverlay();
      if(window.__resetVectorizeZoom) window.__resetVectorizeZoom();

      modalOverlay.classList.add('open');
      // vuelve a dibujar los cuadros de texto que ya tenía este elemento (si los tenía)
      renderModalTextboxes(id);
    }

    function closeAdjustModal(){
      modalOverlay.classList.remove('open');
      if(modalCanvasWrapEl){
        modalCanvasWrapEl.querySelectorAll('.vectorize-tb-instance').forEach(function(el){ el.remove(); });
      }
      if(toolEraser){
        toolEraser.classList.remove('active');
        toolEraser.setAttribute('aria-pressed', 'false');
      }
      if(window.__resetVectorizeZoom) window.__resetVectorizeZoom();
      closeComicPalette();
      activeModalId = null;
    }

    modalClose.addEventListener('click', closeAdjustModal);
    modalOverlay.addEventListener('click', function(e){
      if(e.target === modalOverlay) closeAdjustModal();
    });

    /* -------- Selector de categoría, con opción de crear una nueva -------- */
    if(categorySelect){
      categorySelect.addEventListener('change', function(){
        if(categorySelect.value !== '__new__') return;

        var nombre = window.prompt('Nombre de la nueva categoría:');
        // Volvemos al placeholder si se cancela o se deja vacío
        if(!nombre || !nombre.trim()){
          categorySelect.value = '';
          return;
        }
        nombre = nombre.trim();

        // Si ya existe una opción con ese nombre, simplemente la seleccionamos
        var existente = Array.prototype.find.call(categorySelect.options, function(opt){
          return opt.value !== '__new__' && opt.textContent === nombre;
        });
        if(existente){
          categorySelect.value = existente.value;
          return;
        }

        var nuevaOpcion = document.createElement('option');
        nuevaOpcion.value = 'cat_' + Date.now();
        nuevaOpcion.textContent = nombre;
        // La insertamos justo antes de "+ Crear nueva categoría", que queda al final
        categorySelect.insertBefore(nuevaOpcion, categorySelect.querySelector('option[value="__new__"]'));
        categorySelect.value = nuevaOpcion.value;
      });
    }

    function refreshModalPreview(){
      if(!activeModalId) return;
      var item = items[activeModalId];
      if(!item) return;
      var img = item.img;
      var w = modalCanvas.width, h = modalCanvas.height;
      var ctx = modalCanvas.getContext('2d');
      ctx.clearRect(0,0,w,h);
      ctx.drawImage(img, 0, 0, w, h);
      var liveTolerance = getToleranceValue();
      removeBackground(ctx, w, h, liveTolerance);
      applyColorOverrides(ctx, w, h, item.colorOverrides, item.palette);
      applyEraseStrokes(ctx, w, h, item.eraseStrokes);
    }

    if(modalApply){
      modalApply.addEventListener('click', function(){
        if(!activeModalId) return;
        var item = items[activeModalId];
        item.tolerance = getToleranceValue();
        runPipeline(activeModalId);
        renderTextboxesOnCard(activeModalId);
        
        // ══════════════════════════════════════════════════════════════════════
        // GUARDAR ELEMENTO EN LOCALSTORAGE
        // ══════════════════════════════════════════════════════════════════════
        try {
          // Obtener el canvas procesado del elemento
          var canvas = modalCanvas;
          if (canvas && canvas.width > 0 && canvas.height > 0) {
            var preview = canvas.toDataURL('image/png');
            
            // Guardar elemento usando GestorElementos
            var elementoGuardado = GestorElementos.guardar({
              nombre: activeModalId || 'Elemento sin nombre',
              preview: preview,
              categoria: 'Elementos',
              tolerance: item.tolerance || 32
            });
            
            console.log('[Elemento Incorporado]', elementoGuardado.nombre, 'v' + elementoGuardado.version);
            
            // Mostrar notificación breve (opcional)
            // Puedes agregar una notificación toast aquí si querés
          }
        } catch (err) {
          console.error('[Error al guardar elemento]', err);
          if (err.message === 'QUOTA_EXCEEDED') {
            alert('No hay suficiente espacio en el almacenamiento local. Eliminá algunos elementos antiguos.');
          } else if (err.message === 'STORAGE_DISABLED') {
            alert('El almacenamiento local está deshabilitado en tu navegador.');
          }
        }
        // ══════════════════════════════════════════════════════════════════════
        
        closeAdjustModal();
      });
    }

  })();

// Umbral de línea / Tolerancia de adyacencia: mismo patrón que Ancho/Alto
// del panel "Medidas" — caja numérica regulable girando la rueda del mouse.
(function(){
  if (!threshInput || !tolInput) return;

  function clampInt(v, min, max){ return Math.min(max, Math.max(min, Math.round(v))); }

  function parseIntInput(raw, fallback){
    const v = parseInt(String(raw).replace(',', '.'), 10);
    return isFinite(v) ? v : fallback;
  }

  // Mientras el usuario tipea no reformateamos el campo — solo dejamos
  // pasar dígitos (son valores enteros).
  function sanitizeIntInput(e){
    const el = e.target;
    const v = el.value.replace(/[^0-9]/g, '');
    if (v !== el.value) el.value = v;
  }

  // Breve resalte visual del recuadro al ajustar con la rueda del mouse.
  function flashWheel(input){
    const box = input.closest('.number-input-box');
    if (!box) return;
    box.classList.add('wheel-active');
    clearTimeout(box._wheelTimer);
    box._wheelTimer = setTimeout(() => box.classList.remove('wheel-active'), 400);
  }

  function commitThresh(rawValue){
    const v = clampInt(parseIntInput(rawValue, state.threshold), 20, 240);
    state.threshold = v;
    threshInput.value = v;
    triggerAutoSegment();
  }
  function commitTol(rawValue){
    const v = clampInt(parseIntInput(rawValue, state.tolerance), 1, 10);
    state.tolerance = v;
    tolInput.value = v;
    triggerAutoSegment();
  }

  // Escribir a mano: se confirma recién al salir del campo (blur) o con
  // Enter. Girar la rueda del mouse ajusta y confirma al instante.
  threshInput.addEventListener('input', sanitizeIntInput);
  tolInput.addEventListener('input', sanitizeIntInput);

  threshInput.addEventListener('change', function(){ commitThresh(threshInput.value); });
  tolInput.addEventListener('change', function(){ commitTol(tolInput.value); });

  threshInput.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); threshInput.blur(); } });
  tolInput.addEventListener('keydown', function(e){ if (e.key === 'Enter'){ e.preventDefault(); tolInput.blur(); } });

  // Rueda del mouse sobre el campo: +/-1 por paso, Shift = paso más grande.
  threshInput.addEventListener('wheel', function(e){
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dir = e.deltaY < 0 ? 1 : -1;
    commitThresh(parseIntInput(threshInput.value, state.threshold) + dir * step);
    flashWheel(threshInput);
  }, { passive: false });
  tolInput.addEventListener('wheel', function(e){
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    const dir = e.deltaY < 0 ? 1 : -1;
    commitTol(parseIntInput(tolInput.value, state.tolerance) + dir * step);
    flashWheel(tolInput);
  }, { passive: false });
})();
document.getElementById('preciseContour').addEventListener('change', () => {
  triggerAutoSegment();
});

/* ============================================================
   2) SEGMENTACIÓN: binarizar → flood fill → stats → contornos → adyacencia
============================================================ */
/* Antes había que apretar un botón "Detectar máscaras" a mano. Ahora la
   detección corre sola: apenas se carga una imagen, y cada vez que se
   toca umbral/tolerancia/contorno preciso. Como girar la rueda del mouse
   sobre esos campos dispara varios eventos seguidos, se aplica un pequeño
   debounce para no relanzar el cálculo (que puede ser pesado) de golpe. */
let autoSegmentTimer = null;
const AUTO_SEGMENT_DEBOUNCE_MS = 220;
function triggerAutoSegment() {
  if (!sourceImage || !state.iw || !state.ih) return;
  if (segmentStatus) segmentStatus.textContent = '⏳ Detectando…';
  clearTimeout(autoSegmentTimer);
  autoSegmentTimer = setTimeout(() => {
    try {
      runSegmentation();
      if (segmentStatus) segmentStatus.textContent = '✅ Máscaras actualizadas';
    } catch (err) {
      console.error(err);
      if (segmentStatus) segmentStatus.textContent = '⚠️ Error al detectar, ajustá umbral/tolerancia';
      alert('Ocurrió un error al segmentar la plantilla: ' + err.message + '\nProbá con un umbral/tolerancia distintos o una imagen más simple.');
    }
  }, AUTO_SEGMENT_DEBOUNCE_MS);
}

const BUILD_TAG = 'FIX-v3-2026-08-10-0230';
console.log('[superimprimible] build cargado:', BUILD_TAG);
(function(){
  try {
    const badge = document.createElement('div');
    badge.textContent = 'BUILD: ' + BUILD_TAG;
    badge.style.cssText = 'position:fixed; bottom:6px; right:8px; z-index:99999; background:#111; color:#0f0; font:11px monospace; padding:3px 8px; border-radius:4px; opacity:0.85; pointer-events:none;';
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(badge));
  } catch(e) {}
})();

function runSegmentation() {
  if (!state.iw || !state.ih) return;

  // reinicio completo del estado de máscaras/jerarquía/modelo antes de cada detección:
  // sin esto, una corrida anterior (máscaras, selección, modelo 3D construido) podía
  // quedar mezclada visualmente con los resultados nuevos.
  state.masks = [];
  state.meta = new Map();
  state.adjacency = new Map();
  state.fanClusters = [];
  state.mergeNotes = [];
  state.inkClass = null;
  state.selectedId = null;
  state.hoverId = null;
  state.built = false;
  while (root.children.length) root.remove(root.children[0]);
  nodesById = new Map();
  document.getElementById('empty3d').style.display = 'flex';
  document.getElementById('canvasHost').style.display = 'none';
  state.buildLogLines = [];

  const w = state.iw, h = state.ih;
  // ARREGLO: drawEditorOverlay() pinta tintes de color y etiquetas de texto
  // ("Máscara N") directo sobre este mismo canvas (ectx). Si no se restaura
  // la imagen original ACÁ antes de leer los píxeles, una segmentación
  // repetida (el auto-segmentado puede dispararse más de una vez) termina
  // leyendo ese texto/tinte como si fuera parte del dibujo, rompiendo la
  // forma de la máscara que tenía la etiqueta encima.
  if (sourceImage) {
    ectx.clearRect(0, 0, w, h);
    ectx.fillStyle = '#fff';
    ectx.fillRect(0, 0, w, h);
    ectx.drawImage(sourceImage, 0, 0, w, h);
    applyTemplateEraseStrokes(ectx, w, h);
  }
  const imgData = ectx.getImageData(0, 0, w, h);
  const ink = new Uint8Array(w*h);
  let inkCount = 0;
  for (let i = 0, p = 0; i < imgData.data.length; i += 4, p++) {
    const lum = 0.299*imgData.data[i] + 0.587*imgData.data[i+1] + 0.114*imgData.data[i+2];
    ink[p] = lum < state.threshold ? 1 : 0;
    if (ink[p]) inkCount++;
  }
  state.ink = ink;

  // guardia de rendimiento: si el umbral quedó muy alto, casi toda la imagen se
  // clasifica como "tinta" y el escaneo de adyacencias (que recorre cada píxel
  // de tinta) se vuelve muchísimo más lento — esto es lo que suele sentirse
  // como que la herramienta "se congela" sin ningún error en consola.
  const inkRatio = inkCount / (w*h);
  if (inkRatio > 0.55) {
    const proceed = confirm(
      `El umbral actual marca ${(inkRatio*100).toFixed(0)}% de la imagen como "tinta". ` +
      `Esto puede hacer que el procesamiento tarde mucho y parezca que la herramienta se congeló.\n\n` +
      `Recomendado: bajá el campo "Umbral de línea" para que solo las líneas oscuras queden marcadas.\n\n` +
      `¿Querés continuar de todas formas?`
    );
    if (!proceed) return;
  }

  const { labels, count } = floodFillLabels(ink, w, h);
  state.labels = labels;

  let masks = computeMaskStats(labels, count, w, h);
  const exteriorId = detectExterior(masks);
  state.exteriorId = exteriorId;

  // adyacencia sobre los labels "crudos" (antes de fusionar ruido): la necesitamos
  // para saber, de cada región diminuta, con qué vecino comparte más borde real
  let adjResult = scanAdjacency(ink, labels, w, h, state.tolerance, exteriorId);

  // MEJORA 1: fusiona regiones diminutas (ruido de convergencia de líneas) con su
  // vecino real. Si hubo fusiones, los labels quedan modificados in-place, así que
  // recalculamos stats + adyacencia una vez más sobre los labels ya corregidos.
  const mergeResult = mergeTinyMasks(labels, masks, adjResult.adjacency, exteriorId, w, h);
  state.mergeNotes = mergeResult.merges.map(m => `Se fusionó una región de ruido (~${m.area}px) con su vecina real.`);
  if (mergeResult.merges.length) {
    masks = computeMaskStats(labels, count, w, h);
    adjResult = scanAdjacency(ink, labels, w, h, state.tolerance, exteriorId);
  }

  const usePrecise = document.getElementById('preciseContour').checked;
  masks.forEach(m => {
    if (m.id === exteriorId) { m.isExterior = true; return; }
    m.isExterior = false;
    let contour = [];
    try {
      contour = usePrecise ? traceContour(labels, w, h, m.id) : null;
      if (!contour || contour.length < 3) {
        contour = bboxContour(m.bbox);
      } else {
        // ARREGLO: sharpenCorners está pensado para esquinas rectas y puede
        // degenerar formas muy curvas (círculos chicos) en un polígono cuya
        // área ya no coincide con la real. Antes de tirar todo al rectángulo
        // del bbox (que se ve como un cuadrado en vez de una curva), probamos
        // quedarnos con el contorno YA simplificado pero sin "afilar", que en
        // la práctica casi siempre conserva un área correcta. processContourWithHoles
        // aplica ambos pasos también a cualquier agujero interior (máscaras en
        // forma de anillo) para que no se pierda al simplificar.
        const { simplified, sharpened } = processContourWithHoles(contour);
        contour = contourAreaLooksValid(sharpened, m.area) ? sharpened : simplified;
      }
      if (!contourAreaLooksValid(contour, m.area)) {
        console.warn(`[visor3D] contorno de máscara id=${m.id} no coincide con su área real (trazado=${netContourArea(contour).toFixed(0)}px² vs real=${m.area}px²) — usando rectángulo de respaldo.`);
        contour = bboxContour(m.bbox);
      }
    } catch (err) {
      contour = bboxContour(m.bbox);
    }
    m.contour = contour;
  });

  state.adjacency = adjResult.adjacency;
  state.fanClusters = adjResult.fanClusters;
  state.inkClass = adjResult.inkClass;
  // filtra el exterior y las máscaras que quedaron con área 0 (fusionadas hacia otra)
  state.masks = masks.filter(m => m.id !== exteriorId && m.area > 0);

  initMeta();
  renderFanNotes();
  renderMaskList();
  renderHierarchy();
  drawEditorOverlay();
  recalcDimsFromMasks();
}

function floodFillLabels(ink, w, h) {
  const labels = new Int32Array(w*h).fill(-2); // -2 = sin visitar, -1 = tinta
  for (let i = 0; i < w*h; i++) if (ink[i]) labels[i] = -1;
  let nextId = 0;
  const qx = new Int32Array(w*h), qy = new Int32Array(w*h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y*w+x;
      if (labels[idx] !== -2) continue;
      // BFS
      let head = 0, tail = 0;
      qx[tail]=x; qy[tail]=y; tail++;
      labels[idx] = nextId;
      while (head < tail) {
        const cx = qx[head], cy = qy[head]; head++;
        const neighbors = [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]];
        for (const [nx, ny] of neighbors) {
          if (nx<0||ny<0||nx>=w||ny>=h) continue;
          const nidx = ny*w+nx;
          if (labels[nidx] === -2) {
            labels[nidx] = nextId;
            qx[tail]=nx; qy[tail]=ny; tail++;
          }
        }
      }
      nextId++;
    }
  }
  return { labels, count: nextId };
}

function computeMaskStats(labels, count, w, h) {
  const masks = [];
  for (let id = 0; id < count; id++) {
    masks.push({ id, area:0, bbox:{minX:w,minY:h,maxX:0,maxY:0}, touchesBorder:false, cx:0, cy:0 });
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = labels[y*w+x];
      if (id < 0) continue;
      const m = masks[id];
      m.area++;
      m.cx += x; m.cy += y;
      if (x < m.bbox.minX) m.bbox.minX = x;
      if (y < m.bbox.minY) m.bbox.minY = y;
      if (x > m.bbox.maxX) m.bbox.maxX = x;
      if (y > m.bbox.maxY) m.bbox.maxY = y;
      if (x===0||y===0||x===w-1||y===h-1) m.touchesBorder = true;
    }
  }
  masks.forEach(m => { if (m.area>0){ m.centroid = {x:m.cx/m.area, y:m.cy/m.area}; } else { m.centroid={x:0,y:0}; } });
  return masks;
}

function detectExterior(masks) {
  let best = -1, bestArea = -1;
  masks.forEach(m => {
    if (m.touchesBorder && m.area > bestArea) { bestArea = m.area; best = m.id; }
  });
  return best;
}

function bboxContour(b) {
  return [ {x:b.minX,y:b.minY}, {x:b.maxX,y:b.minY}, {x:b.maxX,y:b.maxY}, {x:b.minX,y:b.maxY} ];
}

// Área firmada (shoelace) de un polígono en coordenadas de imagen (px²).
function polygonAreaPx(pts) {
  let a = 0;
  for (let i=0;i<pts.length;i++) {
    const p1 = pts[i], p2 = pts[(i+1)%pts.length];
    a += p1.x*p2.y - p2.x*p1.y;
  }
  return Math.abs(a/2);
}

// Red de seguridad: el trazador Moore-neighbor puede, en casos raros que la
// corrección del criterio de Jacob no cubra (labels muy ruidosos, etc.), devolver
// igual un contorno colapsado. Comparamos el área del polígono trazado contra el
// área real de píxeles de la máscara (m.area, que viene del flood-fill y siempre
// es correcta); si difieren demasiado, el contorno no sirve y usamos el rectángulo
// del bbox como respaldo seguro en vez de dejar un panel invisible en el visor 3D.
// Área neta de un contorno: la del lazo exterior menos la de cada agujero
// adjunto en `.holes` (ver traceContour). Para una máscara simple sin agujeros
// esto es simplemente polygonAreaPx(contour), igual que antes.
function netContourArea(contour) {
  let area = polygonAreaPx(contour);
  if (contour && contour.holes && contour.holes.length) {
    for (const h of contour.holes) area -= polygonAreaPx(h);
  }
  return area;
}

function contourAreaLooksValid(contour, realPixelArea) {
  if (!contour || contour.length < 3 || realPixelArea <= 0) return false;
  const polyArea = netContourArea(contour);
  const ratio = polyArea / realPixelArea;
  return ratio > 0.3 && ratio < 3;
}

/* Moore-neighbor tracing (con fallback si algo sale mal) */
/* Trazado de contorno por ARISTAS DE GRILLA (edge-following), no por centros de píxel.
   Reemplaza la implementación anterior basada en Moore-neighbor (vecino de 8), que
   tenía dos problemas serios confirmados con pruebas:
   1) Para regiones sólidas simples (p. ej. un panel rectangular liso, sin ningún
      detalle interno) el recorrido por centros de píxel podía "cortar camino" y
      cerrar un lazo minúsculo de 4 puntos en vez de recorrer el perímetro real
      — bug independiente de cualquier vértice "abanico" o cuello angosto.
   2) En vértices donde convergen 3-5 máscaras (cuello de 1px), el criterio de
      cierre podía cortar el trazo antes de tiempo (o, en un intento de arreglo
      posterior, darle la vuelta dos veces y devolver un polígono autointersectado).

   Este método traza a lo largo de los BORDES entre píxeles (no de sus centros):
   cada píxel de la máscara aporta como "arista de borde" cada uno de sus 4 lados
   cuyo vecino correspondiente NO pertenece a la misma máscara; los lados compartidos
   entre dos píxeles de la misma máscara se cancelan automáticamente. Lo que queda es
   exactamente el contorno real de la región, sin importar su forma (cóncava, con
   cuellos angostos, etc.). En cada vértice de la grilla, si hay más de una arista de
   salida disponible (esto pasa en los cuellos de 1px / vértices abanico), siempre se
   prioriza el giro más cerrado hacia la derecha — la regla estándar de "seguir la
   pared" que garantiza recorrer el contorno externo de forma consistente sin saltar
   a otro tramo ni cruzarse a sí mismo. Verificado con pruebas: rectángulo sólido,
   forma en L, cuello de 1px y triángulo — el área del polígono trazado coincide
   exactamente con el conteo real de píxeles de la máscara en los cuatro casos. */
function traceContour(labels, w, h, id) {
  const isId = (x,y) => x>=0 && y>=0 && x<w && y<h && labels[y*w+x] === id;
  // Sistema de coordenadas de ESQUINAS de píxel: la esquina (cx,cy) es la esquina
  // superior-izquierda del píxel (cx,cy). direcciones: 0=derecha 1=abajo 2=izquierda 3=arriba
  const edgeFrom = new Map(); // 'x,y,dir' -> {x,y} destino de esa arista dirigida
  const key = (x,y,d) => x + ',' + y + ',' + d;
  // ARREGLO (máscaras con forma de ANILLO/rosquilla, ej. una solapa circular
  // entre dos circunferencias concéntricas): una región así tiene DOS lazos de
  // borde separados —el contorno exterior y el contorno interior (el "agujero")—
  // que NO están conectados entre sí en el grafo de aristas. La versión anterior
  // guardaba un único `startCorner` (el primero que encontraba) y se detenía en
  // cuanto ese lazo cerraba, dejando sin recorrer las aristas del otro lazo. El
  // contorno resultante terminaba siendo un círculo completo (no el anillo real),
  // su área no coincidía con el área real de píxeles, y más adelante el código
  // de validación lo descartaba y caía al rectángulo del bbox (panel cuadrado).
  // Ahora juntamos TODOS los posibles puntos de arranque (cada arista "0=derecha"
  // expuesta, que existe una vez por cada lazo) y trazamos un lazo por cada uno
  // que todavía no haya sido consumido por un lazo anterior.
  const startCorners = [];
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      if (!isId(x,y)) continue;
      if (!isId(x,y-1)) { edgeFrom.set(key(x,y,0), {x:x+1,y}); startCorners.push({x,y,dir:0}); }
      if (!isId(x+1,y)) edgeFrom.set(key(x+1,y,1), {x:x+1,y:y+1});
      if (!isId(x,y+1)) edgeFrom.set(key(x+1,y+1,2), {x,y:y+1});
      if (!isId(x-1,y)) edgeFrom.set(key(x,y+1,3), {x,y});
    }
  }
  if (!startCorners.length) return [];

  const totalEdges = edgeFrom.size;
  const loops = [];
  for (const sc of startCorners) {
    if (!edgeFrom.has(key(sc.x, sc.y, sc.dir))) continue; // ya recorrido como parte de otro lazo
    let cx = sc.x, cy = sc.y, dir = sc.dir;
    const first = { x: cx, y: cy };
    const loop = [];
    const maxSteps = totalEdges + 4;
    let steps = 0;
    while (true) {
      loop.push({ x: cx, y: cy });
      const target = edgeFrom.get(key(cx, cy, dir));
      if (!target) break;
      edgeFrom.delete(key(cx, cy, dir));
      cx = target.x; cy = target.y;
      // en el vértice nuevo: preferir giro a la derecha, luego seguir recto, luego
      // giro a la izquierda, y como último recurso dar la vuelta (cuellos de 1px).
      const tryOrder = [(dir+1)%4, dir, (dir+3)%4, (dir+2)%4];
      let nd = null;
      for (const cand of tryOrder) { if (edgeFrom.has(key(cx, cy, cand))) { nd = cand; break; } }
      steps++;
      if (steps > maxSteps) break;
      if (cx === first.x && cy === first.y) break;
      if (nd === null) break;
      dir = nd;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  if (!loops.length) return [];

  // El lazo de mayor área es el contorno exterior; cualquier otro lazo hallado
  // es un agujero interior (islas de "no tinta" completamente rodeadas, como el
  // interior del anillo). Los agujeros quedan adjuntos como `.holes` sobre el
  // array devuelto para que quien lo consuma (validación de área, mesh 3D, etc.)
  // pueda usarlos sin cambiar la firma de la función.
  loops.forEach(l => { l.__area = polygonAreaPx(l); });
  loops.sort((a, b) => b.__area - a.__area);
  const outer = loops[0];
  outer.holes = loops.slice(1);
  return outer;
}

/* Simplificación Douglas-Peucker, consciente de que el contorno es un ANILLO CERRADO.
   El primer y último punto del trazo (Moore-neighbor) quedan casi pegados entre sí
   (es literalmente el mismo píxel de arranque) — usarlos como anclaje del primer split
   de Douglas-Peucker degenera el cálculo (cuerda de largo ~0, cualquier punto "parece"
   lejísimos de ella). Partimos el anillo a la mitad por orden de recorrido para tener
   dos mitades con anclajes reales, simplificamos cada una y las volvemos a unir. */
function simplifyPolygon(points, epsilon) {
  if (points.length < 4) return points;
  function perpDist(p, a, b) {
    const dx = b.x-a.x, dy = b.y-a.y;
    const len = Math.hypot(dx,dy) || 1e-9;
    return Math.abs((p.x-a.x)*dy - (p.y-a.y)*dx) / len;
  }
  function dp(pts) {
    if (pts.length < 3) return pts;
    let maxD = 0, idx = 0;
    for (let i=1;i<pts.length-1;i++) {
      const d = perpDist(pts[i], pts[0], pts[pts.length-1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > epsilon) {
      const left = dp(pts.slice(0, idx+1));
      const right = dp(pts.slice(idx));
      return left.slice(0,-1).concat(right);
    }
    return [pts[0], pts[pts.length-1]];
  }
  const mid = Math.floor(points.length/2);
  const half1 = dp(points.slice(0, mid+1));
  const half2 = dp(points.slice(mid));
  const simplified = half1.slice(0,-1).concat(half2);
  return simplified.length >= 3 ? simplified : points;
}

/* MEJORA 2: preserva esquinas filosas reales.
   Aun después de Douglas-Peucker, un vértice que en el papel es un ángulo recto/agudo
   puede seguir representado por 2-4 puntos casi pegados entre dos lados largos — rastro
   del grosor/antialiasing del trazo de tinta al fotografiar la plantilla. Esta pasada
   detecta esas corridas cortas entre dos lados largos y las reemplaza por el punto de
   intersección real de esos dos lados extendidos, devolviendo el vértice a una esquina
   filosa en vez de una curva. */
function sharpenCorners(poly) {
  const n = poly.length;
  if (n < 5) return poly;
  const edgeLen = (a,b) => Math.hypot(b.x-a.x, b.y-a.y);
  const lens = [];
  for (let i=0;i<n;i++) lens.push(edgeLen(poly[i], poly[(i+1)%n]));
  const avg = lens.reduce((a,b)=>a+b,0)/n;
  const shortT = Math.max(4, avg*0.12);
  const isShort = lens.map(l => l < shortT);

  const visited = new Array(n).fill(false);
  const runs = [];
  for (let i=0;i<n;i++) {
    if (!isShort[i] || visited[i]) continue;
    let j = i;
    const run = [];
    while (isShort[j] && !visited[j] && run.length < n) { visited[j]=true; run.push(j); j=(j+1)%n; }
    if (run.length && run.length < n-2) runs.push(run);
  }

  function lineIntersect(p1,p2,p3,p4) {
    const d1x=p2.x-p1.x, d1y=p2.y-p1.y, d2x=p4.x-p3.x, d2y=p4.y-p3.y;
    const denom = d1x*d2y - d1y*d2x;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((p3.x-p1.x)*d2y - (p3.y-p1.y)*d2x) / denom;
    return { x: p1.x + t*d1x, y: p1.y + t*d1y };
  }

  const replacements = new Map(); // índice del punto -> {x,y} (primero de la corrida) o null (se descarta)
  runs.forEach(run => {
    const before = (run[0] - 1 + n) % n;
    const after = (run[run.length-1] + 1) % n;
    if (isShort[before] || isShort[after]) return; // sin lado largo confiable de dónde extrapolar
    if (isShort[(before-1+n)%n] || isShort[(after+1)%n]) return; // ídem, un paso más allá
    const p1 = poly[(before-1+n)%n], p2 = poly[before];
    const p3 = poly[after], p4 = poly[(after+1)%n];
    const hit = lineIntersect(p1,p2,p3,p4);
    if (!hit) return;
    const ref = poly[run[0]];
    if (Math.hypot(hit.x-ref.x, hit.y-ref.y) > avg*3) return; // extrapolación disparatada, se descarta
    run.forEach((idx,k) => { replacements.set(idx, k===0 ? hit : null); });
  });

  const out = [];
  for (let i=0;i<n;i++) {
    if (replacements.has(i)) {
      const r = replacements.get(i);
      if (r) out.push(r);
    } else {
      out.push(poly[i]);
    }
  }
  return out.length >= 3 ? out : poly;
}

// Aplica simplify+sharpen tanto al lazo EXTERIOR de un contorno como a cada uno
// de sus agujeros interiores (ver traceContour/.holes) — sin esto, una máscara
// en forma de anillo perdería su agujero apenas pasara por simplifyPolygon o
// sharpenCorners (que solo tocaban el array recibido, ignorando `.holes`), y
// volveríamos a terminar con un disco completo en vez del anillo real.
// Devuelve las dos variantes (con holes ya adjuntos) entre las que el llamador
// elige según cuál conserve mejor el área real, igual que se hacía antes solo
// para el contorno exterior.
function processContourWithHoles(contour) {
  const holesIn = contour.holes || [];
  const simplifiedOuter = simplifyPolygon(contour, 1.6);
  const sharpenedOuter = sharpenCorners(simplifiedOuter);
  const simplifiedHoles = holesIn.map(h => simplifyPolygon(h, 1.6));
  const sharpenedHoles = simplifiedHoles.map(h => sharpenCorners(h));
  simplifiedOuter.holes = simplifiedHoles;
  sharpenedOuter.holes = sharpenedHoles;
  return { simplified: simplifiedOuter, sharpened: sharpenedOuter };
}

/* Escaneo de adyacencia por ventana: para cada píxel de tinta, mira qué
   máscaras aparecen a su alrededor. 2 máscaras distintas => borde de pliegue.
   3+ => vértice tipo abanico. Solo 1 máscara + exterior/borde => corte. */
function scanAdjacency(ink, labels, w, h, radius, exteriorId) {
  const adjacency = new Map();
  const inkClass = new Uint8Array(w*h);
  const fanPoints = [];
  const seen = new Set();
  for (let y=0; y<h; y++) {
    for (let x=0; x<w; x++) {
      const idx = y*w+x;
      if (!ink[idx]) continue;
      seen.clear();
      let touchesExteriorOrEdge = (x<=0||y<=0||x>=w-1||y>=h-1);
      for (let dy=-radius; dy<=radius; dy++) {
        const ny = y+dy;
        if (ny<0||ny>=h) continue;
        for (let dx=-radius; dx<=radius; dx++) {
          const nx = x+dx;
          if (nx<0||nx>=w) continue;
          const nid = labels[ny*w+nx];
          if (nid < 0) continue;
          if (nid === exteriorId) { touchesExteriorOrEdge = true; continue; }
          seen.add(nid);
        }
      }
      const ids = Array.from(seen);
      if (ids.length >= 2) {
        inkClass[idx] = 1; // pliegue
        for (let a=0; a<ids.length; a++) {
          for (let b=a+1; b<ids.length; b++) {
            const key = pairKey(ids[a], ids[b]);
            if (!adjacency.has(key)) adjacency.set(key, { count:0, sumx:0, sumy:0, sumxx:0, sumyy:0, sumxy:0, ids:[Math.min(ids[a],ids[b]), Math.max(ids[a],ids[b])] });
            const e = adjacency.get(key);
            e.count++; e.sumx += x; e.sumy += y;
            e.sumxx += x*x; e.sumyy += y*y; e.sumxy += x*y;
          }
        }
        if (ids.length >= 3) fanPoints.push({x,y,ids: ids.slice()});
      } else if (ids.length === 1 && touchesExteriorOrEdge) {
        inkClass[idx] = 2; // corte
      } else if (ids.length === 1) {
        inkClass[idx] = 1; // borde entre una máscara y ella misma vista al otro lado de una línea fina sin exterior detectado -> tratar como posible pliegue débil
      }
    }
  }
  // filtra pares con muy pocos píxeles compartidos (ruido)
  for (const [key, e] of adjacency) {
    if (e.count < 3) adjacency.delete(key);
  }
  // agrupa puntos de abanico cercanos
  const rawFanClusters = clusterFanPoints(fanPoints, radius*2+2);
  // Segunda pasada de consolidación: el mismo vértice físico (donde convergen
  // varias máscaras) suele detectarse como 2-3 clusters casi duplicados,
  // separados por apenas 15-30px, porque cada PAR de máscaras "toca" ese
  // vértice en píxeles ligeramente distintos según el ángulo exacto de sus
  // propios bordes. Sin esta fusión, máscaras vecinas del mismo abanico
  // terminaban ancladas a puntos distintos (aunque cercanos) y no cerraban
  // bien entre sí al plegar. 40px es un margen amplio frente al ruido típico
  // mostrado en los reportes, pero muy por debajo de la distancia a
  // cualquier OTRO vértice de abanico realmente distinto en estos modelos.
  const fanClusters = clusterFanPoints(rawFanClusters.map(c => ({x:c.x, y:c.y, ids:c.ids, reach:c.reach})), 40);
  return { adjacency, fanClusters, inkClass };
}

function clusterFanPoints(points, maxDist) {
  // agrupamiento por grilla espacial en vez de comparar todos los pares entre sí (O(n²)).
  // Con imágenes ruidosas puede haber miles de "puntos de abanico" candidatos, y el
  // enfoque O(n²) anterior podía tardar tanto que la pestaña parecía congelada.
  const cell = Math.max(1, maxDist);
  const grid = new Map();
  const cellKey = (cx, cy) => cx + ',' + cy;
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    const key = cellKey(cx, cy);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  });
  const used = new Array(points.length).fill(false);
  const clusters = [];
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const members = [points[i]];
    let sumx = points[i].x, sumy = points[i].y, n = 1;
    const ids = new Set(points[i].ids);
    used[i] = true;
    const cx = Math.floor(points[i].x / cell), cy = Math.floor(points[i].y / cell);
    // solo revisa candidatos en la celda propia y las 8 vecinas, no todos los puntos
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const bucket = grid.get(cellKey(gx, gy));
        if (!bucket) continue;
        for (const j of bucket) {
          if (used[j]) continue;
          const mx = sumx / n, my = sumy / n;
          const dx = points[j].x - mx, dy = points[j].y - my;
          if (Math.hypot(dx, dy) <= maxDist) {
            sumx += points[j].x; sumy += points[j].y; n++;
            points[j].ids.forEach(id => ids.add(id));
            members.push(points[j]);
            used[j] = true;
          }
        }
      }
    }
    const fx = sumx / n, fy = sumy / n;
    // "reach": qué tan lejos del punto final promedio puede quedar, en el peor
    // caso, la esquina real de alguna de las máscaras fusionadas acá. Sin
    // esto, el radio de "pegado" en buildNode (FAN_VERTEX_SNAP_PX, un valor
    // fijo bastante más chico que maxDist=40 usado en la segunda pasada)
    // quedaba desalineado con cuánto se pudo haber movido el vértice al
    // fusionar sub-uniones cercanas: una máscara angosta (una solapa) cuya
    // esquina real terminaba a 20-30px del punto fusionado nunca calificaba
    // para el snap, y su unión con las demás quedaba con un hueco visible o
    // directamente sin pegar (flotando). Guardamos el peor caso encadenando
    // el "reach" ya acumulado de cada miembro (que puede ser, a su vez, un
    // cluster de la primera pasada) más la distancia de ese miembro al nuevo
    // centro.
    let reach = 0;
    members.forEach(p => {
      const d = Math.hypot(p.x - fx, p.y - fy) + (p.reach || 0);
      if (d > reach) reach = d;
    });
    clusters.push({ x: fx, y: fy, ids: Array.from(ids), reach });
  }
  return clusters.filter(c => c.ids.length >= 3);
}

/* ============================================================
   MEJORA 1: fusión automática de regiones diminutas (ruido)
   Cualquier huequito donde varias líneas de pliegue no cierran en un punto
   matemáticamente perfecto queda como su propia "máscara" de unos pocos
   píxeles. Esta función las detecta (área muy chica respecto a la mediana
   de las máscaras reales) y las fusiona con el vecino real con el que
   comparten más borde, en vez de dejarlas como paneles fantasma.
============================================================ */
function mergeTinyMasks(labels, masks, adjacency, exteriorId, w, h) {
  const nonExterior = masks.filter(m => m.id !== exteriorId);
  if (nonExterior.length < 2) return { merges: [] };

  const areas = nonExterior.map(m => m.area).slice().sort((a,b) => a-b);
  const median = areas[Math.floor(areas.length/2)] || 0;
  // una región se considera "ruido" si es muchísimo más chica que el panel típico
  // de esta plantilla (o si es diminuta en términos absolutos, para plantillas
  // con paneles ya de por sí chicos)
  const minAreaPx = Math.max(15, median * 0.04);

  const tinySet = new Set(nonExterior.filter(m => m.area < minAreaPx).map(m => m.id));
  if (!tinySet.size) return { merges: [] };

  function bestNeighbor(id) {
    let best = null, bestCount = 0;
    for (const e of adjacency.values()) {
      if (e.ids[0] !== id && e.ids[1] !== id) continue;
      const other = e.ids[0] === id ? e.ids[1] : e.ids[0];
      if (other === exteriorId) continue;
      if (e.count > bestCount) { bestCount = e.count; best = other; }
    }
    return best;
  }
  // respaldo si una máscara diminuta no quedó registrada en la adyacencia
  // (borde compartido demasiado corto para pasar el filtro de ruido de scanAdjacency):
  // usamos la más cercana por centroide.
  function nearestByCentroid(id) {
    const src = nonExterior.find(m => m.id === id);
    let best = null, bestD = Infinity;
    nonExterior.forEach(m => {
      if (m.id === id) return;
      const d = Math.hypot(m.centroid.x-src.centroid.x, m.centroid.y-src.centroid.y);
      if (d < bestD) { bestD = d; best = m.id; }
    });
    return best;
  }

  const resolve = new Map();
  tinySet.forEach(id => {
    const nb = bestNeighbor(id);
    resolve.set(id, nb !== null ? nb : nearestByCentroid(id));
  });

  // resuelve cadenas (una máscara chica fusionándose con otra que también es chica)
  // hasta llegar a un destino final que no sea, a su vez, diminuto
  function finalTarget(id) {
    const seen = new Set();
    let cur = id;
    while (tinySet.has(cur) && resolve.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = resolve.get(cur);
    }
    return cur;
  }

  const merges = [];
  tinySet.forEach(id => {
    const target = finalTarget(id);
    if (target !== null && target !== id) {
      const srcMask = nonExterior.find(m => m.id === id);
      merges.push({ from: id, to: target, area: srcMask ? srcMask.area : 0 });
    }
  });
  if (!merges.length) return { merges: [] };

  const relabel = new Map(merges.map(m => [m.from, m.to]));
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (relabel.has(id)) labels[i] = relabel.get(id);
  }
  return { merges };
}

/* Dirección principal (PCA 2x2) de un set de puntos */
function principalDirection(pts) {
  if (pts.length < 2) return {x:1,y:0};
  let mx=0,my=0;
  pts.forEach(p=>{mx+=p.x;my+=p.y;});
  mx/=pts.length; my/=pts.length;
  let sxx=0, syy=0, sxy=0;
  pts.forEach(p=>{ const dx=p.x-mx, dy=p.y-my; sxx+=dx*dx; syy+=dy*dy; sxy+=dx*dy; });
  sxx/=pts.length; syy/=pts.length; sxy/=pts.length;
  if (Math.abs(sxx)<1e-6 && Math.abs(syy)<1e-6 && Math.abs(sxy)<1e-6) return {x:1,y:0};
  const theta = 0.5 * Math.atan2(2*sxy, sxx-syy);
  return { x: Math.cos(theta), y: Math.sin(theta) };
}

/* ============================================================
   3) METADATOS POR MÁSCARA (rol / padre / ángulo) + sugerencia de árbol
============================================================ */
function initMeta() {
  state.meta = new Map();
  if (!state.masks.length) return;
  let baseId = state.masks[0].id, bestArea = -1;
  state.masks.forEach(m => { if (m.area > bestArea) { bestArea = m.area; baseId = m.id; } });
  state.masks.forEach((m, i) => {
    state.meta.set(m.id, {
      name: 'Máscara ' + (i+1),
      // rol provisional; recomputeSuggestedTree() lo afina abajo (pared vs
      // solapa) una vez que sabe qué máscaras terminan siendo hojas del árbol
      role: m.id === baseId ? 'base' : 'pared',
      parent: null,
      angle: m.id === baseId ? 0 : 90,
      color: COLORS[i % COLORS.length],
      roleConfirmed: false, // true en cuanto el usuario toca el rol a mano
      angleConfirmed: false, // true en cuanto el usuario toca el ángulo a mano
      curved: false, // true si el usuario marcó esta máscara como "pliegue curvo" (ver toggleCurved)
      extras: [], // campos personalizados agregados a mano: {eid, type:'texto'|'png'|'nombre'|'edad', value}
    });
  });
  recomputeSuggestedTree(baseId);
}

/* Sugiere un ángulo de plegado por default según el TIPO de bisagra:
   - pared cuyo padre es la Base: es el pliegue "de levantamiento" real
     contra el piso -> 90° tiene sentido.
   - pared cuyo padre es OTRA pared (gajo de un mismo abanico, ej. el
     árbol 1←2←3←4←Base): estas no son bisagras independientes, son
     rotaciones ENCADENADAS relativas a la anterior. Si cada una suma
     otros 90°, el ángulo se va acumulando gajo a gajo (90°, 180°, 270°...)
     y el gajo más profundo de la cadena termina enroscado, pisando a
     los anteriores — que es exactamente el overlap que se vio en el
     visor. Un default bajo (chico) es un punto de partida razonable
     para que el abanico se abra en vez de enroscarse; el usuario lo
     termina de afinar a mano según la pieza real.
   - solapa: son tabs de pegado, se dejan en 90° (pliegan contra la
     pared a la que pertenecen; su función es superponerse a propósito).
   Solo se tocan ángulos no confirmados a mano (angleConfirmed=false). */
const FAN_CHAIN_ANGLE_DEFAULT = 25;
function suggestAnglesFromTree(rootId) {
  state.meta.forEach((meta, id) => {
    if (id === rootId || meta.angleConfirmed || meta.role === 'ignorar') return;
    if (meta.role === 'base') { meta.angle = 0; return; }
    if (meta.role === 'solapa') { meta.angle = 90; return; }
    // pared
    const parentMeta = (meta.parent !== null && meta.parent !== undefined) ? state.meta.get(meta.parent) : null;
    const parentIsFanSibling = parentMeta && parentMeta.role === 'pared';
    meta.angle = parentIsFanSibling ? FAN_CHAIN_ANGLE_DEFAULT : 90;
  });
}

function neighborsOf(id) {
  const out = [];
  for (const [key, e] of state.adjacency) {
    const [a,b] = e.ids;
    if (a === id) out.push(b);
    else if (b === id) out.push(a);
  }
  return out;
}

/* fuerza de la unión entre dos máscaras: cantidad de puntos de contorno
   compartidos (más puntos = borde más largo/confiable = unión más sólida) */
function edgeWeight(a, b) {
  const e = state.adjacency.get(pairKey(a, b));
  return e ? e.count : 0;
}

function recomputeSuggestedTree(rootId) {
  // Árbol de expansión MÁXIMA (variante de Prim's): en cada paso, de todas
  // las máscaras que todavía no están en el árbol, se agrega la que tenga
  // la unión más fuerte (edgeWeight más alto) con alguna máscara YA en el
  // árbol. Así cada máscara hereda de su vecino más sólido geométricamente,
  // en vez de heredar del primer vecino que apareció al escanear la imagen
  // (que es lo que hacía el BFS anterior y producía jerarquías sin sentido
  // físico, como abanicos enteros colgando directo de la Base).
  const inTree = new Set([rootId]);
  const remaining = new Set(state.masks.map(m => m.id));
  remaining.delete(rootId);

  while (remaining.size) {
    let bestChild = null, bestParent = null, bestWeight = -1;
    for (const id of remaining) {
      for (const nb of neighborsOf(id)) {
        if (!inTree.has(nb)) continue;
        const w = edgeWeight(id, nb);
        if (w > bestWeight) { bestWeight = w; bestChild = id; bestParent = nb; }
      }
    }
    if (bestChild === null) break; // el resto son inalcanzables (huérfanas, se avisa en la UI)
    const meta = state.meta.get(bestChild);
    if (meta && meta.role !== 'base') meta.parent = bestParent;
    inTree.add(bestChild);
    remaining.delete(bestChild);
  }

  suggestRolesFromTree(rootId);
}

/* Sugiere Pared vs Solapa según la posición final en el árbol, no según el
   grado crudo de adyacencia (que no distingue "toca a dos vecinos" de
   "sostiene estructuralmente a otra pieza"): una Solapa es, por definición,
   una pieza que se pliega pero de la que no cuelga ninguna otra; una Pared
   es cualquier máscara que sí es padre de al menos una hija en el árbol
   resultante. Solo se reclasifican las máscaras que el usuario no confirmó
   a mano (roleConfirmed=false), para no pisar ediciones manuales, ni las
   marcadas como "ignorar".
*/
function suggestRolesFromTree(rootId) {
  const hasChildren = new Set();
  state.meta.forEach((meta, id) => {
    if (id === rootId) return;
    if (meta.parent !== null && meta.parent !== undefined) hasChildren.add(meta.parent);
  });
  state.meta.forEach((meta, id) => {
    if (id === rootId || meta.roleConfirmed || meta.role === 'ignorar') return;
    meta.role = hasChildren.has(id) ? 'pared' : 'solapa';
  });
  suggestAnglesFromTree(rootId);
}

function wouldCreateCycle(childId, newParentId) {
  let cur = newParentId;
  const guard = new Set();
  while (cur !== null && cur !== undefined) {
    if (cur === childId) return true;
    if (guard.has(cur)) return true;
    guard.add(cur);
    const m = state.meta.get(cur);
    cur = m ? m.parent : null;
  }
  return false;
}

function edgeCounts(id) {
  let crease = 0;
  const total = neighborsOf(id).length;
  crease = total;
  return { crease };
}

/* ============================================================
   4) UI: lista de máscaras, notas de abanico, jerarquía
============================================================ */
const maskListEl = document.getElementById('maskList');
const fanNotesEl = document.getElementById('fanNotes');
const showIgnored = document.getElementById('showIgnored');
showIgnored.addEventListener('change', renderMaskList);

/* ============================================================
   PANEL "CONFIGURACIONES": el botón "Listo" vuelve a la vista "Diseño"
============================================================ */
(function(){
  const doneBtn = document.getElementById('uploadSettingsDoneBtn');
  const settingsPanel = document.getElementById('floatingPanelSettingsSection');
  const railItems = document.querySelectorAll('.floating-panel-rail .nav-item');
  const disenoItem = document.querySelector('.floating-panel-rail .nav-item[data-rail-view="diseno"]');
  if (!doneBtn) return;

  doneBtn.addEventListener('click', function(){
    if (settingsPanel) settingsPanel.style.display = 'none';
    if (disenoItem) disenoItem.click();
  });
})();

/* ============================================================
   Selector de categoría de #sidePanel2CategorySelect, vinculado con
   el menú de subcategorías de #plantillasCategoryWrap (Invitaciones,
   Deco, Multiusos, Plegables): mismo patrón que el selector de
   categorías del modal de Texturas.
============================================================ */
(function(){
  const categorySelect = document.getElementById('sidePanel2CategorySelect');
  const subcategoryMenu = document.querySelector('#plantillasCategoryWrap > div');
  if (!categorySelect) return;

  function syncCategorySelectFromSubcategories(){
    if (!subcategoryMenu) return;
    const currentValue = categorySelect.value;
    const newOption = categorySelect.querySelector('option[value="__new__"]');
    Array.prototype.slice.call(categorySelect.querySelectorAll('option')).forEach(function(opt){
      if (opt.value !== '' && opt.value !== '__new__') opt.remove();
    });
    Array.prototype.forEach.call(subcategoryMenu.querySelectorAll('.subcategory-btn'), function(btn){
      const nombre = btn.dataset.subcategory;
      if (!nombre) return; // se salta el botón "Todas"
      const opt = document.createElement('option');
      opt.value = nombre;
      opt.textContent = nombre;
      categorySelect.insertBefore(opt, newOption);
    });
    const stillExists = Array.prototype.some.call(categorySelect.options, function(opt){
      return opt.value === currentValue;
    });
    categorySelect.value = stillExists ? currentValue : '';
  }
  syncCategorySelectFromSubcategories();

  categorySelect.addEventListener('change', function(){
    if (categorySelect.value !== '__new__') return;

    let nombre = window.prompt('Nombre de la nueva categoría:');
    if (!nombre || !nombre.trim()){
      categorySelect.value = '';
      return;
    }
    nombre = nombre.trim();

    const existente = Array.prototype.find.call(categorySelect.options, function(opt){
      return opt.value !== '__new__' && opt.textContent === nombre;
    });
    if (existente){
      categorySelect.value = existente.value;
      return;
    }

    const nuevaOpcion = document.createElement('option');
    nuevaOpcion.value = nombre;
    nuevaOpcion.textContent = nombre;
    categorySelect.insertBefore(nuevaOpcion, categorySelect.querySelector('option[value="__new__"]'));
    categorySelect.value = nuevaOpcion.value;

    if (subcategoryMenu){
      const yaExisteBtn = Array.prototype.some.call(subcategoryMenu.querySelectorAll('.subcategory-btn'), function(b){
        return b.dataset.subcategory === nombre;
      });
      if (!yaExisteBtn){
        const nuevoBtn = document.createElement('button');
        nuevoBtn.type = 'button';
        nuevoBtn.className = 'subcategory-btn';
        nuevoBtn.dataset.subcategory = nombre;
        nuevoBtn.textContent = nombre;
        subcategoryMenu.appendChild(nuevoBtn);
      }
    }
  });
})();

/* "Opciones de visualización" (líneas / rotación / textura): en SuperImprimible
   viven en el popover de la tuerca (#foldOptionsPopover), ya manejado por el
   propio script de diseño — acá no hace falta duplicar el toggle. */

const masksConsoleEl = document.getElementById('masksConsole');
const masksConsoleWrapEl = document.getElementById('masksConsoleWrap');
const masksConsoleBarEl = document.getElementById('masksConsoleBar');
const copyMasksConsoleBtn = document.getElementById('copyMasksConsoleBtn');

// la barra entera (título + ícono) contrae/expande el contenido; el botón
// Copiar vive en la misma barra pero corta la propagación para no togglear
// el panel cada vez que se usa.
masksConsoleBarEl.addEventListener('click', () => {
  masksConsoleWrapEl.classList.toggle('collapsed');
});

copyMasksConsoleBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const text = masksConsoleEl.textContent;
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    // fallback por si el navegador bloquea la Clipboard API (ej. contexto no seguro)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e2) { /* noop */ }
    document.body.removeChild(ta);
  }
  copyMasksConsoleBtn.textContent = '✓ Copiado';
  copyMasksConsoleBtn.classList.add('copied');
  clearTimeout(copyMasksConsoleBtn._resetTimer);
  copyMasksConsoleBtn._resetTimer = setTimeout(() => {
    copyMasksConsoleBtn.textContent = 'Copiar';
    copyMasksConsoleBtn.classList.remove('copied');
  }, 1200);
});

/* Genera un volcado en texto plano de todo lo que hace falta para entender
   el estado de las máscaras: identidad, jerarquía (padre/rol/ángulo de
   plegado), y con qué otras máscaras colinda cada una (pliegues) y con qué
   fuerza (cantidad de puntos de borde compartidos). Pensado para que una IA
   (o una persona) pueda auditar rápido si la detección/jerarquía es correcta. */
function generateMasksReport() {
  if (!state.masks.length) return 'Sin datos todavía. Cargá una imagen y detectá máscaras primero.';

  const lines = [];
  const total = state.masks.length;
  const roleCounts = { base:0, pared:0, solapa:0, ignorar:0 };
  state.masks.forEach(m => {
    const meta = state.meta.get(m.id);
    if (meta) roleCounts[meta.role] = (roleCounts[meta.role] || 0) + 1;
  });

  lines.push(`# Reporte de máscaras — ${new Date().toLocaleString()}`);
  lines.push(`Total: ${total} máscara(s) | base:${roleCounts.base} pared:${roleCounts.pared} solapa:${roleCounts.solapa} ignorar:${roleCounts.ignorar}`);
  lines.push('');

  if (state.buildLogLines && state.buildLogLines.length) {
    lines.push('## Registro de construcción del modelo 3D');
    const iconFor = { err: '✗', ok: '✓', warnln: '⚠' };
    state.buildLogLines.forEach(({ msg, cls }) => lines.push(`${iconFor[cls] || '·'} ${msg}`));
    lines.push('');
  }

  if (state.mergeNotes && state.mergeNotes.length) {
    lines.push('## Notas de fusión (ruido)');
    state.mergeNotes.forEach(n => lines.push(`- ${n}`));
    lines.push('');
  }

  if (state.fanClusters && state.fanClusters.length) {
    lines.push('## Vértices compartidos (posibles abanicos de pliegue)');
    state.fanClusters.forEach(c => {
      const names = c.ids.map(id => (state.meta.get(id)||{name:'#'+id}).name).join(', ');
      lines.push(`- (${Math.round(c.x)},${Math.round(c.y)}): ${c.ids.length} máscaras convergen → ${names}`);
    });
    lines.push('');
  }

  lines.push('## Máscaras');
  state.masks.forEach(m => {
    const meta = state.meta.get(m.id);
    if (!meta) return;
    const parentName = (meta.parent !== null && meta.parent !== undefined)
      ? (state.meta.get(meta.parent)||{}).name || `#${meta.parent}`
      : '(ninguno)';
    const neighborIds = neighborsOf(m.id);
    const neighborDesc = neighborIds.length
      ? neighborIds.map(nid => {
          const nm = state.meta.get(nid);
          const key1 = `${Math.min(m.id,nid)}_${Math.max(m.id,nid)}`;
          const edge = state.adjacency.get(key1);
          const pts = edge ? edge.count : '?';
          return `${nm ? nm.name : '#'+nid}(${pts}pt)`;
        }).join(', ')
      : '(sin vecinos — borde de corte en todo su perímetro)';

    lines.push(`[#${m.id}] "${meta.name}"`);
    lines.push(`  rol: ${meta.role}${meta.roleConfirmed ? '' : ' (sugerido, sin confirmar)'}  |  padre: ${parentName}  |  ángulo de plegado: ${meta.angle}°${meta.curved ? ` (curvo, ${curveSegmentsFor(meta)} segmentos)` : ''}`);
    lines.push(`  área: ${Math.round(m.area)}px²  |  toca el borde de la imagen: ${m.touchesBorder ? 'sí' : 'no'}  |  centroide: (${Math.round(m.centroid.x)},${Math.round(m.centroid.y)})`);
    lines.push(`  pliegues (vecinos): ${neighborDesc}`);
    lines.push('');
  });

  lines.push('## Cómo leer esto');
  lines.push('- "pliegues (vecinos)" lista con qué otras máscaras comparte un borde de pliegue, y entre paréntesis cuántos puntos de contorno sostienen esa unión (más puntos = unión más confiable).');
  lines.push('- Una máscara sin vecinos está rodeada de líneas de corte; si se esperaba que se plegara con otra, revisar la detección de tinta/adjacencia.');
  lines.push('- "padre" refleja el árbol de plegado: al mover el slider, cada máscara pliega respecto a su padre según su ángulo.');

  return lines.join('\n');
}

function updateMasksConsole() {
  masksConsoleEl.textContent = generateMasksReport();
}

function renderFanNotes() {
  fanNotesEl.innerHTML = '';
  (state.mergeNotes || []).forEach(text => {
    const div = document.createElement('div');
    div.className = 'fanNote';
    div.textContent = 'ℹ ' + text;
    fanNotesEl.appendChild(div);
  });
  state.fanClusters.forEach(c => {
    const names = c.ids.map(id => (state.meta.get(id)||{name:'#'+id}).name).join(', ');
    const div = document.createElement('div');
    div.className = 'fanNote';
    div.textContent = `⚠ Vértice compartido (~${Math.round(c.x)},${Math.round(c.y)}): ${c.ids.length} máscaras convergen ahí (${names}). Revisá los ángulos de plegado de cada una — el sistema no puede adivinarlos solo de la imagen.`;
    fanNotesEl.appendChild(div);
  });
}

function renderMaskList() {
  updateMasksConsole();
  maskListEl.innerHTML = '';
  state.masks.forEach(m => {
    const meta = state.meta.get(m.id);
    if (!meta) return;
    if (meta.role === 'ignorar' && !showIgnored.checked) return;
    const card = document.createElement('div');
    card.className = 'maskCard' + (state.selectedId === m.id ? ' selected' : '') + (meta.role==='ignorar' ? ' ignored' : '') + (!meta.roleConfirmed ? ' suggested' : '');
    card.dataset.id = m.id;

    const top = document.createElement('div'); top.className = 'mcTop';
    const sw = document.createElement('div'); sw.className = 'mcSwatch'; sw.style.background = meta.color;
    const nameInput = document.createElement('input'); nameInput.className = 'mcName'; nameInput.value = meta.name;
    nameInput.addEventListener('input', () => { meta.name = nameInput.value; renderHierarchy(); });
    const edges = document.createElement('div'); edges.className = 'mcEdges';
    const ec = edgeCounts(m.id);
    edges.textContent = `${ec.crease} pliegue(s)`;
    top.appendChild(sw); top.appendChild(nameInput); top.appendChild(edges);
    if (!meta.roleConfirmed) {
      const sugBadge = document.createElement('span'); sugBadge.className = 'sugBadge'; sugBadge.textContent = '✨ sugerido';
      sugBadge.title = 'Rol propuesto automáticamente por el sistema. Cambialo o confirmalo con doble click en la máscara.';
      top.appendChild(sugBadge);
    }
    card.appendChild(top);

    const grid = document.createElement('div'); grid.className = 'mcGrid';

    const roleWrap = document.createElement('div');
    roleWrap.innerHTML = '<label class="field" style="margin:0 0 2px 0;">Rol</label>';
    const roleSel = document.createElement('select');
    [['base','Base'],['pared','Pared'],['solapa','Solapa'],['ignorar','Ignorar']].forEach(([v,l]) => {
      const o = document.createElement('option'); o.value=v; o.textContent=l; if (meta.role===v) o.selected=true;
      roleSel.appendChild(o);
    });
    roleSel.addEventListener('change', () => {
      setMaskRole(m.id, roleSel.value);
      renderMaskList(); renderHierarchy(); drawEditorOverlay();
    });
    roleWrap.appendChild(roleSel);
    grid.appendChild(roleWrap);

    const parentWrap = document.createElement('div');
    parentWrap.innerHTML = '<label class="field" style="margin:0 0 2px 0;">Padre</label>';
    const parentSel = document.createElement('select');
    const noneOpt = document.createElement('option'); noneOpt.value=''; noneOpt.textContent='— (raíz)';
    parentSel.appendChild(noneOpt);
    state.masks.forEach(other => {
      if (other.id === m.id) return;
      const om = state.meta.get(other.id);
      if (om.role === 'ignorar') return;
      const o = document.createElement('option'); o.value=other.id; o.textContent = om.name;
      if (meta.parent === other.id) o.selected = true;
      parentSel.appendChild(o);
    });
    parentSel.disabled = (meta.role === 'base');
    parentSel.addEventListener('change', () => {
      const val = parentSel.value === '' ? null : parseInt(parentSel.value,10);
      if (val !== null && wouldCreateCycle(m.id, val)) {
        alert('Esa asignación crearía un ciclo en el árbol. Elegí otro padre.');
        parentSel.value = meta.parent === null ? '' : String(meta.parent);
        return;
      }
      meta.parent = val;
      renderHierarchy();
    });
    parentWrap.appendChild(parentSel);
    grid.appendChild(parentWrap);

    card.appendChild(grid);

    const angleWrap = document.createElement('div');
    angleWrap.innerHTML = '<label class="field" style="margin:6px 0 2px 0;">Ángulo objetivo de plegado (°)</label>';
    const angleInput = document.createElement('input');
    angleInput.type = 'number'; angleInput.min = -180; angleInput.max = 180; angleInput.step = 1;
    angleInput.value = meta.angle;
    angleInput.disabled = (meta.role === 'base');
    angleInput.addEventListener('input', () => {
      meta.angle = parseFloat(angleInput.value) || 0;
      meta.angleConfirmed = true;
      syncAngleUI(m.id);
    });
    // rueda del mouse posada sobre el campo: +1°/-1° por click de rueda, ±10° con Shift.
    // preventDefault evita que la página haga scroll mientras se gira la rueda acá.
    angleInput.addEventListener('wheel', (e) => {
      if (meta.role === 'base') return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const result = adjustAngle(m.id, e.deltaY < 0 ? step : -step);
      if (result !== null) angleInput.value = result;
    }, { passive: false });
    angleWrap.appendChild(angleInput);
    card.appendChild(angleWrap);

    card.addEventListener('mouseenter', () => { state.hoverId = m.id; drawEditorOverlay(); });
    card.addEventListener('mouseleave', () => { state.hoverId = null; drawEditorOverlay(); });
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
      state.selectedId = m.id; renderMaskList(); renderHierarchy(); drawEditorOverlay();
    });

    maskListEl.appendChild(card);
  });
  renderHierarchyMaskActions();
}

const hierarchyMaskActionsEl = document.getElementById('hierarchyMaskActions');

function renderHierarchyMaskActions() {
  hierarchyMaskActionsEl.innerHTML = '';
  const id = state.selectedId;
  const meta = id !== null && id !== undefined ? state.meta.get(id) : null;
  if (!meta) return;

  const splitBtn = document.createElement('button');
  splitBtn.className = 'btn small secondary icon';
  splitBtn.textContent = '✂';
  splitBtn.title = 'Dividir máscara seleccionada';
  splitBtn.addEventListener('click', () => startSplitMode(id));

  const toggleIgnoreBtn = document.createElement('button');
  toggleIgnoreBtn.className = 'btn small secondary icon';
  toggleIgnoreBtn.textContent = '🗑';
  toggleIgnoreBtn.title = meta.role === 'ignorar' ? 'Incluir máscara seleccionada' : 'Excluir máscara seleccionada';
  toggleIgnoreBtn.addEventListener('click', () => {
    meta.role = meta.role === 'ignorar' ? 'pared' : 'ignorar';
    meta.roleConfirmed = true;
    renderMaskList(); renderHierarchy(); drawEditorOverlay();
  });

  hierarchyMaskActionsEl.appendChild(splitBtn);
  hierarchyMaskActionsEl.appendChild(toggleIgnoreBtn);
}

const hierarchyEl = document.getElementById('hierarchy');

// soltar en un espacio vacío del árbol (no sobre otro nodo) = quitar el padre (queda en la raíz)
hierarchyEl.addEventListener('dragover', (e) => {
  if (state.dragId === null || state.dragId === undefined) return;
  e.preventDefault();
});
hierarchyEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const draggedId = state.dragId;
  state.dragId = null;
  if (draggedId === null || draggedId === undefined) return;
  const draggedMeta = state.meta.get(draggedId);
  if (!draggedMeta || draggedMeta.role === 'base') return;
  draggedMeta.parent = null;
  draggedMeta.roleConfirmed = true;
  renderMaskList(); renderHierarchy(); drawEditorOverlay();
});

function renderHierarchy() {
  const el = hierarchyEl;
  el.innerHTML = '';
  if (!state.masks.length) { return; }
  const selectedInfoEl = document.getElementById('hierarchySelectedInfo');
  if (selectedInfoEl) {
    const selMeta = state.selectedId !== null ? state.meta.get(state.selectedId) : null;
    selectedInfoEl.textContent = selMeta ? `Seleccionada: ${selMeta.name}` : 'Ninguna máscara seleccionada';
  }
  const byParent = new Map();
  let rootId = null;
  state.masks.forEach(m => {
    const meta = state.meta.get(m.id);
    if (meta.role === 'ignorar') return;
    if (meta.role === 'base') rootId = m.id;
    const key = meta.parent === null || meta.parent === undefined ? 'null' : meta.parent;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(m.id);
  });
  function icon(role){ return role==='base'?'📦':role==='solapa'?'📎':'🧱'; }
  const roleLabels = { base:'Base', pared:'Pared', solapa:'Solapa', ignorar:'Ignorar' };

  function toggleMenu(type, id) {
    const cur = state.hierarchyMenu;
    state.hierarchyMenu = (cur && cur.type === type && cur.id === id) ? null : { type, id };
    renderHierarchy();
  }

  function makeNode(id, depth) {
    const meta = state.meta.get(id);
    const row = document.createElement('div');
    row.className = 'lvl' + (state.selectedId === id ? ' selected' : '');
    row.style.paddingLeft = (depth * 16) + 'px';
    row.dataset.id = id;
    row.draggable = meta.role !== 'base'; // la Base es la raíz fija, no se arrastra (pero sí recibe soltados)

    if (meta.role !== 'base') {
      const handle = document.createElement('span'); handle.className = 'dragHandle'; handle.textContent = '⠿';
      handle.title = 'Arrastrá para cambiar de padre';
      row.appendChild(handle);
    }
    const prefix = document.createElement('span'); prefix.className = 'lvlPrefix';
    prefix.textContent = (depth > 0 ? '└─ ' : '') + icon(meta.role);
    row.appendChild(prefix);

    // nombre: clickeable, abre el menú con la lista preestablecida (Fondo/Personaje/Color)
    const nameBtn = document.createElement('b');
    nameBtn.className = 'nameBtn';
    nameBtn.textContent = meta.name;
    nameBtn.title = 'Click para elegir un nombre de la lista';
    nameBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu('name', id); });
    row.appendChild(nameBtn);

    // rol: ahora es un botón que despliega el selector de rol
    const roleBtn = document.createElement('button'); roleBtn.type = 'button';
    roleBtn.className = 'badge-role roleBtn';
    roleBtn.textContent = meta.role;
    roleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu('role', id); });
    row.appendChild(roleBtn);

    // ángulo: ahora es un botón que despliega una barra deslizante
    const angleBtn = document.createElement('button'); angleBtn.type = 'button';
    angleBtn.className = 'badge-role angleBtn';
    angleBtn.textContent = `${meta.angle}°`;
    angleBtn.disabled = (meta.role === 'base');
    angleBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu('angle', id); });
    // rueda del mouse posada sobre el botón "X°": ajusta el ángulo sin necesidad de
    // abrir el panel desplegable. +1°/-1° por click de rueda, ±10° con Shift.
    angleBtn.addEventListener('wheel', (e) => {
      if (meta.role === 'base') return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.shiftKey ? 10 : 1;
      adjustAngle(id, e.deltaY < 0 ? step : -step);
    }, { passive: false });
    row.appendChild(angleBtn);

    // "¿pliegue curvo?": subdivide el panel en varias tiras con bisagras propias
    // (cantidad calculada automáticamente a partir del ángulo, ver curveSegmentsFor)
    // para aproximar visualmente un pliegue redondeado en vez de uno recto/angulado.
    // No aplica a la Base (no tiene bisagra) ni a solapas/gajos con agujero.
    const curveBtn = document.createElement('button'); curveBtn.type = 'button';
    curveBtn.className = 'badge-role curveBtn' + (meta.curved ? ' active' : '');
    curveBtn.textContent = '⌒';
    curveBtn.title = meta.curved
      ? 'Pliegue curvo activado — click para volver a pliegue recto'
      : 'Marcar como pliegue curvo (ej. lados redondeados de una caja almohada)';
    curveBtn.disabled = (meta.role === 'base');
    curveBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleCurved(id); });
    row.appendChild(curveBtn);

    // hover sincronizado con el resaltado en el lienzo 2D
    row.addEventListener('mouseenter', () => { state.hoverId = id; drawEditorOverlay(); });
    row.addEventListener('mouseleave', () => { state.hoverId = null; drawEditorOverlay(); });

    // rueda del mouse posada sobre toda la fila (no solo el botón "X°"): ajusta
    // el ángulo igual que la rueda sobre el botón. El listener del botón usa
    // stopPropagation, así que no se dispara dos veces cuando el mouse está
    // justo sobre el botón.
    row.addEventListener('wheel', (e) => {
      if (meta.role === 'base') return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      adjustAngle(id, e.deltaY < 0 ? step : -step);
    }, { passive: false });

    // click selecciona la máscara, igual que clickear en el lienzo o en la lista
    row.addEventListener('click', () => { state.selectedId = id; renderMaskList(); renderHierarchy(); drawEditorOverlay(); });

    row.addEventListener('dragstart', (e) => {
      state.dragId = id;
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      el.querySelectorAll('.lvl.dropTarget').forEach(n => n.classList.remove('dropTarget'));
    });
    row.addEventListener('dragover', (e) => {
      if (state.dragId === null || state.dragId === undefined || state.dragId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('dropTarget');
    });
    row.addEventListener('dragleave', () => row.classList.remove('dropTarget'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation(); // evita que el drop también dispare el handler del contenedor #hierarchy
      row.classList.remove('dropTarget');
      const draggedId = state.dragId;
      state.dragId = null;
      if (draggedId === null || draggedId === undefined || draggedId === id) return;
      const draggedMeta = state.meta.get(draggedId);
      if (!draggedMeta || draggedMeta.role === 'base') return; // la Base no cambia de padre
      if (wouldCreateCycle(draggedId, id)) {
        alert('Esa asignación crearía un ciclo en el árbol. Elegí otro destino.');
        return;
      }
      draggedMeta.parent = id;
      draggedMeta.roleConfirmed = true;
      renderMaskList(); renderHierarchy(); drawEditorOverlay();
    });

    return { row };
  }

  function walk(id, depth) {
    const { row } = makeNode(id, depth);
    el.appendChild(row);
    (byParent.get(id) || []).forEach(childId => walk(childId, depth + 1));
  }

  if (rootId !== null) {
    walk(rootId, 0);
    // huérfanos (sin padre, no son la base)
    (byParent.get('null') || []).forEach(id => { if (id !== rootId) walk(id, 0); });
  } else {
    const warn = document.createElement('div');
    warn.className = 'lvl'; warn.style.color = 'var(--warn)';
    warn.textContent = 'No hay ninguna máscara marcada como Base.';
    el.appendChild(warn);
  }

  // renderHierarchy() se llama después de todo cambio estructural relevante
  // (padre, rol, nombre, split, drag&drop, auto-organizar) — así que engancharse
  // acá cubre automáticamente la reconstrucción del modelo 3D sin tener que
  // acordarse de llamarla desde cada uno de esos puntos por separado.
  scheduleAutoBuild();
}

/* ============================================================
   5) EDITOR 2D: overlay de máscaras + clasificación corte/pliegue + split
============================================================ */
/* Pinta en blanco (limpia) los trazos acumulados en state.templateEraseStrokes
   sobre un contexto 2D que ya tiene dibujada la imagen fuente. Se llama
   siempre inmediatamente después de `ctx.drawImage(sourceImage, 0,0,w,h)` —
   tanto al segmentar como al redibujar el editor — así el "borrado" es
   parte real de la imagen que se analiza y se ve, no un simple filtro visual. */
function applyTemplateEraseStrokes(ctx, w, h) {
  const strokes = state.templateEraseStrokes;
  if (!strokes || !strokes.length) return;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokes.forEach(stroke => {
    const r = stroke.radius || 10;
    const pts = stroke.points;
    if (!pts || !pts.length) return;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, r, 0, Math.PI*2);
      ctx.fill();
      return;
    }
    ctx.lineWidth = r*2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  });
  ctx.restore();
}
function drawEditorOverlay() {
  if (!state.iw || !state.ih || !sourceImage) return;
  const w = state.iw, h = state.ih;
  ectx.clearRect(0,0,w,h);
  ectx.drawImage(sourceImage, 0, 0, w, h);
  applyTemplateEraseStrokes(ectx, w, h);

  if (state.labels) {
    // overlay de color por máscara + fondo exterior transparente (no se ve la "hoja" blanca)
    const overlay = ectx.getImageData(0,0,w,h);
    for (let i=0;i<w*h;i++) {
      const id = state.labels[i];
      if (id === state.exteriorId) { overlay.data[i*4+3] = 0; continue; } // fuera del troquel: transparente
      if (id < 0) continue; // línea de tinta (corte/pliegue): se deja tal cual
      const meta = state.meta.get(id);
      if (!meta) continue;
      if (meta.role === 'ignorar' && !showIgnored.checked) continue;
      const isSel = (state.selectedId === id) || (state.hoverId === id);
      const alpha = isSel ? 0.42 : 0.20;
      const rgb = hexToRgb(meta.color);
      const p = i*4;
      overlay.data[p]   = overlay.data[p]*(1-alpha) + rgb.r*alpha;
      overlay.data[p+1] = overlay.data[p+1]*(1-alpha) + rgb.g*alpha;
      overlay.data[p+2] = overlay.data[p+2]*(1-alpha) + rgb.b*alpha;
    }
    // clasificación de tinta: pliegue (celeste) / corte (rojo)
    if (state.inkClass) {
      for (let i=0;i<w*h;i++) {
        const c = state.inkClass[i];
        if (!c) continue;
        const p = i*4;
        if (c === 1) { overlay.data[p]=91; overlay.data[p+1]=214; overlay.data[p+2]=255; }
        else if (c === 2) { overlay.data[p]=255; overlay.data[p+1]=91; overlay.data[p+2]=110; }
      }
    }
    ectx.putImageData(overlay, 0, 0);

    // etiqueta de nombre en el centroide
    if (state.masks.length) state.masks.forEach(m => {
      const meta = state.meta.get(m.id);
      if (!meta || (meta.role==='ignorar' && !showIgnored.checked)) return;
      ectx.font = 'bold 12px Segoe UI, sans-serif';
      ectx.fillStyle = 'rgba(0,0,0,.7)';
      ectx.textAlign = 'center';
      ectx.fillText(meta.name, m.centroid.x+1, m.centroid.y+1);
      ectx.fillStyle = '#fff';
      ectx.fillText(meta.name, m.centroid.x, m.centroid.y);
    });
  }

  // puntos de split en progreso
  if (state.splitMode && state.splitPoints.length) {
    ectx.strokeStyle = '#ffcc55'; ectx.lineWidth = 2;
    ectx.beginPath();
    state.splitPoints.forEach((p,i)=>{ if(i===0) ectx.moveTo(p.x,p.y); else ectx.lineTo(p.x,p.y); });
    ectx.stroke();
    state.splitPoints.forEach(p=>{
      ectx.fillStyle = '#ffcc55';
      ectx.beginPath(); ectx.arc(p.x,p.y,3,0,Math.PI*2); ectx.fill();
    });
  }
}

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#',''),16);
  return { r:(v>>16)&255, g:(v>>8)&255, b:v&255 };
}

function parseRgbString(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return { r: 0, g: 0, b: 0 };
  const parts = m[1].split(',').map(s => parseFloat(s.trim()));
  return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0 };
}

function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('');
}

// Recolorea todos los paneles del modelo 3D (visor plegado) con el color actual de
// #sp2ColorPickerInput, para que el visor 3D coincida con el color puro del modelo 2D.
function applySp2ColorTo3DModel() {
  const sp2ColorPickerInput = document.getElementById('sp2ColorPickerInput');
  if (!sp2ColorPickerInput || typeof scene === 'undefined') return;
  const colorHex = sp2ColorPickerInput.value;
  scene.traverse(obj => {
    if (obj.userData.isPanel && obj.material) {
      const meta = state.meta.get(obj.userData.maskId);
      if (meta) meta.color = colorHex; // así una futura reconstrucción del modelo conserva el color elegido
      obj.material.color = useTexture ? new THREE.Color(0xffffff) : new THREE.Color(colorHex);
      obj.material.needsUpdate = true;
    }
  });
}

/* ============================================================
   VISTA "DISEÑO" ACTIVA => MODELO 2D EN COLOR PURO
   Cuando el ítem del riel "#floatingPanelRail > div.nav-item.active"
   corresponde a la vista Diseño, #editorCanvas muestra la silueta de
   la plantilla (el mismo modelo 2D detectado) rellena por completo con
   el color configurado en #sp2ColorPickerInput, en vez del overlay semitransparente
   habitual. El exterior del troquel queda transparente y las líneas de
   tinta (corte/pliegue) se conservan tal como vienen de la imagen.
   Si todavía no hay una plantilla detectada, se pinta el canvas entero.
   Al salir de esa vista se restaura el render normal del editor.
============================================================ */
let disenoViewActive = true; // coincide con el estado inicial del riel (Diseño activo por defecto en el HTML)

function fillEditorCanvasWithSp2Color() {
  const sp2ColorPickerInput = document.getElementById('sp2ColorPickerInput');
  if (!sp2ColorPickerInput || !editorCanvas.width || !editorCanvas.height) return;

  if (!sourceImage) {
    // No hay ninguna imagen/plantilla cargada: el canvas debe permanecer oculto.
    editorCanvas.classList.remove('has-image');
    if (dropHint) dropHint.style.display = '';
    return;
  }

  const color = sp2ColorPickerInput.value;
  const w = editorCanvas.width, h = editorCanvas.height;

  if (state.labels) {
    // Hay una plantilla/modelo 2D detectado: pintamos su silueta en color puro,
    // conservando el contorno (líneas de corte/pliegue) y dejando el exterior transparente.
    const rgb = hexToRgb(color);
    // #contourLinesToggle (Configuraciones) / #toggleLines (popover 3D, sincronizados
    // entre sí): si están desactivados, las líneas de tinta (corte/pliegue) trazadas en
    // la imagen original NO deben verse aquí tampoco — se rellenan con el mismo color
    // puro de la pieza en vez de dejarse "tal cual", así el contorno queda invisible.
    const contourToggleEl = document.getElementById('contourLinesToggle');
    const showContourLines = contourToggleEl ? contourToggleEl.checked : true;
    ectx.clearRect(0, 0, w, h);
    ectx.drawImage(sourceImage, 0, 0, w, h);
    applyTemplateEraseStrokes(ectx, w, h);
    const overlay = ectx.getImageData(0, 0, w, h);
    for (let i = 0; i < w*h; i++) {
      const id = state.labels[i];
      const p = i*4;
      if (id === state.exteriorId) { overlay.data[p+3] = 0; continue; } // fuera del troquel: transparente
      if (id < 0) {
        if (showContourLines) continue; // línea de tinta (corte/pliegue): se deja tal cual
        overlay.data[p] = rgb.r; overlay.data[p+1] = rgb.g; overlay.data[p+2] = rgb.b; overlay.data[p+3] = 255;
        continue;
      }
      const meta = state.meta.get(id);
      if (meta && meta.role === 'ignorar' && !showIgnored.checked) continue;
      overlay.data[p] = rgb.r; overlay.data[p+1] = rgb.g; overlay.data[p+2] = rgb.b; overlay.data[p+3] = 255;
    }
    ectx.putImageData(overlay, 0, 0);
  } else {
    // Hay imagen pero todavía no se detectó la plantilla: pintamos el canvas completo en color puro.
    ectx.clearRect(0, 0, w, h);
    ectx.fillStyle = color;
    ectx.fillRect(0, 0, w, h);
  }
  editorCanvas.classList.add('has-image');
  if (dropHint) dropHint.style.display = 'none'; // no tapamos el color puro con el prompt de carga
}

document.addEventListener('sp:disenoViewChanged', (e) => {
  disenoViewActive = !!(e.detail && e.detail.active);
  if (disenoViewActive) {
    fillEditorCanvasWithSp2Color();
  } else if (sourceImage) {
    drawEditorOverlay();
  } else {
    editorCanvas.classList.remove('has-image');
    if (dropHint) dropHint.style.display = '';
  }
});

// Si el color de #sp2ColorPickerInput cambia, refrescamos el canvas 2D (cuando Diseño está
// visible) y también recoloreamos el modelo 3D, que hasta ahora se quedaba sin cambios.
(function(){
  const sp2ColorPickerInputEl = document.getElementById('sp2ColorPickerInput');
  if (!sp2ColorPickerInputEl) return;
  sp2ColorPickerInputEl.addEventListener('input', () => {
    if (disenoViewActive) fillEditorCanvasWithSp2Color();
    applySp2ColorTo3DModel();
  });
})();

// Pintado inicial: si al cargar la página la vista Diseño ya está activa (como por defecto en el HTML).
if (disenoViewActive) fillEditorCanvasWithSp2Color();

/* click en el canvas 2D: selecciona máscara, o coloca puntos de split.
   En modo borrador (state.eraseMode) el click no hace nada acá: el borrado
   se maneja íntegramente con los eventos de puntero de más abajo (pincel). */
editorCanvas.addEventListener('click', (e) => {
  if (state.eraseMode) return;
  const rect = editorCanvas.getBoundingClientRect();
  const x = Math.round((e.clientX-rect.left) * (editorCanvas.width/rect.width));
  const y = Math.round((e.clientY-rect.top) * (editorCanvas.height/rect.height));
  if (state.splitMode) {
    state.splitPoints.push({x,y});
    if (state.splitPoints.length === 2) confirmSplit();
    else drawEditorOverlay();
    return;
  }
  if (!state.labels) return;
  const id = state.labels[y*state.iw+x];
  if (id >= 0 && id !== state.exteriorId && state.meta.has(id)) {
    if (e.shiftKey) {
      // Shift+click: cicla el rol de la máscara clickeada directamente en el canvas
      cycleRole(id);
    } else if ((e.ctrlKey || e.metaKey) && state.selectedId !== null && state.selectedId !== id) {
      // Ctrl/Cmd+click: asigna la máscara previamente seleccionada como padre de esta
      const meta = state.meta.get(id);
      if (meta.role !== 'base') {
        if (wouldCreateCycle(id, state.selectedId)) {
          alert('Esa asignación crearía un ciclo en el árbol. Elegí otra máscara como padre.');
        } else {
          meta.parent = state.selectedId;
          renderHierarchy();
        }
      }
    } else {
      state.selectedId = id;
    }
    renderMaskList();
    renderHierarchy();
    drawEditorOverlay();
  }
});

/* ============================================================
   BORRADOR TIPO PINCEL de la plantilla (#sp2EraserToolBtn, fila TEXTURA de
   #side-panel-2). A diferencia del ícono 🗑 de Jerarquía (que excluye una
   máscara completa), este borrador pinta directamente sobre la imagen
   fuente: cualquier trazo pintado se "limpia" (se vuelve blanco/fondo) antes
   de segmentar, así que se puede borrar solo la parte de un elemento que se
   filtró — una manchita, un resto de línea, etc. — sin tener que descartar
   toda la máscara a la que pertenece.
============================================================ */
const sp2EraserBtn = document.getElementById('sp2EraserToolBtn');
const sp2EraserUndoBtn = document.getElementById('sp2EraserUndoBtn');
const editorEraserCursor = document.getElementById('editorEraserCursor');

function syncEraserUndoBtn() {
  if (sp2EraserUndoBtn) sp2EraserUndoBtn.disabled = state.templateEraseStrokes.length === 0;
}

function templateEraserRadiusPx() {
  // Radio del pincel en píxeles de imagen (espacio de state.iw/state.ih),
  // proporcional al tamaño de la plantilla cargada para que el trazo se
  // sienta parecido sea cual sea la resolución de la imagen subida.
  const base = Math.min(state.iw || 640, state.ih || 480);
  return Math.max(5, Math.round(base * 0.018));
}

function setEraseMode(on) {
  state.eraseMode = !!on;
  if (sp2EraserBtn) {
    sp2EraserBtn.classList.toggle('active', state.eraseMode);
    sp2EraserBtn.setAttribute('aria-pressed', String(state.eraseMode));
  }
  editorCanvas.classList.toggle('erase-mode', state.eraseMode);
  if (!state.eraseMode && editorEraserCursor) editorEraserCursor.style.display = 'none';
}
if (sp2EraserBtn) {
  sp2EraserBtn.addEventListener('click', () => setEraseMode(!state.eraseMode));
}

// Redibuja lo que corresponda según la vista activa (color puro "Diseño" u
// overlay normal de máscaras), para que el trazo del pincel se vea en vivo.
function refreshEditorView() {
  if (disenoViewActive) fillEditorCanvasWithSp2Color();
  else drawEditorOverlay();
}

function imagePxFromEvent(e) {
  const rect = editorCanvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX-rect.left) * (editorCanvas.width/rect.width)),
    y: Math.round((e.clientY-rect.top) * (editorCanvas.height/rect.height))
  };
}

let activeEraseStroke = null;

function startEraseStroke(e) {
  if (!state.eraseMode || !sourceImage || !state.iw || !state.ih) return;
  const {x,y} = imagePxFromEvent(e);
  activeEraseStroke = { radius: templateEraserRadiusPx(), points: [{x,y}] };
  state.templateEraseStrokes.push(activeEraseStroke);
  syncEraserUndoBtn();
  editorCanvas.setPointerCapture(e.pointerId);
  refreshEditorView();
}
function extendEraseStroke(e) {
  if (!activeEraseStroke) return;
  const {x,y} = imagePxFromEvent(e);
  activeEraseStroke.points.push({x,y});
  refreshEditorView();
}
function endEraseStroke() {
  if (!activeEraseStroke) return;
  activeEraseStroke = null;
  // Recién al soltar se vuelve a correr la segmentación completa (es una
  // operación más pesada): mientras se arrastra el pincel, sólo se repinta
  // el canvas para que el trazo blanco se vea al instante.
  triggerAutoSegment();
}

editorCanvas.addEventListener('pointerdown', (e) => {
  if (!state.eraseMode || e.button !== 0) return;
  e.preventDefault();
  startEraseStroke(e);
});
editorCanvas.addEventListener('pointermove', (e) => {
  if (state.eraseMode && editorEraserCursor) {
    const rect = editorCanvas.getBoundingClientRect();
    const diameterCss = templateEraserRadiusPx() * 2 * (rect.width / editorCanvas.width);
    editorEraserCursor.style.width = diameterCss + 'px';
    editorEraserCursor.style.height = diameterCss + 'px';
    editorEraserCursor.style.left = e.clientX + 'px';
    editorEraserCursor.style.top = e.clientY + 'px';
    editorEraserCursor.style.display = 'block';
  }
  if (activeEraseStroke) extendEraseStroke(e);
});
editorCanvas.addEventListener('pointerup', endEraseStroke);
editorCanvas.addEventListener('pointercancel', endEraseStroke);
editorCanvas.addEventListener('pointerleave', () => {
  if (editorEraserCursor) editorEraserCursor.style.display = 'none';
  endEraseStroke();
});

// Botón "Deshacer" (#sp2EraserUndoBtn): quita el último trazo pintado con el
// pincel borrador y vuelve a segmentar, como si nunca se hubiera pintado.
if (sp2EraserUndoBtn) {
  sp2EraserUndoBtn.addEventListener('click', () => {
    if (!state.templateEraseStrokes.length) return;
    state.templateEraseStrokes.pop();
    syncEraserUndoBtn();
    refreshEditorView();
    triggerAutoSegment();
  });
}

/* doble click en el canvas 2D: fija la máscara clickeada como "Base" de forma estable */
editorCanvas.addEventListener('dblclick', (e) => {
  if (state.splitMode || !state.labels) return;
  const rect = editorCanvas.getBoundingClientRect();
  const x = Math.round((e.clientX-rect.left) * (editorCanvas.width/rect.width));
  const y = Math.round((e.clientY-rect.top) * (editorCanvas.height/rect.height));
  const id = state.labels[y*state.iw+x];
  if (id >= 0 && id !== state.exteriorId && state.meta.has(id)) {
    setMaskRole(id, 'base');
    state.selectedId = id;
    renderMaskList();
    renderHierarchy();
    drawEditorOverlay();
  }
});

/* Ajusta el ángulo objetivo de plegado de una máscara en vivo (rueda del mouse
   sobre el árbol/tarjeta, o arrastre directo en el modelo 3D). Centraliza la
   lógica para que ambas entradas queden siempre sincronizadas entre sí y con
   el modelo 3D construido. */
function adjustAngle(id, deltaDeg) {
  const meta = state.meta.get(id);
  if (!meta || meta.role === 'base') return null;
  const next = Math.max(-180, Math.min(180, Math.round(meta.angle + deltaDeg)));
  if (next === meta.angle) return meta.angle;
  meta.angle = next;
  meta.angleConfirmed = true;
  syncAngleUI(id);
  return meta.angle;
}

/* Cantidad de segmentos para aproximar un pliegue curvo (ver toggleCurved /
   buildCurvedPanel), calculada automáticamente — no se le pide al usuario un
   número porque en la práctica nadie sabe si "4" o "7" cortes es lo correcto
   para una máscara puntual. Dos variables entran en juego:
   - el ángulo de pliegue: cuanto más cerrado, más facetada se nota una
     aproximación con pocos segmentos (como un polígono aproximando un
     círculo: para 180° hacen falta más "lados" que para 30°).
   - un piso de 3 (mínimo para que se note algo de curva) y un techo de 10
     (para no disparar el conteo de triángulos si hay varias máscaras
     curvas juntas).
   Se recalcula cada vez que se reconstruye el modelo (scheduleAutoBuild),
   así que si el usuario cambia el ángulo de una máscara curva y eso dispara
   una reconstrucción, la cantidad de cortes se ajusta sola. */
function curveSegmentsFor(meta) {
  const absAngle = Math.abs((meta && meta.angle) || 0);
  return Math.max(3, Math.min(10, Math.round(absAngle / 12)));
}

/* Prende/apaga el flag "pliegue curvo" de una máscara (ver buildCurvedPanel).
   Es un cambio de GEOMETRÍA (subdivide o deja de subdividir el panel en
   varias tiras), así que dispara una reconstrucción completa igual que un
   cambio de rol/padre — a diferencia de un cambio de solo ángulo, que se
   aplica en vivo sin reconstruir nada (ver adjustAngle/syncAngleUI). */
function toggleCurved(id) {
  const meta = state.meta.get(id);
  if (!meta || meta.role === 'base') return;
  meta.curved = !meta.curved;
  const btn = hierarchyEl.querySelector(`.lvl[data-id="${id}"] .curveBtn`);
  if (btn) {
    btn.classList.toggle('active', meta.curved);
    btn.title = meta.curved
      ? 'Pliegue curvo activado — click para volver a pliegue recto'
      : 'Marcar como pliegue curvo (ej. lados redondeados de una caja almohada)';
  }
  scheduleAutoBuild();
}

/* Setea el ángulo a un valor absoluto (usado por el arrastre en 3D, que calcula
   el ángulo final en vez de un delta relativo). */
function setAngleAbsolute(id, angleDeg) {
  const meta = state.meta.get(id);
  if (!meta || meta.role === 'base') return null;
  const next = Math.max(-180, Math.min(180, Math.round(angleDeg)));
  if (next === meta.angle) return meta.angle;
  meta.angle = next;
  meta.angleConfirmed = true;
  syncAngleUI(id);
  return meta.angle;
}

/* Refleja meta.angle en todos los lugares donde se muestra (badge del árbol,
   input numérico de la tarjeta, panel desplegable de ángulo si está abierto)
   y reconstruye la pose 3D si el modelo ya está armado — sin forzar un
   re-render completo de listas/árbol, para que el arrastre/rueda se sienta fluido. */
function syncAngleUI(id) {
  const meta = state.meta.get(id);
  if (!meta) return;
  const treeBadge = hierarchyEl.querySelector(`.lvl[data-id="${id}"] .angleBtn`);
  if (treeBadge) treeBadge.textContent = `${meta.angle}°`;
  if (state.hierarchyMenu && state.hierarchyMenu.type === 'angle' && state.hierarchyMenu.id === id) {
    const angleRangeEl = hierarchyEl.querySelector('.hierPanel input[type="range"]');
    const label = hierarchyEl.querySelector('.hierPanel .hierPanelHead span');
    if (angleRangeEl) angleRangeEl.value = meta.angle;
    if (label) label.textContent = `Ángulo — ${meta.angle}°`;
  }
  const cardInput = maskListEl.querySelector(`.maskCard[data-id="${id}"] input[type="number"]`);
  if (cardInput && document.activeElement !== cardInput) cardInput.value = meta.angle;
  if (state.built) applyFold(currentFoldPercent / 100);
}

/* cicla el rol de una máscara: Base -> Pared -> Solapa -> Ignorar -> Base ...
   (si se asigna Base, la Base anterior pasa a Pared, igual que en el <select>) */
function cycleRole(id) {
  const meta = state.meta.get(id);
  if (!meta) return;
  const order = ['base', 'pared', 'solapa', 'ignorar'];
  const next = order[(order.indexOf(meta.role) + 1) % order.length];
  setMaskRole(id, next);
}

/* ============================================================
   RECONSTRUCCIÓN AUTOMÁTICA DEL MODELO 3D
   Antes había que apretar "Construir modelo 3D" a mano después de cada cambio
   de rol/padre/nombre/división. Ahora cualquier cambio ESTRUCTURAL (algo que
   cambia qué pieza es padre de qué otra, su rol, o su geometría) dispara esto,
   que reconstruye el modelo completo un ratito después (debounce) para no
   relanzar la reconstrucción en cada tecla o cada paso de un arrastre.
   Los cambios de SOLO ÁNGULO no pasan por acá: esos ya se aplican en vivo con
   applyFold() sin reconstruir nada (ver adjustAngle/setAngleAbsolute), porque
   no tocan la geometría, solo la rotación de un pivot ya existente. */
let autoBuildTimer = null;
const AUTO_BUILD_DEBOUNCE_MS = 220;
function scheduleAutoBuild() {
  if (!state.masks.length) return;
  clearTimeout(autoBuildTimer);
  autoBuildTimer = setTimeout(() => buildModel({ silent: true }), AUTO_BUILD_DEBOUNCE_MS);
}

/* aplica un nuevo rol a una máscara, con la misma lógica de reasignación de Base
   que usan el <select> de la sidebar, el ciclado por Shift+click y el árbol de jerarquía */
function setMaskRole(id, newRole) {
  const meta = state.meta.get(id);
  if (!meta) return;
  if (newRole === 'base') {
    state.masks.forEach(mm => {
      const mmeta = state.meta.get(mm.id);
      if (mmeta.role === 'base') {
        // la Base saliente pasa a Pared: su ángulo estaba forzado en 0° mientras
        // era Base (el input queda deshabilitado), así que sin este reset se
        // quedaría "plana" para siempre aunque ya no sea la raíz del árbol
        mmeta.role = 'pared';
        mmeta.angle = 90;
      }
    });
    meta.role = 'base'; meta.parent = null; meta.angle = 0;
    recomputeSuggestedTree(id);
  } else {
    meta.role = newRole;
  }
  meta.roleConfirmed = true;
  scheduleAutoBuild();
}

const splitBanner = document.getElementById('splitBanner');
document.getElementById('cancelSplitBtn').addEventListener('click', cancelSplitMode);

function startSplitMode(id) {
  state.splitMode = true;
  state.splitTargetId = id;
  state.splitPoints = [];
  if (typeof setEraseMode === 'function') setEraseMode(false);
  splitBanner.style.display = 'flex';
  drawEditorOverlay();
}
function cancelSplitMode() {
  state.splitMode = false;
  state.splitPoints = [];
  splitBanner.style.display = 'none';
  drawEditorOverlay();
}

function confirmSplit() {
  const [p1,p2] = state.splitPoints;
  // dibuja una línea gruesa de "tinta" entre los dos puntos (Bresenham + grosor)
  const w = state.iw, h = state.ih;
  const thickness = Math.max(1, Math.round(state.tolerance/2));
  bresenhamThick(p1.x,p1.y,p2.x,p2.y,thickness,(x,y)=>{
    if (x<0||y<0||x>=w||y>=h) return;
    // también lo pintamos en el canvas de trabajo para mantener todo consistente
  });
  // reconstruye el array `ink` quemando la línea, y re-corre toda la segmentación
  const ink = state.ink;
  bresenhamThick(p1.x,p1.y,p2.x,p2.y,thickness,(x,y)=>{
    if (x<0||y<0||x>=w||y>=h) return;
    ink[y*w+x] = 1;
  });
  cancelSplitMode();
  reRunFromInk();
}

function bresenhamThick(x0,y0,x1,y1,thickness,cb) {
  x0=Math.round(x0); y0=Math.round(y0); x1=Math.round(x1); y1=Math.round(y1);
  const dx = Math.abs(x1-x0), dy = -Math.abs(y1-y0);
  const sx = x0<x1?1:-1, sy = y0<y1?1:-1;
  let err = dx+dy, x=x0, y=y0;
  const r = Math.floor(thickness/2);
  while (true) {
    for (let ox=-r; ox<=r; ox++) for (let oy=-r; oy<=r; oy++) cb(x+ox,y+oy);
    if (x===x1 && y===y1) break;
    const e2 = 2*err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/* Re-corre flood fill + stats + contornos + adyacencia a partir del array ink actual
   (usado tras una división manual), preservando lo posible de los metadatos existentes
   por proximidad de centroide. */
function reRunFromInk() {
  const w = state.iw, h = state.ih;
  const oldMeta = new Map();
  state.masks.forEach(m => oldMeta.set(m.id, { centroid:m.centroid, meta: state.meta.get(m.id) }));

  const { labels, count } = floodFillLabels(state.ink, w, h);
  state.labels = labels;
  const masks = computeMaskStats(labels, count, w, h);
  const exteriorId = detectExterior(masks);
  state.exteriorId = exteriorId;

  const usePrecise = document.getElementById('preciseContour').checked;
  masks.forEach(m => {
    if (m.id === exteriorId) { m.isExterior = true; return; }
    m.isExterior = false;
    let contour = [];
    try {
      contour = usePrecise ? traceContour(labels, w, h, m.id) : null;
      if (!contour || contour.length < 3) {
        contour = bboxContour(m.bbox);
      } else {
        // ARREGLO: ver comentario equivalente en runSegmentation(). processContourWithHoles
        // preserva cualquier agujero interior (máscaras en forma de anillo) al simplificar.
        const { simplified, sharpened } = processContourWithHoles(contour);
        contour = contourAreaLooksValid(sharpened, m.area) ? sharpened : simplified;
      }
      if (!contourAreaLooksValid(contour, m.area)) {
        console.warn(`[visor3D] contorno de máscara id=${m.id} no coincide con su área real (trazado=${netContourArea(contour).toFixed(0)}px² vs real=${m.area}px²) — usando rectángulo de respaldo.`);
        contour = bboxContour(m.bbox);
      }
    } catch (err) { contour = bboxContour(m.bbox); }
    m.contour = contour;
  });

  const { adjacency, fanClusters, inkClass } = scanAdjacency(state.ink, labels, w, h, state.tolerance, exteriorId);
  state.adjacency = adjacency;
  state.fanClusters = fanClusters;
  state.inkClass = inkClass;
  state.masks = masks.filter(m => m.id !== exteriorId);

  // intenta preservar metadatos por cercanía de centroide (para no perder el trabajo del usuario)
  const newMeta = new Map();
  state.masks.forEach((m, i) => {
    let bestKey = null, bestDist = Infinity;
    for (const [oldId, info] of oldMeta) {
      const d = Math.hypot(info.centroid.x-m.centroid.x, info.centroid.y-m.centroid.y);
      if (d < bestDist) { bestDist = d; bestKey = oldId; }
    }
    const src = bestKey !== null && bestDist < 40 ? oldMeta.get(bestKey).meta : null;
    newMeta.set(m.id, {
      name: src ? src.name : ('Máscara ' + (i+1)),
      role: src ? src.role : 'pared',
      parent: null,
      angle: src ? src.angle : 90,
      color: src ? src.color : COLORS[i % COLORS.length],
      roleConfirmed: src ? !!src.roleConfirmed : false,
      angleConfirmed: src ? !!src.angleConfirmed : false,
      curved: src ? !!src.curved : false,
    });
  });
  state.meta = newMeta;
  let baseId = null;
  state.masks.forEach(m => { if (state.meta.get(m.id).role === 'base') baseId = m.id; });
  if (baseId === null && state.masks.length) {
    let bestArea=-1;
    state.masks.forEach(m=>{ if(m.area>bestArea){bestArea=m.area; baseId=m.id;} });
    state.meta.get(baseId).role = 'base'; state.meta.get(baseId).angle = 0;
  }
  if (baseId !== null) recomputeSuggestedTree(baseId);

  state.built = false;
  document.getElementById('empty3d').style.display = 'flex';
  document.getElementById('canvasHost').style.display = 'none';

  renderFanNotes();
  renderMaskList();
  renderHierarchy();
  drawEditorOverlay();
  recalcDimsFromMasks();
}

/* ============================================================
   6) TABS
============================================================ */
document.querySelectorAll('.tabBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabBtn').forEach(b=>b.classList.remove('active'));
    document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('pane-' + btn.dataset.tab).classList.add('active');
    resize3D();
  });
});

/* ============================================================
   7) MOTOR 3D (three.js)
============================================================ */
const host = document.getElementById('canvasHost');
const scene = new THREE.Scene();
scene.background = null; // transparente: se ve el fondo pastel de la ventana detrás
scene.fog = new THREE.Fog(0xeaf1f5, 1300, 2600);

const camera = new THREE.PerspectiveCamera(42, 1, 1, 5000);
camera.position.set(430, 380, 520);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
host.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 60, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.zoomSpeed = 0.7;
controls.minDistance = 80;
controls.maxDistance = 1600;

scene.add(new THREE.AmbientLight(0xfff6ea, 0.85));
const key = new THREE.DirectionalLight(0xffffff, 0.95);
key.position.set(300, 500, 260);
scene.add(key);
const fill = new THREE.DirectionalLight(0xbcd8ff, 0.4);
fill.position.set(-350, 200, -300);
scene.add(fill);

const grid = new THREE.GridHelper(1200, 24, 0xc9bfe0, 0xdcd3ea);
grid.material.transparent = true;
grid.material.opacity = 0.5;
grid.position.y = -0.5;
scene.add(grid);

let root = new THREE.Group();
root.name = 'Base (root)';
scene.add(root);

let modelTexture = null;
let nodesById = new Map();
// Lista plana de TODOS los pivots que deben rotar en cada frame de applyFold —
// tanto los "normales" (un pivot por máscara, fraction=1) como los internos de
// una cadena de pliegue curvo (varios pivots por máscara, cada uno con
// fraction=1/N, ver buildCurvedPanel). nodesById sigue mapeando 1 pivot "principal"
// por máscara (el primero de la cadena) para todo lo demás (highlight, drag, etc.)
let foldablePivots = [];
let useTexture = false;

/* ============================================================
   8) CONSTRUCCIÓN DINÁMICA DEL MODELO 3D A PARTIR DE LAS MÁSCARAS
============================================================ */
const buildBtn = document.getElementById('buildBtn');
buildBtn.addEventListener('click', () => buildModel());

/* El registro de construcción ya no tiene su propia cajita (#buildLog):
   se acumula en state.buildLogLines y se muestra como una sección más
   dentro de la consola de diagnóstico de máscaras (generateMasksReport()),
   así toda la info de "qué hizo el sistema" queda en un solo lugar. */
const MAX_BUILD_LOG_LINES = 80;
function log(msg, cls) {
  state.buildLogLines.push({ msg, cls });
  if (state.buildLogLines.length > MAX_BUILD_LOG_LINES) state.buildLogLines.shift();
}

function buildModel(opts) {
  const silent = !!(opts && opts.silent);
  state.buildLogLines = [];
  // limpia escena anterior
  while (root.children.length) root.remove(root.children[0]);
  nodesById = new Map();
  foldablePivots = [];

  if (!state.masks.length) { log('No hay máscaras detectadas.', 'err'); updateMasksConsole(); return; }

  console.log('[visor3D] Construyendo modelo con', state.masks.length, 'máscaras.');
  console.table(state.masks.map(m => ({
    id: m.id,
    nombre: state.meta.get(m.id).name,
    rol: state.meta.get(m.id).role,
    padre: state.meta.get(m.id).parent,
    angulo: state.meta.get(m.id).angle,
    puntosContorno: m.contour ? m.contour.length : 0,
    area: m.area,
  })));

  let baseMask = null;
  state.masks.forEach(m => { if (state.meta.get(m.id).role === 'base') baseMask = m; });
  if (!baseMask) {
    let bestArea = -1;
    state.masks.forEach(m => { if (m.area > bestArea) { bestArea = m.area; baseMask = m; } });
    state.meta.get(baseMask.id).role = 'base';
    log('No había ninguna máscara marcada como Base — se usó automáticamente la de mayor área.', 'warnln');
  }

  // valida ciclos y padres faltantes; corrige asignando huérfanos directo a la base
  const activeMasks = state.masks.filter(m => state.meta.get(m.id).role !== 'ignorar');
  activeMasks.forEach(m => {
    if (m.id === baseMask.id) return;
    const meta = state.meta.get(m.id);
    if (meta.parent === null || meta.parent === undefined) {
      log(`"${meta.name}" no tiene padre asignado — se conecta directo a la Base.`, 'warnln');
      meta.parent = baseMask.id;
    } else if (wouldCreateCycle(m.id, meta.parent)) {
      log(`"${meta.name}" tenía un padre que generaba un ciclo — se corrigió a la Base.`, 'warnln');
      meta.parent = baseMask.id;
    }
  });

  // transform global: escala e imagen -> mundo 3D.
  // Ancho/Alto reales (state.dims, panel "Medidas") mandan: el modelo se
  // escala de verdad a ese tamaño. Si el bbox de máscaras no es cuadrado
  // y el usuario desactivó el "Bloqueo de Proporcionalidad", widthCm y
  // heightCm pueden tener una relación distinta a la del dibujo original
  // — eso deforma la forma a propósito (escala no uniforme en X/Z).
  const imgW = state.iw, imgH = state.ih;
  const bbox = getMasksBBoxPx() || { width: imgW, height: imgH };
  const scaleX = (state.dims.widthCm * DIMS_WORLD_UNITS_PER_CM) / Math.max(1e-6, bbox.width);
  const scaleZ = (state.dims.heightCm * DIMS_WORLD_UNITS_PER_CM) / Math.max(1e-6, bbox.height);
  const refX = baseMask.centroid.x, refY = baseMask.centroid.y;
  const toWorld = (px, py) => ({ x: (px-refX)*scaleX, z: (refY-py)*scaleZ });

  // textura compartida (la imagen original completa)
  if (state.imageDataUrl) {
    modelTexture = new THREE.TextureLoader().load(state.imageDataUrl);
    modelTexture.colorSpace = THREE.SRGBColorSpace;
  }

  function childrenOf(id) {
    return activeMasks.filter(m => m.id !== baseMask.id && state.meta.get(m.id).parent === id);
  }

  // busca si el par (mask, parentMask) participa de un abanico detectado
  // (3+ máscaras convergiendo en un mismo punto de la imagen). Si es así,
  // anclamos la bisagra a ESE punto en vez de al centroide del borde
  // compartido: el centroide puede desviarse del vértice real cuando el
  // borde compartido es corto o curvo cerca de la punta, y esa desviación
  // es justamente lo que hacía que gajos vecinos del mismo abanico no
  // terminaran plegando hacia el mismo punto 3D (-> se pisaban).
  //
  // Esto SOLO tiene sentido para bordes cortos/de "toque" cerca de una punta:
  // un borde largo y bien muestreado (cientos de píxeles de tinta) ya tiene su
  // propia dirección y centro muy confiables por sí solo, y forzarlo a un
  // vértice de abanico —sobre todo si ese vértice queda lejos, en la otra
  // punta del borde— amplifica cualquier pequeño error angular en una
  // distancia grande, separando visualmente las piezas justo donde de verdad
  // se tocan. Probamos exactamente esto: forzar el anclaje también en bordes
  // largos (990px) hizo que MÁSCARA 3 y MÁSCARA 4 se separaran, y encima el
  // punto elegido saltaba entre reconstrucciones idénticas (inestable) cuando
  // el par coincidía con más de un vértice de abanico cercano entre sí. Por
  // eso ahora el corte es simple y determinístico: bordes cortos sí se
  // anclan al vértice (para que varios gajos cierren juntos en la punta);
  // bordes largos usan siempre su propio centroide, sin ambigüedad posible.
  const FAN_ANCHOR_MAX_EDGE_PTS = 150;
  function fanAnchorFor(idA, idB, edgeCount) {
    if (!state.fanClusters || !state.fanClusters.length) return null;
    if (edgeCount != null && edgeCount > FAN_ANCHOR_MAX_EDGE_PTS) return null;
    for (const c of state.fanClusters) {
      if (c.ids.includes(idA) && c.ids.includes(idB)) return c;
    }
    return null;
  }

  function hingeFor(mask, parentMask) {
    const key = pairKey(mask.id, parentMask.id);
    const e = state.adjacency.get(key);
    const fan = fanAnchorFor(mask.id, parentMask.id, e ? e.count : null);
    if (e && e.count > 0) {
      const ecx = e.sumx/e.count, ecy = e.sumy/e.count;
      const { dir, halfLen } = principalDirectionFromCounts(mask, parentMask, ecx, ecy, e);
      const cx = fan ? fan.x : ecx;
      const cy = fan ? fan.y : ecy;
      return { img: {x:cx,y:cy}, dir, precise:true, center:{x:ecx,y:ecy}, halfLen, usedFan: !!fan };
    }
    if (fan) {
      // sin adyacencia directa registrada, pero sí sabemos que comparten
      // un vértice de abanico: usamos ese punto como bisagra igual.
      const vx = mask.centroid.x - parentMask.centroid.x;
      const vy = mask.centroid.y - parentMask.centroid.y;
      const len = Math.hypot(vx,vy) || 1;
      return { img: {x:fan.x, y:fan.y}, dir: {x:-vy/len, y:vx/len}, precise:true, center:{x:fan.x,y:fan.y}, halfLen:6, usedFan:true };
    }
    // fallback: sin adyacencia real detectada (padre forzado manualmente) -> usamos el punto
    // del propio contorno de `mask` más cercano al centroide del padre. Se marca
    // precise:false porque no viene de una línea de tinta real detectada — no hay
    // nada confiable a lo que "pegar" los contornos en este caso (ver snapToHinge).
    let best = mask.contour[0], bestD = Infinity;
    mask.contour.forEach(p => {
      const d = Math.hypot(p.x-parentMask.centroid.x, p.y-parentMask.centroid.y);
      if (d < bestD) { bestD = d; best = p; }
    });
    return { img: best, dir: {x:1,y:0}, precise:false, usedFan:false };
  }

  // dirección real de la bisagra: PCA sobre los píxeles del borde compartido (guardados como
  // sumas de x, y, x², y², xy en scanAdjacency). El autovector principal de la matriz de covarianza
  // da la orientación real de la línea de pliegue, sin importar la forma del panel — mucho más
  // confiable que la perpendicular-entre-centroides para gajos angostos que convergen en un vértice.
  function principalDirectionFromCounts(mask, parentMask, cx, cy, e) {
    if (e && e.count >= 2) {
      const mxx = e.sumxx/e.count - cx*cx;
      const myy = e.sumyy/e.count - cy*cy;
      const mxy = e.sumxy/e.count - cx*cy;
      const varSum = mxx + myy;
      // si hay varianza medible (el borde no es un único punto), usamos el autovector principal
      if (varSum > 1e-6) {
        const theta = 0.5 * Math.atan2(2*mxy, mxx - myy);
        const dir = { x: Math.cos(theta), y: Math.sin(theta) };
        // varianza a lo largo del eje principal (autovalor mayor) -> una estimación de
        // cuánto se extiende realmente el borde compartido. Se usa para no "pegar"
        // puntos del contorno que están lejos de este borde en particular y sólo
        // pasan cerca de su línea (extendida al infinito) por casualidad — algo muy
        // común en un abanico, donde varias bisagras casi se alinean entre sí.
        const varAlong = (mxx+myy)/2 + Math.sqrt(Math.pow((mxx-myy)/2,2) + mxy*mxy);
        const halfLen = Math.sqrt(Math.max(varAlong,0)) * Math.sqrt(3) + 4;
        return { dir, halfLen };
      }
    }
    // fallback: perpendicular a la línea entre centroides (aproximación anterior, útil cuando
    // el borde compartido es demasiado chico para estimar una dirección confiable)
    const vx = mask.centroid.x - parentMask.centroid.x;
    const vy = mask.centroid.y - parentMask.centroid.y;
    const len = Math.hypot(vx,vy) || 1;
    return { dir: { x: -vy/len, y: vx/len }, halfLen: 6 };
  }

  // Precalcula la bisagra de cada máscara hacia su padre ANTES de construir
  // ninguna malla — el "pegado" de contornos de abajo necesita, para una
  // máscara que actúa de PADRE, conocer también las bisagras de TODOS sus
  // hijos, y eso no depende del orden en que se recorra el árbol.
  const hingeByMaskId = new Map();
  activeMasks.forEach(m => {
    if (m.id === baseMask.id) return;
    const parentMask = activeMasks.find(mm => mm.id === state.meta.get(m.id).parent) || baseMask;
    hingeByMaskId.set(m.id, hingeFor(m, parentMask));
  });

  // ---- Pegado de contornos a la línea exacta de cada bisagra ----
  // El trazo de contorno (traceContour) sigue el borde de la región rellena,
  // que queda pegado al COSTADO de la línea de tinta dibujada, no a su centro.
  // Como la bisagra se ancla al centro de esa tinta, sin este ajuste quedaba
  // un huequito del ancho de la línea entre cada gajo y el siguiente al
  // plegar. Acá, cualquier punto del contorno que esté a poca distancia de
  // una bisagra real (detectada, no la de fallback) se proyecta exactamente
  // sobre esa línea — se aplica tanto al hijo (su propia bisagra) como al
  // padre (las bisagras de cada uno de sus hijos), así ambos lados de cada
  // unión terminan pegados a la MISMA línea.
  const HINGE_SNAP_PX = Math.max(3, state.tolerance + 2);
  function snapToHinge(px, py, hinge, enforceExtent = true) {
    const dx = px - hinge.img.x, dy = py - hinge.img.y;
    const perp = dx*(-hinge.dir.y) + dy*hinge.dir.x;
    if (Math.abs(perp) > HINGE_SNAP_PX) return null;
    // además de estar cerca de la línea, el punto tiene que caer dentro del tramo
    // real del borde detectado (halfLen, medido desde su centroide real) — si no,
    // un punto de OTRA parte del contorno que por casualidad pasa cerca de esta
    // línea extendida al infinito (muy común en un abanico, donde varias bisagras
    // casi se alinean) terminaría pegado a un borde que no es el suyo.
    // Este chequeo solo tiene sentido cuando hay MÁS de una bisagra candidata
    // para el mismo punto (enforceExtent=true) — si es la única bisagra posible
    // no hay con qué confundirla, y aplicar igual el corte por halfLen podía
    // recortar puntos legítimos del propio borde (típico en un borde curvo,
    // donde el PCA subestima la extensión real) y deformar el panel.
    if (enforceExtent && hinge.halfLen != null && hinge.center) {
      const cdx = px - hinge.center.x, cdy = py - hinge.center.y;
      const t = cdx*hinge.dir.x + cdy*hinge.dir.y;
      if (Math.abs(t) > hinge.halfLen) return null;
    }
    const t2 = dx*hinge.dir.x + dy*hinge.dir.y;
    return { x: hinge.img.x + t2*hinge.dir.x, y: hinge.img.y + t2*hinge.dir.y };
  }
  function hingeLinesFor(mask) {
    const lines = [];
    if (mask.id !== baseMask.id) {
      const own = hingeByMaskId.get(mask.id);
      if (own && own.precise) lines.push(own);
    }
    childrenOf(mask.id).forEach(child => {
      const h = hingeByMaskId.get(child.id);
      if (h && h.precise) lines.push(h);
    });
    return lines;
  }

  // ---- Pegado de la punta compartida (vértice de abanico) ----
  // La posición/dirección de cada bisagra ahora se calcula SIEMPRE a partir de
  // su propio borde (ver hingeFor) — ya no se fuerza a un vértice de abanico,
  // porque eso amplificaba errores angulares en bordes largos y separaba
  // piezas (Máscara 3/Máscara 4). Pero eso solo, por sí solo, deja que gajos
  // vecinos de un mismo abanico (p. ej. Máscara 2 y Máscara 3) calculen cada
  // uno su propia recta de forma independiente — y aunque cada una sea
  // bastante precisa, pequeñas diferencias angulares entre ellas hacen que no
  // coincidan exactamente justo en la punta compartida, y ahí se pisan o se
  // separan. Acá se resuelve aparte: el vértice de la punta (el punto de
  // CONTORNO de cada máscara más cercano a un vértice de abanico del que
  // participa) se pega exactamente al mismo punto para TODAS las máscaras que
  // comparten ese vértice — así la punta cierra perfecto sin tocar el resto
  // del borde (que sigue la línea propia y precisa de cada bisagra).
  const FAN_VERTEX_SNAP_PX = HINGE_SNAP_PX * 3;
  function fanVerticesFor(mask) {
    if (!state.fanClusters) return [];
    return state.fanClusters.filter(c => c.ids.includes(mask.id));
  }

  // guarda, por cada máscara curva ya construida, la cadena de franjas que
  // buildCurvedPanel generó — así, cuando buildNode llega a un HIJO cuyo
  // padre es esa máscara curva, puede detectar si ese hijo se pega a lo
  // largo de la curva (unión lateral) en vez de cruzarla (ver más abajo).
  const curvedChainInfo = new Map();

  /* ============================================================
     UNIÓN LATERAL: una máscara (típicamente una solapa/pétalo de tapa) que
     se pega a lo largo de un borde PARALELO al eje de plegado de un padre
     curvo, en vez de cruzarlo. Un único pivote promedio no alcanza acá:
     cada punto de ese borde, tras plegar, arrastra un ángulo acumulado
     distinto (cada franja de la curva suma su propia rotación).
     Solución: se recorta el propio contorno de `mask` en las MISMAS N
     franjas (mismos límites de v) que el panel curvo del padre. Cada tramo
     se cuelga del pivote de SU segmento de curva (así hereda la rotación
     que la pared ya tiene ahí) y ADEMÁS tiene su PROPIA bisagra, sobre la
     línea real de unión, que pliega a su propio ángulo (meta.angle, el
     mismo que tendría un pliegue normal — p. ej. 90° si es solapa). Como
     el pivote propio cuelga DENTRO del pivote de la franja curva, las dos
     rotaciones se componen: el tramo primero "hereda" la curva ya plegada
     de la pared en ese punto, y luego pliega a sus propios grados sobre
     esa base — exactamente el orden que hace falta para que la tapa curva
     cierre bien en vez de quedar recta a 90° fijo.
  ============================================================ */
  function buildLateralChild(mask, parentMask, hinge, parentChain, maskName) {
    if (mask.contour.holes && mask.contour.holes.length) return null; // agujeros: no soportado acá todavía (igual que buildCurvedPanel)
    const { vx, vz, boundaries, strips, H } = parentChain;
    const relPoly = mask.contour.map(p => {
      let px = p.x, py = p.y;
      const snapped = snapToHinge(px, py, hinge, false);
      if (snapped) { px = snapped.x; py = snapped.y; }
      const w = toWorld(px, py);
      return { x: w.x - H.x, z: w.z - H.z, px, py };
    });
    const vFn = p => p.x*vx + p.z*vz;
    const N = strips.length;

    // dirección de la bisagra PROPIA de esta pieza (su pliegue real, no el
    // de la pared) — misma fórmula que usa buildNode para una bisagra
    // normal, aplicada a la bisagra real de esta máscara con su padre.
    let ownAx = hinge.dir.x, ownAz = -hinge.dir.y;
    const ownLen = Math.hypot(ownAx, ownAz) || 1;
    ownAx /= ownLen; ownAz /= ownLen;
    const HINGE_MATCH_PX = HINGE_SNAP_PX * 2;

    let anyBuilt = false, lastPivot = null, lastLo = 0;
    for (let k=0;k<N;k++) {
      const lo = boundaries[k], hi = boundaries[k+1];
      let piece = relPoly;
      if (k > 0) piece = clipPolyByPlane(piece, vFn, true, lo);
      if (k < N-1) piece = clipPolyByPlane(piece, vFn, false, hi);
      if (piece.length < 3) continue;
      const localPiece = piece.map(p => ({ x: p.x - lo*vx, z: p.z - lo*vz, px: p.px, py: p.py }));

      // ancla del pliegue propio de este tramo: promedio de los puntos que
      // caen sobre la línea real de la bisagra (relPoly ya los dejó
      // proyectados exactos ahí arriba, vía snapToHinge).
      const seamPts = localPiece.filter(p => {
        const dx = p.px - hinge.img.x, dy = p.py - hinge.img.y;
        const perp = dx*(-hinge.dir.y) + dy*hinge.dir.x;
        return Math.abs(perp) <= HINGE_MATCH_PX;
      });
      const anchor = seamPts.length
        ? { x: seamPts.reduce((s,p)=>s+p.x,0)/seamPts.length, z: seamPts.reduce((s,p)=>s+p.z,0)/seamPts.length }
        : { x: 0, z: 0 };

      // signo "hacia afuera" del pliegue propio: mismo criterio que
      // buildNode (el centroide del tramo debe quedar del lado +Y al
      // plegar en positivo), pero calculado en coordenadas locales de este
      // tramo, relativo a su propia ancla.
      const cx = localPiece.reduce((s,p)=>s+p.x,0)/localPiece.length;
      const cz = localPiece.reduce((s,p)=>s+p.z,0)/localPiece.length;
      let bax = ownAx, baz = ownAz;
      const crossY = baz*(cx-anchor.x) - bax*(cz-anchor.z);
      if (crossY < 0) { bax = -bax; baz = -baz; }

      const bandPivot = new THREE.Group();
      bandPivot.position.set(anchor.x, 0, anchor.z);
      bandPivot.userData.hingeAxis = new THREE.Vector3(bax, 0, baz).normalize();
      strips[k].pivot.add(bandPivot);
      // fraction=1: este tramo no se subdivide más — pliega de una vez a su
      // ángulo completo (meta.angle), igual que un pliegue normal.
      foldablePivots.push({ pivot: bandPivot, maskId: mask.id, fraction: 1 });

      const meshLocal = localPiece.map(p => ({ x: p.x - anchor.x, z: p.z - anchor.z, px: p.px, py: p.py }));
      try {
        const mesh = buildFlatMesh(meshLocal, [], mask, imgW, imgH, `${maskName} (unión seg ${k+1}/${N})`);
        bandPivot.add(mesh);
        mesh.userData.isPanel = true;
        mesh.userData.maskId = mask.id;
        mesh.name = maskName;
        bandPivot.add(buildContourLines(meshLocal, mask.id));
        anyBuilt = true;
        lastPivot = bandPivot;
        lastLo = lo;
      } catch (err) {
        console.warn(`[visor3D] "${maskName}" tramo lateral ${k+1}/${N} vacío/degenerado — se omite.`, err.message);
      }
    }
    if (!anyBuilt) return null;
    log(`"${maskName}": unión lateral detectada — repartida en ${N} tramo(s), cada uno con su propio pliegue sobre la curva ya plegada de "${state.meta.get(parentMask.id).name}".`, 'ok');
    return {
      reprPivot: lastPivot || strips[N-1].pivot,
      tipParent3D: lastPivot || strips[N-1].pivot,
      // aproximado (asume el propio pliegue en reposo/0°) — caso raro: algo
      // colgando a su vez de esta pieza. Igual de aproximado que el resto
      // de la cadena curva para hijos más allá del borde lejano.
      tipCumOrigin: { x: H.x + lastLo*vx, z: H.z + lastLo*vz },
    };
  }

  function buildNode(mask, parentObj3D, cumWorld, depth) {
    let pivot;
    let localOrigin;
    if (mask.id === baseMask.id) {
      pivot = root;
      localOrigin = { x:0, z:0 };
    } else {
      const parentMask = activeMasks.find(m => m.id === state.meta.get(mask.id).parent) || baseMask;
      const hinge = hingeByMaskId.get(mask.id);

      // ¿el padre es una pared curva y este borde corre A LO LARGO de su
      // curva (perpendicular al eje de bisagra del padre) en vez de
      // cruzarla? Si es así, esta máscara es una "unión lateral" (ver
      // buildLateralChild) y se maneja aparte, ANTES de crear el pivote
      // único de siempre.
      const parentChain = curvedChainInfo.get(parentMask.id);
      if (parentChain && hinge) {
        let pax = hinge.dir.x, paz = -hinge.dir.y;
        const pn = Math.hypot(pax, paz) || 1;
        pax /= pn; paz /= pn;
        const parentAxisLen = Math.hypot(parentChain.ax, parentChain.az) || 1;
        const dot = Math.abs((pax*parentChain.ax + paz*parentChain.az) / parentAxisLen);
        const LATERAL_DOT_MAX = 0.4; // <0.4 ~ a más de 66° del eje de bisagra del padre -> corre a lo largo de la curva
        if (dot < LATERAL_DOT_MAX) {
          const lateral = buildLateralChild(mask, parentMask, hinge, parentChain, state.meta.get(mask.id).name);
          if (lateral) {
            nodesById.set(mask.id, { pivot: lateral.reprPivot });
            childrenOf(mask.id).forEach(child => buildNode(child, lateral.tipParent3D, lateral.tipCumOrigin, depth+1));
            return;
          }
        }
      }

      if (hinge.usedFan) log(`"${state.meta.get(mask.id).name}": bisagra anclada a vértice de abanico compartido (${Math.round(hinge.img.x)},${Math.round(hinge.img.y)}).`, 'warnln');
      const H = toWorld(hinge.img.x, hinge.img.y);
      const localPos = { x: H.x - cumWorld.x, z: H.z - cumWorld.z };
      pivot = new THREE.Group();
      pivot.position.set(localPos.x, 0, localPos.z);

      // El PCA de hingeFor()/principalDirectionFromCounts() da la ORIENTACIÓN de la
      // línea de bisagra, pero no su sentido (theta y theta+180° describen la misma
      // línea). Sin corregir esto, el signo del eje queda prácticamente al azar por
      // cada bisagra, y como eso decide si el panel pliega "hacia arriba" o "hacia
      // abajo", distintas piezas terminaban plegando en sentidos opuestos e
      // inconsistentes entre sí. Acá fijamos el sentido: elegimos el signo del eje
      // para que, al plegar con ángulo positivo, el centroide del panel hijo se
      // mueva siempre hacia +Y (arriba) — así todas las bisagras pliegan "hacia
      // afuera de la hoja plana" de forma consistente.
      let ax = hinge.dir.x, az = -hinge.dir.y;
      const childWorld = toWorld(mask.centroid.x, mask.centroid.y);
      const vx = childWorld.x - H.x, vz = childWorld.z - H.z;
      const crossY = az*vx - ax*vz; // componente Y de (eje × vector-al-centroide)
      if (crossY < 0) { ax = -ax; az = -az; }

      pivot.userData.hingeAxis = new THREE.Vector3(ax, 0, az).normalize();
      parentObj3D.add(pivot);
      localOrigin = H;
    }

    const snapLines = hingeLinesFor(mask);
    const fanVerts = fanVerticesFor(mask);
    // Convierte un punto de coordenadas de imagen a coordenadas locales de mundo.
    // `snap=true` (contorno EXTERIOR): intenta pegar el punto a una punta de
    // abanico compartida o a la línea exacta de una bisagra vecina, igual que
    // antes. `snap=false` (agujeros interiores, ver traceContour/.holes): un
    // agujero no es un borde de pliegue con ninguna máscara vecina, así que no
    // tiene sentido "pegarlo" a ninguna bisagra — solo se transforma tal cual.
    function mapPointToWorld(p, snap) {
      let px = p.x, py = p.y;
      if (snap) {
        // 1) ¿este punto es la punta compartida con otras máscaras? si está lo
        //    bastante cerca de un vértice de abanico propio, se pega EXACTO a
        //    ese punto — tiene prioridad porque es una coincidencia real y
        //    puntual, más fuerte que "cerca de la línea" de una sola bisagra.
        let snappedToVertex = false;
        let bestD = Infinity;
        for (const fv of fanVerts) {
          // el radio permitido no puede ser más chico que el "reach" del propio
          // cluster (cuánto se movió el vértice al fusionar sub-uniones cercanas
          // en clusterFanPoints) — si no, una máscara angosta cuya esquina real
          // quedó lejos del promedio nunca calificaba para el snap (ver nota en
          // clusterFanPoints). FAN_VERTEX_SNAP_PX sigue siendo el piso mínimo.
          const maxD = Math.max(FAN_VERTEX_SNAP_PX, (fv.reach || 0) + HINGE_SNAP_PX);
          const d = Math.hypot(px-fv.x, py-fv.y);
          if (d <= maxD && d < bestD) { bestD = d; px = fv.x; py = fv.y; snappedToVertex = true; }
        }
        // 2) si no es la punta, se pega a la línea de la bisagra que le
        //    corresponda (borde propio, no forzado a ningún vértice).
        if (!snappedToVertex) {
          // con una sola bisagra candidata (caso típico de una solapa que solo
          // linda con su padre y no comparte vértice de abanico con nadie más,
          // p. ej. Máscara 9) no hay riesgo de confundirla con otra bisagra
          // cercana, así que no hace falta recortar por halfLen.
          const enforceExtent = snapLines.length > 1;
          for (const hg of snapLines) {
            const snapped = snapToHinge(px, py, hg, enforceExtent);
            if (snapped) { px = snapped.x; py = snapped.y; break; }
          }
        }
      }
      const w = toWorld(px, py);
      return { x: w.x - localOrigin.x, z: w.z - localOrigin.z, px:p.x, py:p.y };
    }
    const worldPoly = mask.contour.map(p => mapPointToWorld(p, true));
    const worldHoles = (mask.contour.holes || []).map(hole => hole.map(p => mapPointToWorld(p, false)));
    const maskName = state.meta.get(mask.id).name;
    const meta = state.meta.get(mask.id);
    // registra el pivot "principal" (pivot, fraction=1) SALVO que termine siendo
    // el primer eslabón de una cadena curva, en cuyo caso buildCurvedPanel lo
    // registra él mismo con la fracción correcta (1/N) — ver más abajo.
    let builtAsCurve = false;
    let childParent3D = pivot;       // dónde cuelgan los hijos de esta máscara en la escena 3D
    let childCumOrigin = localOrigin; // su posición equivalente en pose plana (ver buildCurvedPanel)
    if (mask.id !== baseMask.id && meta.curved && pivot.userData.hingeAxis) {
      const curveResult = buildCurvedPanel(mask, pivot, worldPoly, worldHoles, imgW, imgH, maskName, meta, localOrigin);
      if (curveResult) {
        builtAsCurve = true;
        childParent3D = curveResult.tipPivot;
        childCumOrigin = { x: localOrigin.x + curveResult.tipOffset.x, z: localOrigin.z + curveResult.tipOffset.z };
        curvedChainInfo.set(mask.id, curveResult.chain);
      }
    }
    if (!builtAsCurve) {
      try {
        const mesh = buildFlatMesh(worldPoly, worldHoles, mask, imgW, imgH, maskName);
        pivot.add(mesh);
        mesh.userData.isPanel = true;
        mesh.userData.maskId = mask.id;
        mesh.name = maskName;
        const d = mesh.userData.debugInfo;
        log(`"${maskName}": ${d.inPts}→${d.cleanedPts} pts, ${d.vertCount} vértices (${d.method}), área≈${d.area}u²`, 'ok');
        const lines = buildContourLines(worldPoly, mask.id);
        worldHoles.forEach(hole => pivot.add(buildContourLines(hole, mask.id)));
        pivot.add(lines);
      } catch (err) {
        log(`No se pudo construir la geometría de "${maskName}": ${err.message}`, 'err');
        console.error(`[visor3D] Falló "${maskName}" (id ${mask.id}):`, err);
        console.error(`[visor3D] localPoly de "${maskName}" (${worldPoly.length} pts):`, worldPoly.map(p => ({x:+p.x.toFixed(2), z:+p.z.toFixed(2), px:p.px, py:p.py})));
      }
      if (mask.id !== baseMask.id && pivot.userData.hingeAxis) {
        foldablePivots.push({ pivot, maskId: mask.id, fraction: 1 });
      }
    }

    nodesById.set(mask.id, { pivot });
    childrenOf(mask.id).forEach(child => buildNode(child, childParent3D, childCumOrigin, depth+1));
  }

  buildNode(baseMask, root, {x:0,z:0}, 0);

  document.getElementById('empty3d').style.display = 'none';
  document.getElementById('canvasHost').style.display = 'block';
  resize3D();
  const wasBuilt = state.built;
  state.built = true;
  fitZoomRangeToModel(!wasBuilt);
  applyFold(currentFoldPercent/100);
  log(`Modelo actualizado: ${activeMasks.length} paneles.`, 'ok');
  updateMasksConsole();
  // El visor 3D vive siempre en #side-card (tarjeta flotante), así que ya no
  // hace falta cambiar de pestaña — el modelo aparece ahí apenas está listo.
}

/* -------- Ajusta el rango de zoom (OrbitControls.min/maxDistance) al
            tamaño real del modelo recién construido.
            Antes el rango era fijo (80–1600 unidades de mundo), calibrado
            para una plantilla "de referencia". Como el modelo se escala de
            verdad a state.dims.widthCm/heightCm (ver DIMS_WORLD_UNITS_PER_CM
            más arriba), una plantilla bastante más chica o más grande que esa
            referencia quedaba con un rango fijo mal calibrado: el mínimo de
            zoom dejaba la cámara metida "dentro" del modelo (demasiado cerca)
            o el máximo no alcanzaba a mostrarlo completo (demasiado lejos),
            así que en la práctica sólo había dos extremos utilizables y
            ningún punto medio cómodo. Ahora el rango se recalcula en cada
            reconstrucción en proporción al tamaño real (radio de la esfera
            que envuelve el modelo), y sólo se reencuadra la cámara la
            primera vez que se construye el modelo (para no "saltar" la
            vista del usuario en reconstrucciones posteriores) o si la
            distancia actual quedó fuera del nuevo rango permitido. -------- */
function fitZoomRangeToModel(isFirstBuild) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1);

  // Rango de zoom proporcional: bastante cerca (ver el detalle de un panel)
  // hasta bastante lejos (ver el modelo completo con margen alrededor).
  controls.minDistance = Math.max(radius * 0.3, 5);
  controls.maxDistance = radius * 14;

  if (isFirstBuild) {
    // Primera vez que aparece el modelo: encuadra la cámara a una distancia
    // cómoda dentro del nuevo rango, mirando hacia el centro real del modelo,
    // conservando el ángulo de vista actual (no la posición absoluta).
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(430, 380, 520);
    dir.normalize();
    const comfortDist = THREE.MathUtils.clamp(radius * 2.4, controls.minDistance, controls.maxDistance);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(dir, comfortDist);
  } else {
    // Reconstrucciones posteriores: si la cámara quedó fuera del rango nuevo
    // (p.ej. el usuario achicó/agrandó mucho el tamaño real en "Medidas"),
    // se acerca/aleja lo mínimo indispensable para volver a quedar dentro,
    // sin tocar el ángulo ni el punto que está mirando.
    const dir = camera.position.clone().sub(controls.target);
    const dist = dir.length();
    if (dist > 1e-6) {
      const clamped = THREE.MathUtils.clamp(dist, controls.minDistance, controls.maxDistance);
      if (clamped !== dist) camera.position.copy(controls.target).addScaledVector(dir.normalize(), clamped);
    }
  }
  controls.update();
}

// Limpia un lazo (exterior o agujero): quita puntos consecutivos casi-coincidentes
// que suelen hacer fallar a earcut en silencio (0 triángulos). Misma lógica que
// antes se aplicaba inline solo al contorno exterior, ahora reutilizable para
// que también se pueda aplicar a cada agujero interior.
function cleanLoop(poly) {
  const CLEAN_EPS = 0.15;
  const cleaned = [];
  for (const p of poly) {
    const prev = cleaned[cleaned.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.z - prev.z) > CLEAN_EPS) cleaned.push(p);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0], last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.x - last.x, first.z - last.z) < CLEAN_EPS) cleaned.pop();
  }
  return cleaned;
}

/* Recorta un polígono (lazo cerrado, no necesariamente convexo) contra UN
   semiplano, con Sutherland-Hodgman: vFn(p) da la coordenada "profundidad"
   de cada punto a lo largo del eje perpendicular a la bisagra; se conservan
   los puntos con vFn(p) >= threshold (keepMin=true) o <= threshold
   (keepMin=false), interpolando linealmente (x, z, y también px/py de imagen,
   para que el punto nuevo tenga una UV razonable) en cada borde que cruza el
   umbral. El semiplano siempre es convexo, así que esto funciona aunque el
   polígono de la máscara no lo sea. Usado por buildCurvedPanel para cortar
   un panel curvo en N tiras paralelas a su bisagra. */
function clipPolyByPlane(poly, vFn, keepMin, threshold) {
  const EPS = 1e-6;
  const out = [];
  const n = poly.length;
  if (n === 0) return out;
  const interp = (a, b, va, vb) => {
    const t = (threshold - va) / (vb - va);
    return { x: a.x + (b.x-a.x)*t, z: a.z + (b.z-a.z)*t, px: a.px + (b.px-a.px)*t, py: a.py + (b.py-a.py)*t };
  };
  for (let i=0;i<n;i++) {
    const curr = poly[i], prev = poly[(i-1+n)%n];
    const vCurr = vFn(curr), vPrev = vFn(prev);
    const currIn = keepMin ? (vCurr >= threshold - EPS) : (vCurr <= threshold + EPS);
    const prevIn = keepMin ? (vPrev >= threshold - EPS) : (vPrev <= threshold + EPS);
    if (currIn) {
      if (!prevIn) out.push(interp(prev, curr, vPrev, vCurr));
      out.push(curr);
    } else if (prevIn) {
      out.push(interp(prev, curr, vPrev, vCurr));
    }
  }
  return out;
}

/* Aproxima un pliegue curvo (ver toggleCurved) subdividiendo el panel de
   `mask` en N tiras paralelas a su bisagra con su propio padre, cada una
   colgando de la anterior con su propia bisagra (mismo eje, mismo sentido)
   y una fracción 1/N del ángulo objetivo (repartido en applyFold vía
   `foldablePivots`, ver ahí). Al plegar, cada eslabón rota un poquito
   relativo al anterior — como un polígono aproximando un arco — así la
   suma de N pliegues chiquitos se ve como una curva continua en vez de un
   panel plano y rígido.
   `pivot0` es el pivot YA CREADO por buildNode para esta máscara (con su
   hingeAxis hacia el padre) — se reutiliza como el primer eslabón de la
   cadena, así no se duplica ningún cálculo de bisagra.
   Devuelve true si construyó la cadena curva (y por lo tanto buildNode NO
   debe construir además el panel plano de siempre), o false si no
   correspondía (sin agujeros soportados, o geometría degenerada) — en cuyo
   caso el llamador cae de nuevo al panel plano normal. */
function buildCurvedPanel(mask, pivot0, worldPoly, worldHoles, imgW, imgH, maskName, meta, originH) {
  // Los agujeros interiores (p. ej. una solapa en forma de anillo) pueden
  // quedar cortados en varias piezas si un corte los atraviesa — manejar eso
  // bien requeriría reconstruir el anillo por tira, que es mucho más trabajo
  // para un caso que en la práctica casi no se da en máscaras curvas (esas
  // suelen ser paredes lisas tipo lado de caja almohada). Por ahora, una
  // máscara con agujeros simplemente no se subdivide — se avisa y se cae al
  // panel plano de siempre.
  if (worldHoles && worldHoles.length) {
    log(`"${maskName}": tiene agujero(s) interior(es) — el pliegue curvo automático no los soporta todavía, se usa panel plano.`, 'warnln');
    return false;
  }
  const axis = pivot0.userData.hingeAxis;
  const ax = axis.x, az = axis.z;
  // eje perpendicular a la bisagra (dentro del plano x,z), con el signo
  // elegido para que apunte HACIA el panel (mismo criterio que crossY en
  // buildNode: el lado donde realmente están los puntos del contorno).
  let vx = az, vz = -ax;
  let sumV = 0;
  worldPoly.forEach(p => { sumV += p.x*vx + p.z*vz; });
  if (sumV < 0) { vx = -vx; vz = -vz; }
  const vFn = p => p.x*vx + p.z*vz;

  let vMin = Infinity, vMax = -Infinity;
  worldPoly.forEach(p => { const v = vFn(p); if (v < vMin) vMin = v; if (v > vMax) vMax = v; });
  const span = vMax - vMin;
  if (!isFinite(span) || span < 1e-3) return false; // panel degenerado (sin profundidad real) — no vale la pena

  const N = curveSegmentsFor(meta);
  if (N <= 1) return false;
  const boundaries = [];
  for (let i=0;i<=N;i++) boundaries.push(vMin + (span*i)/N);

  log(`"${maskName}": pliegue curvo activado — subdividido en ${N} segmentos.`, 'ok');

  let prevPivot = pivot0;
  let prevAbsV = 0; // pivot0 vive en v=0 por construcción (es el punto de la bisagra real)
  let tipPivot = pivot0; // se actualiza en cada vuelta — al salir del loop queda el ÚLTIMO eslabón
  // registro de cada franja (pivot real + su rango de v) para que otras
  // máscaras que se pegan a esta pared A LO LARGO de la curva (ver
  // buildLateralChild) puedan colgar cada tramo suyo del segmento correcto
  // en vez de un único pivote promedio — así la unión no se abre al plegar.
  const strips = [];
  for (let k=0;k<N;k++) {
    const lo = boundaries[k], hi = boundaries[k+1];
    let strip = worldPoly;
    if (k > 0) strip = clipPolyByPlane(strip, vFn, true, lo);
    if (k < N-1) strip = clipPolyByPlane(strip, vFn, false, hi);

    let stripPivot;
    let stripAbsV;
    if (k === 0) {
      stripPivot = pivot0;
      stripAbsV = 0;
    } else {
      stripAbsV = lo; // = boundaries[k]
      const off = { x: (stripAbsV - prevAbsV)*vx, z: (stripAbsV - prevAbsV)*vz };
      stripPivot = new THREE.Group();
      stripPivot.position.set(off.x, 0, off.z);
      stripPivot.userData.hingeAxis = new THREE.Vector3(ax, 0, az).normalize();
      prevPivot.add(stripPivot);
    }
    foldablePivots.push({ pivot: stripPivot, maskId: mask.id, fraction: 1/N });
    strips.push({ pivot: stripPivot, vLo: lo, vHi: hi });

    if (strip.length >= 3) {
      const localStrip = strip.map(p => ({ x: p.x - stripAbsV*vx, z: p.z - stripAbsV*vz, px: p.px, py: p.py }));
      try {
        const mesh = buildFlatMesh(localStrip, [], mask, imgW, imgH, `${maskName} (seg ${k+1}/${N})`);
        stripPivot.add(mesh);
        mesh.userData.isPanel = true;
        mesh.userData.maskId = mask.id;
        mesh.name = maskName;
        stripPivot.add(buildContourLines(localStrip, mask.id));
      } catch (err) {
        console.warn(`[visor3D] "${maskName}" segmento curvo ${k+1}/${N} vacío/degenerado tras recortar — se omite ese segmento.`, err.message);
      }
    }
    prevPivot = stripPivot;
    prevAbsV = stripAbsV;
    tipPivot = stripPivot;
  }
  // Si esta máscara curva tiene a su vez hijos (algo se pliega sobre su borde
  // LEJANO — caso típico en una cadena de pliegues), esos hijos tienen que
  // colgar del ÚLTIMO eslabón de la cadena (el que acumula la rotación
  // completa, no solo 1/N) para que sigan la curva en vez de quedar pegados
  // al primer segmento. tipOffset es dónde vive ese último eslabón en pose
  // plana (sin plegar), para que buildNode seguir calculando bien la
  // posición de esos hijos. Nota: esto asume que el hijo se pliega sobre el
  // borde lejano (v≈vMax) del panel curvo, no sobre un costado intermedio —
  // válido para el caso de uso real (paredes curvas tipo caja almohada, que
  // en general son hojas del árbol o encadenan hacia adelante), pero no es
  // 100% general.
  return {
    tipPivot,
    tipOffset: { x: vMax*vx, z: vMax*vz },
    // cadena de franjas expuesta para uniones laterales (ver buildLateralChild):
    // vx,vz = eje "de profundidad" de la curva; ax,az = eje de la bisagra (crease);
    // H = origen (mismo sistema de coordenadas que worldPoly, relativo a este panel).
    chain: { vx, vz, ax, az, boundaries, strips, H: originH },
  };
}

function buildFlatMesh(localPoly, holesPoly, mask, imgW, imgH, maskName) {
  if (localPoly.length < 3) throw new Error('contorno degenerado (menos de 3 puntos)');
  holesPoly = holesPoly || [];

  // Puntos duplicados o casi-duplicados consecutivos (muy comunes en paneles angostos
  // tipo "gajo" que convergen en un vértice compartido con otras 3-5 máscaras) suelen
  // hacer que el triangulador interno (earcut) de ShapeGeometry falle EN SILENCIO ->
  // 0 triángulos, sin lanzar excepción. Antes esto solo se detectaba y avisaba por
  // consola, pero la máscara terminaba sin geometría (sin aviso visible en el modelo).
  // Ahora: 1) limpiamos el contorno con un margen más realista antes de triangular, y
  // 2) si earcut igual falla, usamos una triangulación de respaldo en abanico para no
  // perder el panel.
  const EPS = 0.01;
  const dupIdx = [];
  for (let i=0;i<localPoly.length;i++) {
    const a = localPoly[i], b = localPoly[(i+1)%localPoly.length];
    if (Math.hypot(a.x-b.x, a.z-b.z) < EPS) dupIdx.push(i);
    if (!isFinite(a.x) || !isFinite(a.z)) dupIdx.push(`NaN/Infinity en punto ${i}`);
  }
  if (dupIdx.length) {
    console.warn(`[visor3D] "${maskName}": ${localPoly.length} puntos, posibles duplicados/degenerados en índices:`, dupIdx, localPoly);
  }

  // Limpieza real (no solo diagnóstico): elimina puntos consecutivos casi-coincidentes
  // (umbral mayor a EPS de diagnóstico, pensado para el rango de coordenadas de mundo
  // tras el escalado) y puntos casi-colineales (ángulo interior ~180°), ambos disparadores
  // típicos de fallos silenciosos de earcut en gajos angostos.
  const cleaned = cleanLoop(localPoly);
  if (cleaned.length < 3) {
    throw new Error(`contorno degenerado tras limpiar duplicados (quedaron ${cleaned.length} de ${localPoly.length} pts)`);
  }
  // Mismo proceso para cada agujero interior (ver traceContour/.holes). Un agujero
  // que quede degenerado tras limpiar simplemente se descarta (con aviso) en vez de
  // tirar abajo todo el panel — es preferible un panel sin ese agujero puntual a un
  // panel que desaparece del todo.
  const cleanedHoles = [];
  holesPoly.forEach((hole, hi) => {
    const ch = cleanLoop(hole);
    if (ch.length >= 3) cleanedHoles.push(ch);
    else console.warn(`[visor3D] "${maskName}": agujero interior #${hi} degenerado tras limpiar (${ch.length} de ${hole.length} pts) — se descarta.`);
  });

  // Área firmada del polígono (shoelace) en unidades de mundo. Un panel real (pared/base/
  // solapa) siempre tiene área bien alejada de cero; si da ~0 es señal segura de que el
  // contorno quedó degenerado (colapsado a una línea) aunque earcut no haya lanzado error.
  const shoelaceArea = (poly) => {
    let a = 0;
    for (let i=0;i<poly.length;i++) {
      const p1 = poly[i], p2 = poly[(i+1)%poly.length];
      a += p1.x*p2.z - p2.x*p1.z;
    }
    return a/2;
  };
  const area = shoelaceArea(cleaned);
  const AREA_EPS = 0.05; // u² de mundo
  if (Math.abs(area) < AREA_EPS) {
    throw new Error(`área ~0 (${area.toFixed(4)} u²) tras limpiar — el contorno colapsó a una línea/punto (${cleaned.length} pts de ${localPoly.length} originales)`);
  }

  const shapePts = cleaned.map(p => new THREE.Vector2(p.x, p.z));
  const shape = new THREE.Shape(shapePts);
  // ARREGLO: acá es donde se agregan los agujeros interiores (p. ej. una solapa con
  // forma de anillo/rosquilla) como huecos reales de la geometría 3D, en vez de
  // ignorarlos — antes esta función solo aceptaba el contorno exterior, así que una
  // máscara circular con hueco terminaba rellenándose por completo (o, si el trazado
  // fallaba antes de llegar acá, caía al rectángulo del bbox).
  cleanedHoles.forEach(hole => {
    shape.holes.push(new THREE.Path(hole.map(p => new THREE.Vector2(p.x, p.z))));
  });
  let geo = new THREE.ShapeGeometry(shape);
  let posAttr = geo.attributes.position;
  let method = 'earcut';

  if (!posAttr || posAttr.count === 0) {
    console.warn(`[visor3D] "${maskName}": ShapeGeometry (earcut) generó 0 vértices tras limpiar (${cleaned.length} pts, área=${area.toFixed(2)}u²). Usando triangulación de respaldo en abanico.`);
    geo = buildFanGeometry(cleaned);
    posAttr = geo.attributes.position;
    method = 'fan-respaldo';
    if (cleanedHoles.length) {
      console.warn(`[visor3D] "${maskName}": la triangulación de respaldo en abanico no soporta agujeros — el panel quedará relleno (sin el hueco interior) en este caso límite.`);
    }
  }
  if (!posAttr || posAttr.count === 0) {
    console.error(`[visor3D] "${maskName}": ni earcut ni el respaldo en abanico generaron geometría. Contorno de entrada (${localPoly.length} pts):`, localPoly);
    throw new Error(`geometría vacía tras triangular (${localPoly.length} pts de entrada) — contorno probablemente auto-intersectado o con puntos duplicados`);
  }
  // recalcula UVs a partir de las coordenadas originales de imagen
  const uv = new Float32Array(posAttr.count * 2);
  // ShapeGeometry conserva el orden de los puntos de entrada para los vértices de contorno,
  // pero puede agregar/reordenar por triangulación interna; mapeamos por posición local más
  // cercana. La lista de búsqueda incluye también los puntos de los agujeros, para que los
  // vértices generados alrededor de un hueco tomen su UV real en vez de la del contorno exterior.
  const uvSource = localPoly.concat(...holesPoly);
  for (let i=0; i<posAttr.count; i++) {
    const lx = posAttr.getX(i), lz = posAttr.getY(i);
    let best = 0, bestD = Infinity;
    for (let j=0;j<uvSource.length;j++) {
      const d = (uvSource[j].x-lx)*(uvSource[j].x-lx) + (uvSource[j].z-lz)*(uvSource[j].z-lz);
      if (d < bestD) { bestD = d; best = j; }
    }
    uv[i*2]   = uvSource[best].px / imgW;
    uv[i*2+1] = 1 - uvSource[best].py / imgH;
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.rotateX(Math.PI/2);

  const meta = state.meta.get(mask.id);
  const material = new THREE.MeshStandardMaterial({
    color: useTexture ? 0xffffff : new THREE.Color(meta.color),
    map: useTexture ? modelTexture : null,
    roughness: 0.85,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.debugInfo = { method, vertCount: posAttr.count, area: +area.toFixed(2), inPts: localPoly.length, cleanedPts: cleaned.length };
  return mesh;
}

// Triangulación de respaldo: abanico de triángulos desde el centroide del polígono.
// No requiere earcut y funciona de forma confiable para los polígonos simples/estrellados
// (convexos o casi-convexos) típicos de los paneles de un dieline, incluso cuando el
// contorno tiene vértices muy próximos entre sí que hacen fallar a earcut.
function buildFanGeometry(poly) {
  const n = poly.length;
  const cx = poly.reduce((s,p)=>s+p.x,0) / n;
  const cz = poly.reduce((s,p)=>s+p.z,0) / n;
  const positions = [];
  for (let i=0;i<n;i++) {
    const a = poly[i], b = poly[(i+1)%n];
    // orden (centro, a, b) da cara hacia +Y consistente con el winding de ShapeGeometry
    positions.push(cx, cz, 0,  a.x, a.z, 0,  b.x, b.z, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  geo.computeVertexNormals();
  return geo;
}

function buildContourLines(localPoly, maskId) {
  const group = new THREE.Group();
  for (let i=0;i<localPoly.length;i++) {
    const a = localPoly[i], b = localPoly[(i+1)%localPoly.length];
    // clasifica el segmento según los píxeles de tinta clasificados cerca del punto medio
    const mx = (a.px+b.px)/2, my = (a.py+b.py)/2;
    let cls = classifyNear(mx, my);
    const color = cls === 2 ? 0xe0546b : 0x4fc3e6;
    const pts = [ new THREE.Vector3(a.x, 0.6, a.z), new THREE.Vector3(b.x, 0.6, b.z) ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geo, mat);
    line.visible = toggleLines.checked;
    line.userData.isCutLine = cls === 2;
    line.userData.isCreaseLine = cls === 1;
    group.add(line);
  }
  return group;
}

function classifyNear(px, py) {
  if (!state.inkClass) return 0;
  const w = state.iw, h = state.ih;
  const R = Math.max(2, state.tolerance);
  let creaseN=0, cutN=0;
  const x0 = Math.max(0, Math.round(px)-R), x1 = Math.min(w-1, Math.round(px)+R);
  const y0 = Math.max(0, Math.round(py)-R), y1 = Math.min(h-1, Math.round(py)+R);
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
    const c = state.inkClass[y*w+x];
    if (c===1) creaseN++; else if (c===2) cutN++;
  }
  if (creaseN===0 && cutN===0) return 0;
  return creaseN >= cutN ? 1 : 2;
}

/* ============================================================
   9) INTERPOLACIÓN DE PLEGADO (t global, todos los nodos a la vez)
============================================================ */
function applyFold(t) {
  const ease = x => x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x+2, 2)/2;
  // Si "Plegable" está desactivado (#foldableToggleSettingsRow / #foldableToggleSettings
  // apagado), el modelo no es un armable plano-a-3D: se muestra siempre "parado"
  // (100% plegado, ya armado), sin importar la posición del slider. El slider
  // vuelve a controlar el plegado normal apenas se reactiva el interruptor.
  const e = foldableEnabled ? ease(THREE.MathUtils.clamp(t,0,1)) : 1;
  // fraction=1 para un pivot normal (un panel = un pliegue = el ángulo completo).
  // fraction=1/N para cada eslabón de una cadena de pliegue curvo (ver
  // buildCurvedPanel): el ángulo objetivo de la máscara se reparte en partes
  // iguales entre los N pivots de la cadena, así la suma de N pliegues
  // chiquitos aproxima visualmente un pliegue continuo curvo.
  foldablePivots.forEach(({ pivot, maskId, fraction }) => {
    if (pivot === root) return;
    const axis = pivot.userData.hingeAxis;
    if (!axis) return;
    // se lee el ángulo actual de state.meta (no un valor fijo guardado al construir),
    // así que cambiar el ángulo se refleja en vivo sin necesidad de reconstruir el modelo.
    const meta = state.meta.get(maskId);
    const target = THREE.MathUtils.degToRad((meta ? meta.angle : 0) || 0) * fraction;
    pivot.quaternion.setFromAxisAngle(axis, target * e);
  });
}

/* ============================================================
   10) UI de plegado / vista / interacción
============================================================ */
// Widgets reales de SuperImprimible 10 (diseño de side-card): pointer/track
// arrastrable en vez del <input type="range"> original, más el botón de play
// con ícono y el popover de la tuerca para las opciones.
const sliderBox = document.getElementById('modelCollapseSliderBox');
const activeEl = document.getElementById('modelCollapseActive');
const pointerEl = document.getElementById('modelCollapsePointer');
const percentEl = document.getElementById('modelCollapsePercent');
const tValueBadge = document.getElementById('tValue');
const playBtn = document.getElementById('foldPlayBtn');
const toggleLines = document.getElementById('toggleLines');
const toggleSpin = document.getElementById('toggleSpin');
const toggleTexture = document.getElementById('toggleTexture');

let currentFoldPercent = 100;
let foldPercentBeforeLock = null; // guarda el % del slider justo antes de bloquearlo, para restaurarlo al reactivar "Plegable"

// Estado del interruptor "Plegable" (#foldableToggleSettingsRow /
// #foldableToggleSettings, sincronizado con #foldableTemplateToggle).
// Se inicializa según el estado real del checkbox/clase al cargar la página,
// y se mantiene al día escuchando el evento que ya dispara ese interruptor.
const foldCollapseControls = document.getElementById('foldCollapseControls');
let foldableEnabled = document.body.classList.contains('is-foldable-template');

// Cuando "Plegable" está desactivado, el slider de plegado no tiene nada que
// controlar (el modelo se muestra siempre "parado", ver applyFold), así que
// además de forzarlo a 100% lo dejamos atenuado y sin interacción
// (.model-collapse--disabled, ya definida en el CSS). Al reactivar el
// interruptor, se restaura el % que tenía el slider antes de bloquearse.
function syncFoldControlsAvailability() {
  if (foldCollapseControls) foldCollapseControls.classList.toggle('model-collapse--disabled', !foldableEnabled);
  if (!foldableEnabled) {
    if (foldPercentBeforeLock === null) foldPercentBeforeLock = currentFoldPercent;
    setFold(100);
  } else if (foldPercentBeforeLock !== null) {
    setFold(foldPercentBeforeLock);
    foldPercentBeforeLock = null;
  }
  updateCameraForFoldable();
}

// Vista de cámara según el interruptor "Plegable" (#foldableToggleSettingsRow /
// #foldableToggleSettings): si está desactivado, la pieza es plana (no se
// pliega), así que enfocamos el visor 3D desde arriba en vez del ángulo en
// perspectiva habitual. Al reactivar "Plegable" se restaura la vista que
// había antes de mirar desde arriba.
let cameraStateBeforeTop = null; // {position, target} guardados justo antes de pasar a vista superior
function updateCameraForFoldable() {
  if (!foldableEnabled) {
    if (!cameraStateBeforeTop) {
      cameraStateBeforeTop = { position: camera.position.clone(), target: controls.target.clone() };
    }
    const dist = camera.position.distanceTo(controls.target) || 700;
    // Pequeño desvío en Z para evitar el bloqueo de gimbal de OrbitControls
    // cuando la cámara queda exactamente alineada con el vector "up" (0,1,0).
    camera.position.set(controls.target.x, controls.target.y + dist, controls.target.z + 0.001);
    camera.up.set(0, 0, -1);
    controls.update();
  } else if (cameraStateBeforeTop) {
    camera.up.set(0, 1, 0);
    camera.position.copy(cameraStateBeforeTop.position);
    controls.target.copy(cameraStateBeforeTop.target);
    controls.update();
    cameraStateBeforeTop = null;
  }
}

document.addEventListener('sp:foldableTemplateChanged', (ev) => {
  foldableEnabled = !!(ev.detail && ev.detail.foldable);
  syncFoldControlsAvailability();
});
syncFoldControlsAvailability();

function setFold(percent) {
  percent = Math.max(0, Math.min(100, percent));
  const t = percent / 100;
  if (state.built) applyFold(t);
  currentFoldPercent = percent;
  if (percentEl) percentEl.textContent = Math.round(percent) + '%';
  if (activeEl) activeEl.style.width = percent + '%';
  if (pointerEl) pointerEl.style.left = 'calc(' + percent + '% - 6px)';
  if (tValueBadge) tValueBadge.textContent = t.toFixed(2);
}

function pctFromEvent(clientX) {
  const rect = sliderBox.getBoundingClientRect();
  return ((clientX - rect.left) / rect.width) * 100;
}
let draggingFold = false;
if (pointerEl) pointerEl.addEventListener('mousedown', e => { draggingFold = true; e.preventDefault(); });
if (sliderBox) sliderBox.addEventListener('mousedown', e => { setFold(pctFromEvent(e.clientX)); draggingFold = true; });
document.addEventListener('mousemove', e => { if (draggingFold) setFold(pctFromEvent(e.clientX)); });
document.addEventListener('mouseup', () => { draggingFold = false; });

let playing = false, playDir = -1;
if (playBtn) playBtn.addEventListener('click', () => {
  playing = !playing;
  if (playing) animatePlay();
});
function animatePlay() {
  if (!playing) return;
  let p = currentFoldPercent + playDir * 0.9;
  if (p >= 100) { p = 100; playDir = -1; }
  if (p <= 0) { p = 0; playDir = 1; }
  setFold(p);
  if (playing) requestAnimationFrame(animatePlay);
}

toggleLines.addEventListener('change', () => {
  scene.traverse(obj => {
    if (obj.userData.isCutLine || obj.userData.isCreaseLine) obj.visible = toggleLines.checked;
  });
});

// Interruptor "Usar lineas de Contorno" (#contourLinesToggleRow / #contourLinesToggle,
// panel de Configuraciones): es el mismo interruptor que #toggleLines (popover de
// opciones de plegado en la vista Diseño), sólo que accesible desde Configuraciones.
// Se mantienen sincronizados en ambos sentidos para que cualquiera de los dos
// refleje y controle la misma visibilidad de líneas de corte/hendido del visor 3D.
const contourLinesToggle = document.getElementById('contourLinesToggle');
if (contourLinesToggle) {
  contourLinesToggle.checked = toggleLines.checked;
  contourLinesToggle.addEventListener('change', () => {
    toggleLines.checked = contourLinesToggle.checked;
    toggleLines.dispatchEvent(new Event('change'));
    // También refresca el canvas 2D de la vista Diseño (silueta en color puro),
    // que tiene su propia lógica para ocultar/mostrar las líneas de tinta.
    if (typeof fillEditorCanvasWithSp2Color === 'function' && typeof disenoViewActive !== 'undefined' && disenoViewActive) {
      fillEditorCanvasWithSp2Color();
    }
  });
  toggleLines.addEventListener('change', () => {
    contourLinesToggle.checked = toggleLines.checked;
    if (typeof fillEditorCanvasWithSp2Color === 'function' && typeof disenoViewActive !== 'undefined' && disenoViewActive) {
      fillEditorCanvasWithSp2Color();
    }
  });
}

toggleTexture.addEventListener('change', () => {
  useTexture = toggleTexture.checked;
  scene.traverse(obj => {
    if (obj.userData.isPanel && obj.material) {
      const meta = state.meta.get(obj.userData.maskId);
      obj.material.map = useTexture ? modelTexture : null;
      obj.material.color = useTexture ? new THREE.Color(0xffffff) : new THREE.Color(meta ? meta.color : '#3aa8c9');
      obj.material.needsUpdate = true;
    }
  });
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const panelInfo = document.getElementById('panelInfo');
const pinfoName = document.getElementById('pinfoName');
const pinfoMeta = document.getElementById('pinfoMeta');

// se pone en true justo después de un arrastre real, para que el 'click' que el
// navegador dispara automáticamente al soltar el mouse no lo confunda con un
// click normal de selección (que abriría/cerraría el panel de info sin querer).
let suppressNextPanelClick = false;

renderer.domElement.addEventListener('click', (e) => {
  if (suppressNextPanelClick) { suppressNextPanelClick = false; return; }
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children, true).filter(h => h.object.userData.isPanel);
  if (hits.length) {
    const obj = hits[0].object;
    const meta = state.meta.get(obj.userData.maskId);
    pinfoName.textContent = obj.name;
    pinfoMeta.textContent = meta ? `rol: ${meta.role} · ángulo objetivo: ${meta.angle}° · hereda transform del padre` : '';
    panelInfo.classList.add('show');
  } else {
    panelInfo.classList.remove('show');
  }
});

/* ============================================================
   ARRASTRE EN 3D: rotar un panel en vivo tomándolo con el mouse.
   Al hacer pointerdown sobre un panel (que no sea la Base), se calcula la
   posición en pantalla de SU bisagra real (el pivot del que cuelga) y se mide
   el ángulo del mouse respecto a ese punto en pantalla. Mientras se arrastra,
   la diferencia entre ese ángulo inicial y el actual se suma al ángulo objetivo
   que tenía la pieza al empezar — así el arrastre gira la pieza alrededor de su
   propia bisagra, no de un eje arbitrario de pantalla. Los controles de órbita
   de la cámara se desactivan mientras dura el arrastre para no pelear con ellos.
============================================================ */
let dragRot = null; // { maskId, hingeScreen:{x,y}, sign, startClientX, startClientY, startAngle, moved }
const DRAG_MOVE_THRESHOLD = 4; // px: por debajo de esto, se trata como click normal, no arrastre

function projectToScreen(worldPos) {
  const v = worldPos.clone().project(camera);
  const rect = renderer.domElement.getBoundingClientRect();
  return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
}
function screenAngle(clientX, clientY, origin) {
  return Math.atan2(clientY - origin.y, clientX - origin.x);
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // solo botón izquierdo
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(scene.children, true).filter(h => h.object.userData.isPanel);
  if (!hits.length) return;
  const obj = hits[0].object;
  const maskId = obj.userData.maskId;
  const meta = state.meta.get(maskId);
  const nodeInfo = nodesById.get(maskId);
  if (!meta || meta.role === 'base' || !nodeInfo || !nodeInfo.pivot.userData.hingeAxis) return; // la Base no se pliega

  const pivot = nodeInfo.pivot;
  // eje de la bisagra en coordenadas de mundo: se toma la rotación del PADRE del
  // pivot (no la del pivot mismo), porque el eje se definió relativo al pivot
  // "sin plegar todavía" — usar la rotación propia del pivot mezclaría el ángulo
  // que justo estamos por cambiar con el eje sobre el que hay que girar.
  const axisWorld = pivot.userData.hingeAxis.clone().transformDirection(pivot.parent.matrixWorld).normalize();
  const hingeWorldPos = new THREE.Vector3().setFromMatrixPosition(pivot.matrixWorld);
  const hingeScreen = projectToScreen(hingeWorldPos);

  // signo del arrastre: si el eje de la bisagra apunta más hacia la cámara que en
  // contra, un giro de mouse en sentido horario en pantalla debe invertirse para
  // que la pieza siga girando "hacia donde se la tira" de forma intuitiva.
  const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
  const sign = axisWorld.dot(camDir) >= 0 ? 1 : -1;

  dragRot = { maskId, hingeScreen, sign, startClientX: e.clientX, startClientY: e.clientY, startAngle: meta.angle, moved: false };
  controls.enabled = false;
});

window.addEventListener('pointermove', (e) => {
  if (!dragRot) return;
  const dx = e.clientX - dragRot.startClientX, dy = e.clientY - dragRot.startClientY;
  if (!dragRot.moved && Math.hypot(dx, dy) > DRAG_MOVE_THRESHOLD) dragRot.moved = true;
  if (!dragRot.moved) return;

  const a0 = screenAngle(dragRot.startClientX, dragRot.startClientY, dragRot.hingeScreen);
  const a1 = screenAngle(e.clientX, e.clientY, dragRot.hingeScreen);
  const deltaDeg = THREE.MathUtils.radToDeg(a1 - a0) * dragRot.sign;
  const finalAngle = setAngleAbsolute(dragRot.maskId, dragRot.startAngle + deltaDeg);

  const meta = state.meta.get(dragRot.maskId);
  pinfoName.textContent = meta.name;
  pinfoMeta.textContent = `rol: ${meta.role} · ángulo objetivo: ${finalAngle ?? meta.angle}° · arrastrando…`;
  panelInfo.classList.add('show');
});

window.addEventListener('pointerup', () => {
  if (!dragRot) return;
  controls.enabled = true;
  if (dragRot.moved) suppressNextPanelClick = true; // evita que el click posterior al soltar reabra/cierre el panel de info
  dragRot = null;
});

/* ============================================================
   11) LOOP / RESIZE
============================================================ */
function resize3D() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', resize3D);
resize3D();

function tick() {
  if (toggleSpin.checked) root.rotation.y += 0.0035;
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

/* ---------- Solapita arrastrable: agranda/achica la tarjeta del visor (#side-card) ---------- */
(function(){
  const handle = document.getElementById('empty3dResizeHandle');
  const card = document.getElementById('side-card');
  const container = document.querySelector('.window');
  if (!handle || !card || !container) return;

  const MARGIN = 24;   // mismo margen que top/right de la tarjeta, para no salirse de la ventana
  const MIN_SIZE = 200;

  let resizing = null;

  handle.addEventListener('pointerdown', function(e){
    e.preventDefault();
    e.stopPropagation();
    resizing = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: card.offsetWidth,
      startHeight: card.offsetHeight
    };
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', function(e){
    if (!resizing) return;

    const containerRect = container.getBoundingClientRect();
    const maxWidth = containerRect.width - MARGIN - MARGIN;
    const maxHeight = containerRect.height - MARGIN - MARGIN;

    // Arrastrar hacia la izquierda/abajo agranda la tarjeta (la solapa está en la esquina inferior izquierda)
    const dx = resizing.startX - e.clientX;
    const dy = e.clientY - resizing.startY;

    let newWidth = resizing.startWidth + dx;
    let newHeight = resizing.startHeight + dy;

    newWidth = Math.min(Math.max(newWidth, MIN_SIZE), maxWidth);
    newHeight = Math.min(Math.max(newHeight, MIN_SIZE), maxHeight);

    card.style.width = newWidth + 'px';
    card.style.height = newHeight + 'px';

    if (typeof resize3D === 'function') resize3D();
  });

  function stopResizing(e){
    if (!resizing) return;
    try { handle.releasePointerCapture(e.pointerId); } catch(err){}
    resizing = null;
  }
  handle.addEventListener('pointerup', stopResizing);
  handle.addEventListener('pointercancel', stopResizing);
})();


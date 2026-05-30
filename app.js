/* =====================================================
   Sale Stomp — app.js
   ===================================================== */

// ── State ──────────────────────────────────────────────
const state = {
  rows: [],            // parsed CSV rows
  markers: [],         // { row, marker, visible }
  categories: {},      // { name: { enabled, color } }
  route: [],           // { id, label, type, latlng, stopType }  types: start|end|sale|custom
  routeLayer: null,    // Leaflet polyline
  map: null,
};

let stopIdCounter = 0;
const isMobile = 'ontouchstart' in window;

// ── Colour palette for categories ──────────────────────
const PALETTE = [
  '#e85d04','#1a73e8','#2d9e2d','#7c3aed','#d97706',
  '#0891b2','#be185d','#64748b','#15803d','#b45309',
];
let paletteIndex = 0;

function nextColor() {
  return PALETTE[paletteIndex++ % PALETTE.length];
}

// ── Map init ───────────────────────────────────────────
function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([51.505, -0.09], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(state.map);
}

// ── CSV loading ────────────────────────────────────────
function loadCSV(csvText, sourceName) {
  const result = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  if (result.errors.length && !result.data.length) {
    alert('Could not parse CSV. Please check the file format.');
    return;
  }

  clearAllMarkers();
  state.rows = [];
  state.categories = {};
  paletteIndex = 0;

  const rows = result.data;

  // normalise column names (flexible matching)
  rows.forEach(raw => {
    const row = normaliseRow(raw);
    if (!row) return;
    state.rows.push(row);

    // collect categories
    row.categories.forEach(cat => {
      if (!state.categories[cat]) {
        state.categories[cat] = { enabled: true, color: nextColor() };
      }
    });
  });

  renderCategoryFilters();
  placeMarkers();
  updateBadge();

  const info = document.getElementById('loaded-info');
  info.textContent = `✓ Loaded ${state.rows.length} locations from ${sourceName}`;
  info.classList.add('visible');

  if (state.markers.length) {
    const group = L.featureGroup(state.markers.map(m => m.marker));
    state.map.fitBounds(group.getBounds().pad(0.1));
  }
}

function normaliseRow(raw) {
  // flexible column matching
  const get = (...keys) => {
    for (const k of keys) {
      const val = raw[k] || raw[k.replace(/_/g,' ')] || raw[k.replace(/ /g,'_')];
      if (val !== undefined && String(val).trim()) return String(val).trim();
    }
    return '';
  };

  const name    = get('name','title','seller','location_name','location');
  const address = get('address','location','street','addr');
  const latStr  = get('lat','latitude');
  const lngStr  = get('lng','lon','longitude');
  const catRaw  = get('categories','category','items','tags','type');

  if (!address && !name) return null;

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);

  const categories = catRaw
    ? catRaw.split(/[|,;]/).map(c => c.trim()).filter(Boolean)
    : ['Uncategorised'];

  return {
    name: name || address,
    address: address || name,
    lat: isNaN(lat) ? null : lat,
    lng: isNaN(lng) ? null : lng,
    categories,
    raw,
  };
}

// ── Markers ────────────────────────────────────────────
function clearAllMarkers() {
  state.markers.forEach(({ marker }) => marker.remove());
  state.markers = [];
}

function makePinIcon(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z"
          fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="#fff" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    className: 'sale-marker',
    html: svg,
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -38],
  });
}

async function placeMarkers() {
  const toGeocode = state.rows.filter(r => r.lat === null || r.lng === null);

  for (let i = 0; i < toGeocode.length; i++) {
    const row = toGeocode[i];
    try {
      const coords = await geocode(row.address);
      if (coords) { row.lat = coords[0]; row.lng = coords[1]; }
    } catch (_) { /* skip */ }
    // small delay to respect Nominatim rate limit
    if (i < toGeocode.length - 1) await sleep(1100);
  }

  state.rows.forEach(row => {
    if (row.lat === null) return;

    const primaryCat = row.categories[0] || 'Uncategorised';
    const color = (state.categories[primaryCat] || {}).color || PALETTE[0];
    const marker = L.marker([row.lat, row.lng], { icon: makePinIcon(color) });

    marker.bindPopup(() => buildPopup(row, marker));
    marker.addTo(state.map);

    state.markers.push({ row, marker, visible: true });
  });

  updateBadge();
}

function buildPopup(row, marker) {
  const el = document.createElement('div');

  const inRoute = state.route.some(s => s.type === 'sale' && s.row === row);

  el.innerHTML = `
    <div class="popup-name">${esc(row.name)}</div>
    <div class="popup-address">${esc(row.address)}</div>
    <div class="popup-cats">${row.categories.map(c => `<span class="popup-cat">${esc(c)}</span>`).join('')}</div>
    <button class="popup-add-btn${inRoute ? ' added' : ''}" data-action="add-stop">
      ${inRoute ? 'Added to Route' : '+ Add to Route'}
    </button>
  `;

  el.querySelector('[data-action="add-stop"]').addEventListener('click', function() {
    if (inRoute) return;
    addSaleStop(row);
    this.classList.add('added');
    this.textContent = 'Added to Route';
    marker.closePopup();
  });

  return el;
}

// ── Category filters ───────────────────────────────────
function renderCategoryFilters() {
  const list = document.getElementById('category-list');
  list.innerHTML = '';

  Object.entries(state.categories).forEach(([cat, { enabled, color }]) => {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <input type="checkbox" id="cat-${esc(cat)}" ${enabled ? 'checked' : ''} />
      <span class="cat-dot" style="background:${color}"></span>
      <label for="cat-${esc(cat)}">${esc(cat)}</label>
      <span class="cat-count">${countForCat(cat)}</span>
    `;
    item.querySelector('input').addEventListener('change', e => {
      state.categories[cat].enabled = e.target.checked;
      applyFilters();
    });
    list.appendChild(item);
  });
}

function countForCat(cat) {
  return state.rows.filter(r => r.categories.includes(cat)).length;
}

function applyFilters() {
  state.markers.forEach(({ row, marker }) => {
    const show = row.categories.some(c => state.categories[c]?.enabled);
    if (show) {
      if (!state.map.hasLayer(marker)) marker.addTo(state.map);
    } else {
      if (state.map.hasLayer(marker)) marker.remove();
    }
  });
  updateBadge();
}

function updateBadge() {
  const visible = state.markers.filter(m => state.map.hasLayer(m.marker)).length;
  document.getElementById('pin-count').textContent = visible;
}

// ── Route builder ──────────────────────────────────────
function addStop(stop) {
  state.route.push({ ...stop, id: ++stopIdCounter });
  renderRoute();
  drawRouteLine();
}

function addSaleStop(row) {
  addStop({ label: row.name, type: 'sale', stopType: 'stop-sale', row, latlng: [row.lat, row.lng] });
}

function removeStop(id) {
  state.route = state.route.filter(s => s.id !== id);
  renderRoute();
  drawRouteLine();
}

function renderRoute() {
  const list = document.getElementById('route-list');
  const empty = document.getElementById('route-empty');

  list.innerHTML = '';

  if (!state.route.length) {
    empty.classList.add('visible');
    return;
  }
  empty.classList.remove('visible');

  state.route.forEach((stop, i) => {
    const el = document.createElement('div');
    el.className = 'route-stop';
    el.dataset.id = stop.id;

    const label = i === 0 ? 'Start' : i === state.route.length - 1 ? 'End' : `${i}`;

    el.innerHTML = `
      <span class="stop-handle">⠿</span>
      <span class="stop-icon ${stop.stopType}">${label}</span>
      <div class="stop-info">
        <div class="stop-name">${esc(stop.label)}</div>
        <div class="stop-type">${stop.type}</div>
      </div>
      <button class="stop-remove" data-id="${stop.id}" aria-label="Remove stop">×</button>
    `;

    el.querySelector('.stop-remove').addEventListener('click', () => removeStop(stop.id));
    list.appendChild(el);
  });

  Sortable.create(list, {
    animation: 150,
    handle: '.stop-handle',
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd() {
      const newOrder = [...list.querySelectorAll('.route-stop')].map(el => parseInt(el.dataset.id));
      state.route.sort((a, b) => newOrder.indexOf(a.id) - newOrder.indexOf(b.id));
      renderRoute();
      drawRouteLine();
    },
  });
}

function drawRouteLine() {
  if (state.routeLayer) { state.routeLayer.remove(); state.routeLayer = null; }

  const coords = state.route.filter(s => s.latlng).map(s => s.latlng);
  if (coords.length < 2) return;

  state.routeLayer = L.polyline(coords, {
    color: '#e85d04',
    weight: 3,
    opacity: 0.85,
    dashArray: '6 4',
  }).addTo(state.map);
}

// ── Geocoding ──────────────────────────────────────────
async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (data.length) return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  return null;
}

async function geocodeAndAdd(inputEl, type, stopType) {
  const val = inputEl.value.trim();
  if (!val) return;

  inputEl.classList.add('geocoding');
  try {
    const coords = await geocode(val);
    if (!coords) { alert(`Could not find "${val}". Try a more specific address.`); return; }

    // Remove existing stop of same type
    state.route = state.route.filter(s => s.type !== type);

    if (type === 'start') {
      state.route.unshift({ id: ++stopIdCounter, label: val, type, stopType, latlng: coords });
    } else if (type === 'end') {
      state.route.push({ id: ++stopIdCounter, label: val, type, stopType, latlng: coords });
    }

    renderRoute();
    drawRouteLine();
    state.map.setView(coords, Math.max(state.map.getZoom(), 14));
  } finally {
    inputEl.classList.remove('geocoding');
  }
}

// ── Utility ────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Event wiring ───────────────────────────────────────
function wireEvents() {
  // CSV drag & drop
  const dropZone = document.getElementById('csv-drop-zone');
  const fileInput = document.getElementById('csv-file-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) readFileCSV(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) readFileCSV(fileInput.files[0]);
  });

  // URL load
  document.getElementById('csv-url-load').addEventListener('click', async () => {
    const url = document.getElementById('csv-url-input').value.trim();
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      const text = await res.text();
      loadCSV(text, url.split('/').pop() || url);
    } catch (e) {
      alert(`Could not load CSV from URL: ${e.message}`);
    }
  });

  // Category filters
  document.getElementById('select-all-cats').addEventListener('click', () => {
    Object.keys(state.categories).forEach(c => state.categories[c].enabled = true);
    renderCategoryFilters();
    applyFilters();
  });

  document.getElementById('clear-all-cats').addEventListener('click', () => {
    Object.keys(state.categories).forEach(c => state.categories[c].enabled = false);
    renderCategoryFilters();
    applyFilters();
  });

  // Route inputs
  document.getElementById('set-start').addEventListener('click', () =>
    geocodeAndAdd(document.getElementById('start-input'), 'start', 'stop-start'));

  document.getElementById('set-end').addEventListener('click', () =>
    geocodeAndAdd(document.getElementById('end-input'), 'end', 'stop-end'));

  document.getElementById('start-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') geocodeAndAdd(e.target, 'start', 'stop-start');
  });
  document.getElementById('end-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') geocodeAndAdd(e.target, 'end', 'stop-end');
  });

  document.getElementById('add-custom-stop').addEventListener('click', () => {
    const input = document.getElementById('custom-stop-input');
    const val = input.value.trim();
    if (!val) return;
    addStop({ label: val, type: 'custom', stopType: 'stop-custom', latlng: null });
    input.value = '';
  });

  document.getElementById('custom-stop-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('add-custom-stop').click();
  });

  document.getElementById('clear-route').addEventListener('click', () => {
    state.route = [];
    renderRoute();
    drawRouteLine();
  });

  document.getElementById('fit-route').addEventListener('click', () => {
    const coords = state.route.filter(s => s.latlng).map(s => s.latlng);
    if (!coords.length && state.markers.length) {
      const group = L.featureGroup(state.markers.map(m => m.marker));
      state.map.fitBounds(group.getBounds().pad(0.1));
    } else if (coords.length) {
      state.map.fitBounds(L.latLngBounds(coords).pad(0.15));
    }
  });

  // Mobile hamburger
  const hamburger = document.getElementById('hamburger');
  const sidebar   = document.getElementById('sidebar');

  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  // Close drawer on map tap (mobile)
  document.getElementById('map').addEventListener('click', () => {
    if (isMobile) sidebar.classList.remove('open');
  });
}

function readFileCSV(file) {
  const reader = new FileReader();
  reader.onload = e => loadCSV(e.target.result, file.name);
  reader.readAsText(file);
}

// ── Boot ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  wireEvents();
  renderRoute(); // show empty state
});

/* =====================================================
   Sale Stomp — app.js  (Google Maps edition)
   ===================================================== */

const GMAPS_KEY_LS  = 'sale-stomp-gmaps-key';
const isMobile      = 'ontouchstart' in window;

// ── Palette ────────────────────────────────────────────
const PALETTE = ['#e85d04','#1a73e8','#2d9e2d','#7c3aed','#d97706','#0891b2','#be185d','#64748b','#15803d','#b45309'];
let paletteIndex = 0;
function nextColor() { return PALETTE[paletteIndex++ % PALETTE.length]; }

// ── State ──────────────────────────────────────────────
const state = {
  rows: [],
  markers: [],         // { row, gMarker, infoWindow }
  categories: {},
  route: [],           // { id, label, type, stopType, latlng, row? }
  routeLine: null,
  map: null,
  mode: 'planning',
  checklist: [],       // { stop, visited, skipped }
  mapHidden: false,
  infoWindows: [],     // all open info windows (to close on new open)
};
let stopIdCounter = 0;

// ── Google Maps init ───────────────────────────────────
function initApp() {
  const savedKey = localStorage.getItem(GMAPS_KEY_LS);
  if (savedKey) {
    loadGoogleMaps(savedKey);
  } else {
    showApiKeyModal();
  }
}

function showApiKeyModal(errorMsg) {
  document.getElementById('api-key-modal').classList.remove('hidden');
  const errEl = document.getElementById('api-key-error');
  if (errorMsg) { errEl.textContent = errorMsg; errEl.classList.remove('hidden'); }
  else { errEl.classList.add('hidden'); }
}

function hideApiKeyModal() {
  document.getElementById('api-key-modal').classList.add('hidden');
}

function loadGoogleMaps(key) {
  if (window.google?.maps) { createMap(); return; }
  window._gmInit = () => { hideApiKeyModal(); createMap(); };

  // Remove any previous failed script
  const old = document.getElementById('gmaps-script');
  if (old) old.remove();

  const s = document.createElement('script');
  s.id  = 'gmaps-script';
  s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=_gmInit`;
  s.onerror = () => showApiKeyModal('Could not load Google Maps. Check your API key and billing, then try again.');
  document.head.appendChild(s);
}

function createMap() {
  // Toronto neighbourhood default
  state.map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 43.663, lng: -0.474 },
    zoom: 14,
    mapTypeControl: false,
    fullscreenControl: false,
    streetViewControl: false,
    styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }],
  });

  wireEvents();
  renderRoute();
}

// ── Markers ────────────────────────────────────────────
function makeGMapIcon(color, scale = 1) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="${24*scale}" height="${36*scale}">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z"
          fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="#fff" opacity="0.9"/>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(24 * scale, 36 * scale),
    anchor: new google.maps.Point(12 * scale, 36 * scale),
  };
}

function clearAllMarkers() {
  state.markers.forEach(({ gMarker, infoWindow }) => {
    gMarker.setMap(null);
    infoWindow.close();
  });
  state.markers = [];
  state.infoWindows = [];
}

async function placeMarkers() {
  // Geocode rows without coords first
  const toGeocode = state.rows.filter(r => r.lat === null);
  for (let i = 0; i < toGeocode.length; i++) {
    try {
      const coords = await geocode(toGeocode[i].address);
      if (coords) { toGeocode[i].lat = coords[0]; toGeocode[i].lng = coords[1]; }
    } catch (_) {}
    if (i < toGeocode.length - 1) await sleep(1100);
  }

  state.rows.forEach(row => {
    if (row.lat === null) return;
    const primaryCat = row.categories[0] || 'Uncategorised';
    const color = state.categories[primaryCat]?.color || PALETTE[0];

    const gMarker = new google.maps.Marker({
      position: { lat: row.lat, lng: row.lng },
      map: state.map,
      icon: makeGMapIcon(color),
      title: row.name,
    });

    const infoWindow = new google.maps.InfoWindow({ content: '' });

    // Hover (desktop only)
    if (!isMobile) {
      gMarker.addListener('mouseover', () => {
        gMarker.setIcon(makeGMapIcon(color, 1.5));
      });
      gMarker.addListener('mouseout', () => {
        gMarker.setIcon(makeGMapIcon(color));
      });
    }

    gMarker.addListener('click', () => {
      closeAllInfoWindows();
      infoWindow.setContent(buildPopupContent(row, gMarker, infoWindow));
      infoWindow.open(state.map, gMarker);
    });

    state.markers.push({ row, gMarker, infoWindow });
    state.infoWindows.push(infoWindow);
  });

  updateBadge();

  if (state.markers.length) {
    const bounds = new google.maps.LatLngBounds();
    state.markers.forEach(m => bounds.extend(m.gMarker.getPosition()));
    state.map.fitBounds(bounds);
  }
}

function closeAllInfoWindows() {
  state.infoWindows.forEach(iw => iw.close());
}

function buildPopupContent(row, gMarker, infoWindow) {
  const inRoute = state.route.some(s => s.type === 'sale' && s.row === row);
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="popup-name">${esc(row.name)}</div>
    <div class="popup-address">${esc(row.address)}</div>
    <div class="popup-cats">${row.categories.slice(0, 8).map(c => `<span class="popup-cat">${esc(cleanCat(c))}</span>`).join('')}</div>
    <button class="popup-add-btn${inRoute ? ' added' : ''}">${inRoute ? '✓ Added to Route' : '+ Add to Route'}</button>
  `;
  div.querySelector('.popup-add-btn').addEventListener('click', function() {
    if (this.classList.contains('added')) return;
    addSaleStop(row);
    this.classList.add('added');
    this.textContent = '✓ Added to Route';
    infoWindow.close();
  });
  return div;
}

// ── CSV loading ────────────────────────────────────────
function loadCSV(csvText, sourceName) {
  const result = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: h => h.trim().toLowerCase().replace(/[\s\n\r]+/g, '_'),
  });

  if (!result.data.length) { alert('Could not parse CSV. Check the file format.'); return; }

  clearAllMarkers();
  state.rows = [];
  state.categories = {};
  paletteIndex = 0;

  result.data.forEach(raw => {
    const row = normaliseRow(raw);
    if (!row) return;
    state.rows.push(row);
    row.categories.forEach(cat => {
      if (!state.categories[cat]) state.categories[cat] = { enabled: true, color: nextColor() };
    });
  });

  renderCategoryFilters();
  placeMarkers();

  const info = document.getElementById('loaded-info');
  info.textContent = `✓ Loaded ${state.rows.length} locations from ${sourceName}`;
  info.classList.add('visible');
}

function normaliseRow(raw) {
  const keys = Object.keys(raw);
  const fuzzyGet = (...terms) => {
    for (const term of terms) {
      if (raw[term] !== undefined && String(raw[term]).trim()) return String(raw[term]).trim();
      const found = keys.find(k => k.includes(term.toLowerCase()));
      if (found && raw[found] !== undefined && String(raw[found]).trim()) return String(raw[found]).trim();
    }
    return '';
  };

  const name    = fuzzyGet('name','title','seller','location_name');
  const address = fuzzyGet('address','location','street','addr');
  const latStr  = fuzzyGet('lat','latitude');
  const lngStr  = fuzzyGet('lng','lon','longitude');
  const catRaw  = fuzzyGet('categories','category','items','tags','selling','type');

  if (!address && !name) return null;

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  const categories = catRaw
    ? catRaw.split(/[|,;]/).map(c => c.trim()).filter(Boolean)
    : ['Uncategorised'];

  return { name: name || address, address: address || name, lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, categories, raw };
}

// ── Filters ────────────────────────────────────────────
function renderCategoryFilters() {
  const list = document.getElementById('category-list');
  list.innerHTML = '';
  Object.entries(state.categories).forEach(([cat, { enabled, color }]) => {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.innerHTML = `
      <input type="checkbox" id="cat-${esc(cat)}" ${enabled ? 'checked' : ''} />
      <span class="cat-dot" style="background:${color}"></span>
      <label for="cat-${esc(cat)}">${esc(cleanCat(cat))}</label>
      <span class="cat-count">${state.rows.filter(r => r.categories.includes(cat)).length}</span>
    `;
    item.querySelector('input').addEventListener('change', e => {
      state.categories[cat].enabled = e.target.checked;
      applyFilters();
    });
    list.appendChild(item);
  });
}

function applyFilters() {
  state.markers.forEach(({ row, gMarker }) => {
    const show = row.categories.some(c => state.categories[c]?.enabled);
    gMarker.setVisible(show);
  });
  updateBadge();
}

function updateBadge() {
  const visible = state.markers.filter(m => m.gMarker.getVisible()).length;
  document.getElementById('pin-count').textContent = visible;
}

// ── Route Builder ──────────────────────────────────────
function addStop(stop) {
  state.route.push({ ...stop, id: ++stopIdCounter });
  renderRoute();
  drawRouteLine();
  updateStartRouteCta();
}

function addSaleStop(row) {
  addStop({ label: row.name, type: 'sale', stopType: 'stop-sale', row, latlng: [row.lat, row.lng] });
}

function removeStop(id) {
  state.route = state.route.filter(s => s.id !== id);
  renderRoute();
  drawRouteLine();
  updateStartRouteCta();
}

function updateStartRouteCta() {
  const section = document.getElementById('start-route-section');
  const hasStops = state.route.length > 0;
  section.style.display = hasStops ? '' : 'none';
}

function renderRoute() {
  const list  = document.getElementById('route-list');
  const empty = document.getElementById('route-empty');
  list.innerHTML = '';

  if (!state.route.length) { empty.classList.add('visible'); return; }
  empty.classList.remove('visible');

  state.route.forEach((stop, i) => {
    const label = i === 0 ? 'S' : i === state.route.length - 1 ? 'E' : `${i}`;
    const el = document.createElement('div');
    el.className = 'route-stop';
    el.dataset.id = stop.id;
    el.innerHTML = `
      <span class="stop-handle">⠿</span>
      <span class="stop-icon ${stop.stopType}">${label}</span>
      <div class="stop-info">
        <div class="stop-name">${esc(stop.label)}</div>
        <div class="stop-type">${stop.type}</div>
      </div>
      <button class="stop-remove" data-id="${stop.id}">×</button>
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
      const order = [...list.querySelectorAll('.route-stop')].map(el => parseInt(el.dataset.id));
      state.route.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      renderRoute();
      drawRouteLine();
    },
  });
}

function drawRouteLine() {
  if (state.routeLine) { state.routeLine.setMap(null); state.routeLine = null; }
  const coords = state.route.filter(s => s.latlng).map(s => ({ lat: s.latlng[0], lng: s.latlng[1] }));
  if (coords.length < 2) return;
  state.routeLine = new google.maps.Polyline({
    path: coords,
    strokeColor: '#e85d04',
    strokeOpacity: 0.85,
    strokeWeight: 3,
    icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '12px' }],
    map: state.map,
  });
}

// ── Checklist ──────────────────────────────────────────
function enterRoutingMode() {
  state.mode = 'routing';
  state.checklist = buildChecklist();

  document.getElementById('planning-panel').classList.add('hidden');
  document.getElementById('routing-panel').classList.remove('hidden');

  renderChecklistHeader();
  renderChecklistList();
}

function exitRoutingMode() {
  state.mode = 'planning';
  document.getElementById('routing-panel').classList.add('hidden');
  document.getElementById('planning-panel').classList.remove('hidden');
  if (state.mapHidden) toggleMapVisibility();
}

function buildChecklist() {
  return state.route.map(stop => ({ stop, visited: false, skipped: false }));
}

function renderChecklistHeader() {
  const total     = state.checklist.filter(c => c.stop.type !== 'start' && c.stop.type !== 'end').length;
  const visited   = state.checklist.filter(c => c.visited).length;
  const skipped   = state.checklist.filter(c => c.skipped).length;
  const remaining = total - visited - skipped;
  const pct       = total > 0 ? Math.round((visited / total) * 100) : 0;

  document.getElementById('checklist-meta').textContent =
    `${state.route.length} stops · ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  document.getElementById('progress-bar').style.width = `${pct}%`;

  document.getElementById('progress-stats').innerHTML = `
    <span class="stat-visited"><span class="stat-dot dot-green"></span>Visited: ${visited}</span>
    <span class="stat-skipped"><span class="stat-dot dot-gray"></span>Skipped: ${skipped}</span>
    <span class="stat-remaining"><span class="stat-dot dot-red"></span>Remaining: ${remaining}</span>
  `;
}

function renderChecklistList() {
  const list = document.getElementById('checklist-list');
  list.innerHTML = '';

  let saleStopNum = 0;

  state.checklist.forEach((item, idx) => {
    const { stop } = item;
    let card;

    if (stop.type === 'start' || stop.type === 'end') {
      card = makeStartEndCard(stop);
    } else if (stop.type === 'custom') {
      card = makeCustomCard(stop);
    } else {
      saleStopNum++;
      card = makeSaleCard(item, idx, saleStopNum);
    }

    list.appendChild(card);
  });
}

function makeStartEndCard(stop) {
  const div = document.createElement('div');
  div.className = 'cl-card-startend';
  div.innerHTML = `
    <div class="cl-se-badge">S/E</div>
    <div>
      <div class="cl-se-label">Start / End</div>
      <div class="cl-se-addr">${esc(stop.label)}</div>
      <div class="cl-se-note">Home base</div>
    </div>
  `;
  return div;
}

function makeCustomCard(stop) {
  const div = document.createElement('div');
  div.className = 'cl-card-custom';
  div.innerHTML = `
    <div class="cl-custom-icon">📍</div>
    <div class="cl-custom-name">${esc(stop.label)}</div>
  `;
  return div;
}

function makeSaleCard(item, idx, num) {
  const { stop, visited, skipped } = item;
  const cats = stop.row
    ? stop.row.categories.slice(0, 6).map(c => cleanCat(c)).join(' · ')
    : '';

  const card = document.createElement('div');
  card.className = `cl-card${visited ? ' visited' : ''}${skipped ? ' skipped' : ''}`;
  card.dataset.idx = idx;

  card.innerHTML = `
    <div class="cl-stop-body">
      <div class="cl-stop-num">${num}</div>
      <div class="cl-stop-info">
        <div class="cl-stop-label">Stop ${num}</div>
        <div class="cl-stop-addr">${esc(stop.label)}</div>
        ${cats ? `<div class="cl-stop-cats">${esc(cats)}</div>` : ''}
      </div>
    </div>
    <div class="cl-stop-actions">
      <button class="cl-btn-visited${visited ? ' active' : ''}" data-idx="${idx}">☑ Visited</button>
      <button class="cl-btn-skip${skipped ? ' active' : ''}" data-idx="${idx}">⟫ Skip</button>
    </div>
  `;

  card.querySelector('.cl-btn-visited').addEventListener('click', () => toggleVisited(idx));
  card.querySelector('.cl-btn-skip').addEventListener('click', () => toggleSkipped(idx));

  return card;
}

function toggleVisited(idx) {
  const item = state.checklist[idx];
  item.visited = !item.visited;
  if (item.visited) item.skipped = false;
  renderChecklistHeader();
  renderChecklistList();
  // pan map to stop if visible
  if (item.stop.latlng && !state.mapHidden) {
    state.map.panTo({ lat: item.stop.latlng[0], lng: item.stop.latlng[1] });
  }
}

function toggleSkipped(idx) {
  const item = state.checklist[idx];
  item.skipped = !item.skipped;
  if (item.skipped) item.visited = false;
  renderChecklistHeader();
  renderChecklistList();
}

function toggleMapVisibility() {
  state.mapHidden = !state.mapHidden;
  const mapEl      = document.getElementById('map-container');
  const sidebar    = document.getElementById('sidebar');
  const toggleBtn  = document.getElementById('toggle-map-btn');
  const mobileBtn  = document.getElementById('map-toggle-mobile');

  mapEl.classList.toggle('hidden-map', state.mapHidden);
  sidebar.classList.toggle('map-hidden', state.mapHidden);
  toggleBtn.textContent  = state.mapHidden ? '🗺 Show Map' : '🗺 Hide Map';
  mobileBtn.textContent  = state.mapHidden ? '🗺' : '🗺';

  if (!state.mapHidden && state.map) {
    setTimeout(() => google.maps.event.trigger(state.map, 'resize'), 300);
  }
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
    state.route = state.route.filter(s => s.type !== type);
    const stop = { id: ++stopIdCounter, label: val, type, stopType, latlng: coords };
    if (type === 'start') state.route.unshift(stop);
    else state.route.push(stop);
    renderRoute();
    drawRouteLine();
    updateStartRouteCta();
    state.map.panTo({ lat: coords[0], lng: coords[1] });
  } finally {
    inputEl.classList.remove('geocoding');
  }
}

// ── Collapsible sections ───────────────────────────────
function wireCollapsibles() {
  document.querySelectorAll('.section-header[data-target]').forEach(btn => {
    const body = document.getElementById(btn.dataset.target);
    btn.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      btn.classList.toggle('collapsed', collapsed);
    });
  });
}

// ── Utility ────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function cleanCat(c) {
  // Strip trailing comma/whitespace, shorten long category names
  return c.trim().replace(/,\s*$/, '');
}

// ── Event wiring ───────────────────────────────────────
function wireEvents() {
  wireCollapsibles();

  // CSV drag & drop
  const dropZone  = document.getElementById('csv-drop-zone');
  const fileInput = document.getElementById('csv-file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') fileInput.click(); });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); const f=e.dataTransfer.files[0]; if(f) readFile(f); });
  fileInput.addEventListener('change', () => { if(fileInput.files[0]) readFile(fileInput.files[0]); });

  // URL load
  document.getElementById('csv-url-load').addEventListener('click', async () => {
    const url = document.getElementById('csv-url-input').value.trim();
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.statusText);
      loadCSV(await res.text(), url.split('/').pop() || url);
    } catch(e) { alert(`Could not load CSV: ${e.message}`); }
  });

  // Filters
  document.getElementById('select-all-cats').addEventListener('click', () => {
    Object.keys(state.categories).forEach(c => state.categories[c].enabled = true);
    renderCategoryFilters(); applyFilters();
  });
  document.getElementById('clear-all-cats').addEventListener('click', () => {
    Object.keys(state.categories).forEach(c => state.categories[c].enabled = false);
    renderCategoryFilters(); applyFilters();
  });

  // Route inputs
  document.getElementById('set-start').addEventListener('click', () => geocodeAndAdd(document.getElementById('start-input'), 'start', 'stop-start'));
  document.getElementById('set-end').addEventListener('click', () => geocodeAndAdd(document.getElementById('end-input'), 'end', 'stop-end'));
  document.getElementById('start-input').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('set-start').click(); });
  document.getElementById('end-input').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('set-end').click(); });

  document.getElementById('add-custom-stop').addEventListener('click', () => {
    const input = document.getElementById('custom-stop-input');
    const val = input.value.trim();
    if (!val) return;
    addStop({ label: val, type: 'custom', stopType: 'stop-custom', latlng: null });
    input.value = '';
  });
  document.getElementById('custom-stop-input').addEventListener('keydown', e => { if(e.key==='Enter') document.getElementById('add-custom-stop').click(); });

  document.getElementById('clear-route').addEventListener('click', () => { state.route=[]; renderRoute(); drawRouteLine(); updateStartRouteCta(); });
  document.getElementById('fit-route').addEventListener('click', () => {
    const coords = state.route.filter(s=>s.latlng).map(s=>s.latlng);
    if (!coords.length && state.markers.length) {
      const bounds = new google.maps.LatLngBounds();
      state.markers.forEach(m => bounds.extend(m.gMarker.getPosition()));
      state.map.fitBounds(bounds);
    } else if (coords.length) {
      const bounds = new google.maps.LatLngBounds();
      coords.forEach(c => bounds.extend({ lat:c[0], lng:c[1] }));
      state.map.fitBounds(bounds);
    }
  });

  // Routing mode
  document.getElementById('start-route-btn').addEventListener('click', enterRoutingMode);
  document.getElementById('back-to-planning').addEventListener('click', exitRoutingMode);
  document.getElementById('toggle-map-btn').addEventListener('click', toggleMapVisibility);

  // Mobile hamburger
  document.getElementById('hamburger').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('map-toggle-mobile').addEventListener('click', toggleMapVisibility);
  document.getElementById('map').addEventListener('click', () => { if(isMobile) document.getElementById('sidebar').classList.remove('open'); });
}

function wireApiKeyModal() {
  document.getElementById('api-key-save').addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (!key) return;
    localStorage.setItem(GMAPS_KEY_LS, key);
    loadGoogleMaps(key);
  });
  document.getElementById('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('api-key-save').click();
  });
}

function readFile(file) {
  const reader = new FileReader();
  reader.onload = e => loadCSV(e.target.result, file.name);
  reader.readAsText(file);
}

// ── Boot ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  wireApiKeyModal();
  initApp();
});

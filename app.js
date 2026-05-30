/* =====================================================
   Sale Stomp — app.js  (hardcoded data edition)
   ===================================================== */

const isMobile = 'ontouchstart' in window;

// ── Palette ────────────────────────────────────────────
const PALETTE = ['#e85d04','#1a73e8','#2d9e2d','#7c3aed','#d97706','#0891b2','#be185d','#64748b','#15803d','#b45309'];
let paletteIndex = 0;
function nextColor() { return PALETTE[paletteIndex++ % PALETTE.length]; }

// ── Category eligibility ───────────────────────────────
const CAT_MAX_LEN = 45;
const CAT_MIN_ROWS = 2;

function buildCategoryIndex(rows) {
  const counts = {};
  rows.forEach(row => {
    const seen = new Set();
    row.rawItems.forEach(item => {
      if (!seen.has(item)) { counts[item] = (counts[item] || 0) + 1; seen.add(item); }
    });
  });
  return new Set(
    Object.entries(counts)
      .filter(([item, count]) => count >= CAT_MIN_ROWS && item.length <= CAT_MAX_LEN)
      .map(([item]) => item)
  );
}

// ── State ──────────────────────────────────────────────
const state = {
  rows: [],
  markers: [],
  categories: {},
  route: [],
  routeLayer: null,
  map: null,
  mode: 'planning',
  checklist: [],
  mapHidden: false,
  routeViewActive: false,
};
let stopIdCounter = 0;

// ── Map init ───────────────────────────────────────────
function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([43.663, -79.474], 15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(state.map);
}

// ── Markers ────────────────────────────────────────────
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
    popupAnchor: [0, -40],
  });
}

function placeMarkers() {
  state.rows.forEach(row => {
    const primaryCat = row.categories[0] || 'Uncategorised';
    const color = state.categories[primaryCat]?.color || PALETTE[0];
    const marker = L.marker([row.lat, row.lng], { icon: makePinIcon(color) });

    if (!isMobile) {
      marker.on('mouseover', () => marker.getElement()?.classList.add('marker-hovered'));
      marker.on('mouseout',  () => marker.getElement()?.classList.remove('marker-hovered'));
    }

    marker.bindPopup(() => buildPopup(row, marker));
    marker.addTo(state.map);
    state.markers.push({ row, marker });
  });

  updateBadge();

  const group = L.featureGroup(state.markers.map(m => m.marker));
  state.map.fitBounds(group.getBounds().pad(0.1));
}

function buildPopup(row, marker) {
  const inRoute = state.route.some(s => s.type === 'sale' && s.row === row);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="popup-name">${esc(row.address)}</div>
    <div class="popup-cats">${(row.rawItems).slice(0, 8).map(c => `<span class="popup-cat">${esc(cleanCat(c))}</span>`).join('')}</div>
    <button class="popup-add-btn${inRoute ? ' added' : ''}">${inRoute ? '✓ Added to Route' : '+ Add to Route'}</button>
  `;
  el.querySelector('.popup-add-btn').addEventListener('click', function () {
    if (this.classList.contains('added')) return;
    addSaleStop(row);
    this.classList.add('added');
    this.textContent = '✓ Added to Route';
    marker.closePopup();
  });
  return el;
}

// ── Load hardcoded data ────────────────────────────────
function loadHardcodedData() {
  paletteIndex = 0;

  // Map SALE_DATA into rows with rawItems
  const parsed = SALE_DATA.map(d => ({
    address: d.address,
    lat: d.lat,
    lng: d.lng,
    rawItems: d.items,
    categories: [],
  }));

  const validCats = buildCategoryIndex(parsed);

  parsed.forEach(row => {
    row.categories = [...new Set(row.rawItems.filter(i => validCats.has(i)))];
    if (!row.categories.length) row.categories = ['Other'];
    state.rows.push(row);
    row.categories.forEach(cat => {
      if (!state.categories[cat]) state.categories[cat] = { enabled: true, color: nextColor() };
    });
  });

  // Populate event info
  const titleEl = document.getElementById('event-title');
  const metaEl  = document.getElementById('event-meta');
  if (titleEl) titleEl.textContent = SALE_EVENT.name;
  if (metaEl)  metaEl.textContent  = `${SALE_EVENT.date} · ${SALE_EVENT.location}`;

  renderCategoryFilters();
  placeMarkers();
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
  const routeRows = new Set(state.route.filter(s => s.row).map(s => s.row));
  state.markers.forEach(({ row, marker }) => {
    // In route-view mode, only show markers that are in the route
    if (state.routeViewActive) {
      const show = routeRows.has(row);
      if (show && !state.map.hasLayer(marker)) marker.addTo(state.map);
      else if (!show && state.map.hasLayer(marker)) marker.remove();
    } else {
      const show = row.categories.some(c => state.categories[c]?.enabled);
      if (show && !state.map.hasLayer(marker)) marker.addTo(state.map);
      else if (!show && state.map.hasLayer(marker)) marker.remove();
    }
  });
  updateBadge();
}

function updateBadge() {
  const visible = state.markers.filter(m => state.map.hasLayer(m.marker)).length;
  document.getElementById('pin-count').textContent = visible;
  updateMobileBadge();
}

// ── Route Builder ──────────────────────────────────────
function addStop(stop) {
  state.route.push({ ...stop, id: ++stopIdCounter });
  renderRoute();
  drawRouteLine();
  updateStartRouteCta();
}

function addSaleStop(row) {
  addStop({ label: row.address, type: 'sale', stopType: 'stop-sale', row, latlng: [row.lat, row.lng] });
}

function removeStop(id) {
  state.route = state.route.filter(s => s.id !== id);
  renderRoute();
  drawRouteLine();
  updateStartRouteCta();
}

function updateStartRouteCta() {
  const hasStops = state.route.length > 0;
  document.getElementById('start-route-section').style.display = hasStops ? '' : 'none';
  document.getElementById('generate-route-wrap').style.display = hasStops ? '' : 'none';
  const clTab = document.getElementById('tab-checklist-btn');
  if (clTab) clTab.style.display = hasStops ? '' : 'none';
}

function generateRoute() {
  const coords = state.route.filter(s => s.latlng).map(s => s.latlng);
  if (!coords.length) { alert('Add at least one stop to generate a route.'); return; }
  state.routeViewActive = true;
  applyFilters();
  if (coords.length > 1) {
    state.map.fitBounds(L.latLngBounds(coords).pad(0.18));
  } else {
    state.map.setView(coords[0], 16);
  }
  if (isMobile) closeMobileSheet();
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
  if (state.routeLayer) { state.routeLayer.remove(); state.routeLayer = null; }
  const coords = state.route.filter(s => s.latlng).map(s => s.latlng);
  if (coords.length < 2) return;
  state.routeLayer = L.polyline(coords, {
    color: '#e85d04', weight: 3, opacity: 0.85, dashArray: '6 4',
  }).addTo(state.map);
}

// ── Checklist ──────────────────────────────────────────
function enterRoutingMode() {
  state.mode = 'routing';
  state.checklist = state.route.map(stop => ({ stop, visited: false, skipped: false }));
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

function renderChecklistHeader() {
  const stops     = state.checklist.filter(c => c.stop.type !== 'start' && c.stop.type !== 'end');
  const visited   = state.checklist.filter(c => c.visited).length;
  const skipped   = state.checklist.filter(c => c.skipped).length;
  const remaining = stops.length - visited - skipped;
  const pct       = stops.length > 0 ? Math.round((visited / stops.length) * 100) : 0;

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
  let saleNum = 0;
  state.checklist.forEach((item, idx) => {
    const { stop } = item;
    let card;
    if (stop.type === 'start' || stop.type === 'end') {
      card = makeStartEndCard(stop);
    } else if (stop.type === 'custom') {
      card = makeCustomCard(stop);
    } else {
      saleNum++;
      card = makeSaleCard(item, idx, saleNum);
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
    <div class="cl-custom-icon"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
    <div class="cl-custom-name">${esc(stop.label)}</div>
  `;
  return div;
}

function makeSaleCard(item, idx, num) {
  const { stop, visited, skipped } = item;
  const cats = stop.row
    ? (stop.row.rawItems).slice(0, 6).map(cleanCat).join(' · ')
    : '';
  const card = document.createElement('div');
  card.className = `cl-card${visited ? ' visited' : ''}${skipped ? ' skipped' : ''}`;
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
      <button class="cl-btn-visited${visited ? ' active' : ''}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Visited</button>
      <button class="cl-btn-skip${skipped ? ' active' : ''}"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg> Skip</button>
    </div>
  `;
  card.querySelector('.cl-btn-visited').addEventListener('click', () => {
    const it = state.checklist[idx];
    it.visited = !it.visited;
    if (it.visited) it.skipped = false;
    if (it.stop.latlng && !state.mapHidden) state.map.panTo(it.stop.latlng);
    renderChecklistHeader();
    renderChecklistList();
  });
  card.querySelector('.cl-btn-skip').addEventListener('click', () => {
    const it = state.checklist[idx];
    it.skipped = !it.skipped;
    if (it.skipped) it.visited = false;
    renderChecklistHeader();
    renderChecklistList();
  });
  return card;
}

function toggleMapVisibility() {
  state.mapHidden = !state.mapHidden;
  document.getElementById('map-container').classList.toggle('hidden-map', state.mapHidden);
  document.getElementById('sidebar').classList.toggle('map-hidden', state.mapHidden);
  const mapIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;margin-right:4px"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`;
  document.getElementById('toggle-map-btn').innerHTML = state.mapHidden ? mapIconSvg + 'Show Map' : mapIconSvg + 'Hide Map';
  if (!state.mapHidden) setTimeout(() => state.map.invalidateSize(), 310);
}

// ── Geocoding (for Start/End address input only) ───────
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
    state.map.setView(coords, Math.max(state.map.getZoom(), 15));
  } finally {
    inputEl.classList.remove('geocoding');
  }
}

// ── Collapsibles ───────────────────────────────────────
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
function cleanCat(c) { return String(c).trim().replace(/,\s*$/, ''); }

// ── Wire all events ────────────────────────────────────
function wireEvents() {
  wireCollapsibles();

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
  const startInput  = document.getElementById('start-input');
  const endInput    = document.getElementById('end-input');
  const customInput = document.getElementById('custom-stop-input');
  document.getElementById('set-start').addEventListener('click', () => geocodeAndAdd(startInput, 'start', 'stop-start'));
  document.getElementById('set-end').addEventListener('click',   () => geocodeAndAdd(endInput,   'end',   'stop-end'));
  startInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('set-start').click(); });
  endInput.addEventListener('keydown',   e => { if (e.key === 'Enter') document.getElementById('set-end').click(); });

  document.getElementById('add-custom-stop').addEventListener('click', () => {
    const val = customInput.value.trim();
    if (!val) return;
    addStop({ label: val, type: 'custom', stopType: 'stop-custom', latlng: null });
    customInput.value = '';
  });
  customInput.addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('add-custom-stop').click(); });

  document.getElementById('clear-route').addEventListener('click', () => {
    state.route = [];
    state.routeViewActive = false;
    renderRoute(); drawRouteLine(); updateStartRouteCta(); applyFilters();
  });
  document.getElementById('fit-route').addEventListener('click', () => {
    const coords = state.route.filter(s => s.latlng).map(s => s.latlng);
    if (!coords.length && state.markers.length) {
      state.map.fitBounds(L.featureGroup(state.markers.map(m => m.marker)).getBounds().pad(0.1));
    } else if (coords.length) {
      state.map.fitBounds(L.latLngBounds(coords).pad(0.15));
    }
  });
  document.getElementById('generate-route-btn').addEventListener('click', generateRoute);

  // Checklist mode
  document.getElementById('start-route-btn').addEventListener('click', () => {
    enterRoutingMode();
    if (isMobile) openMobileTab('checklist');
  });
  document.getElementById('back-to-planning').addEventListener('click', exitRoutingMode);
  document.getElementById('toggle-map-btn').addEventListener('click', toggleMapVisibility);

  // Mobile tab bar
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => openMobileTab(btn.dataset.tab));
  });

  // Close sheet when tapping map
  document.getElementById('map').addEventListener('click', () => {
    if (isMobile) closeMobileSheet();
  });
}

// ── Mobile sheet helpers ───────────────────────────────
let activeTab = null;

function openMobileTab(tab) {
  const sidebar = document.getElementById('sidebar');

  if (activeTab === tab && sidebar.classList.contains('open')) {
    closeMobileSheet();
    return;
  }

  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

  const sectionMap = { filter: 'filter-body', route: 'route-body' };

  if (tab === 'checklist') {
    if (state.mode !== 'routing') enterRoutingMode();
    else {
      document.getElementById('planning-panel').classList.add('hidden');
      document.getElementById('routing-panel').classList.remove('hidden');
    }
  } else {
    if (state.mode === 'routing') {
      document.getElementById('routing-panel').classList.add('hidden');
      document.getElementById('planning-panel').classList.remove('hidden');
      state.mode = 'planning';
    }
    Object.entries(sectionMap).forEach(([key, bodyId]) => {
      const body   = document.getElementById(bodyId);
      const header = body?.previousElementSibling;
      const isTarget = key === tab;
      body?.classList.toggle('collapsed', !isTarget);
      header?.classList.toggle('collapsed', !isTarget);
    });
  }

  sidebar.classList.add('open');
  setTimeout(() => { sidebar.scrollTop = 0; }, 50);
}

function closeMobileSheet() {
  activeTab = null;
  document.getElementById('sidebar').classList.remove('open');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
}

function updateMobileBadge() {
  const el = document.getElementById('mobile-pin-badge');
  if (!el || !state.map) return;
  const count = state.markers.filter(m => state.map.hasLayer(m.marker)).length;
  el.textContent = count ? `${count} locations` : '';
}

// ── Boot ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  wireEvents();
  renderRoute();
  loadHardcodedData();
});

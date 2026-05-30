/* =====================================================
   Sale Stomp — app.js  (Leaflet / OpenStreetMap)
   ===================================================== */

const isMobile = 'ontouchstart' in window;

// ── Palette ────────────────────────────────────────────
const PALETTE = ['#e85d04','#1a73e8','#2d9e2d','#7c3aed','#d97706','#0891b2','#be185d','#64748b','#15803d','#b45309'];
let paletteIndex = 0;
function nextColor() { return PALETTE[paletteIndex++ % PALETTE.length]; }

// ── Category normalisation map ─────────────────────────
// Maps any raw CSV item → a display group name.
// Matching is case-insensitive substring. First match wins.
const CAT_RULES = [
  { match: ['clothing', 'costume', 'apparel', 'outfit', 'wear', 'jacket', 'shirt', 'dress', 'pants', 'shoes', 'boot', 'sock', 'hat', 'scarf', 'glove', 'makeup', 'y2k'], group: 'Clothing & Accessories' },
  { match: ['jewelry', 'jewellery', 'accessori', 'bag', 'purse', 'watch'], group: 'Clothing & Accessories' },
  { match: ['toy', 'game', 'puzzle', 'lego', 'doll', 'action figure', 'balloon'], group: 'Toys & Games' },
  { match: ['book', 'magazine', 'comic'], group: 'Books & Media' },
  { match: ['record', 'cd', 'tape', 'vinyl', 'dvd', 'video game', 'board game'], group: 'Books & Media' },
  { match: ['electronic', 'computer', 'phone', 'tablet', 'camera', 'tv ', 'television', 'speaker', 'headphone', 'appliance', 'soda stream', 'mixmaster'], group: 'Electronics & Appliances' },
  { match: ['tool', 'hardware', 'drill', 'saw', 'wrench'], group: 'Tools & Hardware' },
  { match: ['sport', 'bike', 'bicycle', 'ski', 'skate', 'hockey', 'outdoor play', 'scooter', 'stroller', 'tires', 'rim', 'peloton'], group: 'Sports & Outdoor' },
  { match: ['baby', 'infant', 'toddler', 'kid', 'children', 'crib', 'bassinet', 'car seat', 'nursing', 'playpen', 'lomi'], group: 'Baby & Kids' },
  { match: ['kitchen', 'dish', 'glass', 'mug', 'plate', 'bowl', 'pot', 'pan', 'cutlery', 'silverware', 'crockery', 'cookware', 'crock pot'], group: 'Kitchen & Dining' },
  { match: ['furniture', 'chair', 'table', 'sofa', 'couch', 'desk', 'shelf', 'shelv', 'bed', 'dresser', 'cabinet', 'piano', 'chandelier'], group: 'Furniture & Home' },
  { match: ['mirror', 'art ', 'artwork', 'print', 'paint', 'decor', 'decoration', 'candle', 'lamp', 'light', 'rug', 'curtain', 'vase', 'ceramic', 'pottery'], group: 'Art & Décor' },
  { match: ['food', 'drink', 'bake', 'cookie', 'bread', 'cake', 'lemonade', 'freezie', 'cornbread', 'chocolate'], group: 'Food & Drinks' },
  { match: ['plant', 'garden', 'garden', 'seed', 'pot '], group: 'Garden & Plants' },
  { match: ['craft', 'fabric', 'sewing', 'knit', 'yarn', 'art supply', 'scrapbook', 'junk journal'], group: 'Crafts & Supplies' },
  { match: ['live music', 'music'], group: 'Other' },
];

function normaliseCategory(raw) {
  const lower = raw.toLowerCase();
  for (const { match, group } of CAT_RULES) {
    if (match.some(m => lower.includes(m))) return group;
  }
  return 'Other';
}

// ── State ──────────────────────────────────────────────
const state = {
  rows: [],
  markers: [],       // { row, marker }
  categories: {},
  route: [],         // { id, label, type, stopType, latlng, row? }
  routeLayer: null,
  map: null,
  mode: 'planning',
  checklist: [],     // { stop, visited, skipped }
  mapHidden: false,
  csvUrl: null,      // set when loaded from a URL (enables sharing)
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
function makePinIcon(color, scale = 1) {
  const w = Math.round(24 * scale), h = Math.round(36 * scale);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="${w}" height="${h}">
    <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z"
          fill="${color}" stroke="#fff" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="#fff" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    className: 'sale-marker',
    html: svg,
    iconSize: [w, h],
    iconAnchor: [w / 2, h],
    popupAnchor: [0, -h - 4],
  });
}

function clearAllMarkers() {
  state.markers.forEach(({ marker }) => marker.remove());
  state.markers = [];
}

async function placeMarkers() {
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
    const marker = L.marker([row.lat, row.lng], { icon: makePinIcon(color) });

    if (!isMobile) {
      marker.on('mouseover', () => marker.setIcon(makePinIcon(color, 1.55)));
      marker.on('mouseout',  () => marker.setIcon(makePinIcon(color)));
    }

    marker.bindPopup(() => buildPopup(row, marker));
    marker.addTo(state.map);
    state.markers.push({ row, marker });
  });

  updateBadge();

  if (state.markers.length) {
    const group = L.featureGroup(state.markers.map(m => m.marker));
    state.map.fitBounds(group.getBounds().pad(0.1));
  }
}

function buildPopup(row, marker) {
  const inRoute = state.route.some(s => s.type === 'sale' && s.row === row);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="popup-name">${esc(row.name)}</div>
    <div class="popup-address">${esc(row.address)}</div>
    <div class="popup-cats">${(row.rawCategories || row.categories).slice(0, 8).map(c => `<span class="popup-cat">${esc(cleanCat(c))}</span>`).join('')}</div>
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

  const name    = fuzzyGet('name', 'title', 'seller', 'location_name');
  const address = fuzzyGet('address', 'location', 'street', 'addr');
  const latStr  = fuzzyGet('lat', 'latitude');
  const lngStr  = fuzzyGet('lng', 'lon', 'longitude');
  const catRaw  = fuzzyGet('categories', 'category', 'items', 'tags', 'selling', 'type');

  if (!address && !name) return null;

  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  // Parse raw items then map each to a normalised group; deduplicate
  const rawItems = catRaw ? catRaw.split(/[|,;]/).map(c => c.trim()).filter(Boolean) : [];
  const categories = rawItems.length
    ? [...new Set(rawItems.map(normaliseCategory))]
    : ['Other'];

  // Keep original items for popup display (before grouping)
  const rawCategories = rawItems.length ? rawItems : ['Other'];

  return { name: name || address, address: address || name, lat: isNaN(lat) ? null : lat, lng: isNaN(lng) ? null : lng, categories, rawCategories };
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
  state.markers.forEach(({ row, marker }) => {
    const show = row.categories.some(c => state.categories[c]?.enabled);
    if (show && !state.map.hasLayer(marker)) marker.addTo(state.map);
    else if (!show && state.map.hasLayer(marker)) marker.remove();
  });
  updateBadge();
}

function updateBadge() {
  const visible = state.markers.filter(m => state.map.hasLayer(m.marker)).length;
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
  document.getElementById('start-route-section').style.display = state.route.length ? '' : 'none';
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
    <div class="cl-custom-icon">📍</div>
    <div class="cl-custom-name">${esc(stop.label)}</div>
  `;
  return div;
}

function makeSaleCard(item, idx, num) {
  const { stop, visited, skipped } = item;
  const cats = stop.row
    ? (stop.row.rawCategories || stop.row.categories).slice(0, 6).map(cleanCat).join(' · ')
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
      <button class="cl-btn-visited${visited ? ' active' : ''}">☑ Visited</button>
      <button class="cl-btn-skip${skipped ? ' active' : ''}">⟫ Skip</button>
    </div>
  `;
  card.querySelector('.cl-btn-visited').addEventListener('click', () => {
    const item = state.checklist[idx];
    item.visited = !item.visited;
    if (item.visited) item.skipped = false;
    if (item.stop.latlng && !state.mapHidden) state.map.panTo(item.stop.latlng);
    renderChecklistHeader();
    renderChecklistList();
  });
  card.querySelector('.cl-btn-skip').addEventListener('click', () => {
    const item = state.checklist[idx];
    item.skipped = !item.skipped;
    if (item.skipped) item.visited = false;
    renderChecklistHeader();
    renderChecklistList();
  });
  return card;
}

function toggleMapVisibility() {
  state.mapHidden = !state.mapHidden;
  document.getElementById('map-container').classList.toggle('hidden-map', state.mapHidden);
  document.getElementById('sidebar').classList.toggle('map-hidden', state.mapHidden);
  document.getElementById('toggle-map-btn').textContent = state.mapHidden ? '🗺 Show Map' : '🗺 Hide Map';
  if (!state.mapHidden) setTimeout(() => state.map.invalidateSize(), 310);
}

// ── Geocoding (Nominatim — free, no key) ──────────────
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
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function cleanCat(c) { return String(c).trim().replace(/,\s*$/, ''); }

// ── Wire all events ────────────────────────────────────
function wireEvents() {
  wireCollapsibles();

  // CSV
  const dropZone  = document.getElementById('csv-drop-zone');
  const fileInput = document.getElementById('csv-file-input');
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') fileInput.click(); });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) readFile(fileInput.files[0]); });

  document.getElementById('csv-url-load').addEventListener('click', () => loadFromUrl(document.getElementById('csv-url-input').value.trim()));

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
  document.getElementById('set-end').addEventListener('click', () => geocodeAndAdd(endInput, 'end', 'stop-end'));
  startInput.addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('set-start').click(); });
  endInput.addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('set-end').click(); });

  document.getElementById('add-custom-stop').addEventListener('click', () => {
    const val = customInput.value.trim();
    if (!val) return;
    addStop({ label: val, type: 'custom', stopType: 'stop-custom', latlng: null });
    customInput.value = '';
  });
  customInput.addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('add-custom-stop').click(); });

  document.getElementById('clear-route').addEventListener('click', () => {
    state.route = []; renderRoute(); drawRouteLine(); updateStartRouteCta();
  });
  document.getElementById('fit-route').addEventListener('click', () => {
    const coords = state.route.filter(s => s.latlng).map(s => s.latlng);
    if (!coords.length && state.markers.length) {
      state.map.fitBounds(L.featureGroup(state.markers.map(m => m.marker)).getBounds().pad(0.1));
    } else if (coords.length) {
      state.map.fitBounds(L.latLngBounds(coords).pad(0.15));
    }
  });

  // Share
  document.getElementById('share-btn').addEventListener('click', shareMap);

  // Checklist mode
  document.getElementById('start-route-btn').addEventListener('click', enterRoutingMode);
  document.getElementById('back-to-planning').addEventListener('click', exitRoutingMode);
  document.getElementById('toggle-map-btn').addEventListener('click', toggleMapVisibility);

  // Mobile
  document.getElementById('hamburger').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
  document.getElementById('map').addEventListener('click', () => { if (isMobile) document.getElementById('sidebar').classList.remove('open'); });
}

function readFile(file) {
  state.csvUrl = null; // file upload — not shareable
  updateShareBtn();
  const reader = new FileReader();
  reader.onload = e => loadCSV(e.target.result, file.name);
  reader.readAsText(file);
}

async function loadFromUrl(url) {
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.statusText);
    state.csvUrl = url;
    loadCSV(await res.text(), url.split('/').pop() || url);
    updateShareBtn();
  } catch (e) { alert(`Could not load CSV: ${e.message}`); }
}

// ── Share ──────────────────────────────────────────────
function updateShareBtn() {
  const btn = document.getElementById('share-btn');
  const tip = document.getElementById('share-tip');
  if (state.csvUrl) {
    btn.disabled = false;
    btn.title = '';
    tip.classList.add('hidden');
  } else {
    btn.disabled = true;
    btn.title = 'Load the CSV from a URL first to enable sharing';
  }
}

function shareMap() {
  const shareUrl = `${location.origin}${location.pathname}#csv=${encodeURIComponent(state.csvUrl)}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    const btn = document.getElementById('share-btn');
    const orig = btn.textContent;
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = orig; }, 2200);
  }).catch(() => {
    // fallback: show the URL in a prompt so they can copy manually
    window.prompt('Copy this link to share your map:', shareUrl);
  });
}

// ── Hash-based auto-load ───────────────────────────────
function checkHashAutoLoad() {
  const hash = location.hash.slice(1); // remove leading #
  const params = new URLSearchParams(hash);
  const csvUrl = params.get('csv');
  if (csvUrl) {
    document.getElementById('csv-url-input').value = csvUrl;
    loadFromUrl(csvUrl);
  }
}

// ── Boot ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  wireEvents();
  renderRoute();
  updateShareBtn();
  checkHashAutoLoad();
});

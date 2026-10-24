const MANILA = { lat: 14.5995, lng: 120.9842 };
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MODES = [
  ['Drive', 'driving'],
  ['Motorcycle', 'two-wheeler'],
  ['Commute', 'transit'],
  ['Walk', 'walking'],
];

let userLoc = MANILA;
let map = null;
let userMarker = null;
let markers = [];
let companies = [];
let userPicked = false; // a map click wins over a late geolocation answer

const $ = (id) => document.getElementById(id);

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

function setLocation(loc, label) {
  userLoc = loc;
  $('location').textContent = `Searching near: ${label} (${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})`;
  if (userMarker) userMarker.setLatLng(loc);
}

function showMapMessage(text) {
  const p = document.createElement('p');
  p.className = 'map-message';
  p.textContent = text;
  $('map').replaceChildren(p);
}

function initMap() {
  if (!window.L) {
    showMapMessage('The map could not load. You can still search; results appear in the list.');
    return;
  }
  map = L.map('map').setView(userLoc, 12);
  // shortcut: OSM's public tiles are for light use only; switch to a tile provider before a public launch.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.on('click', (e) => {
    userPicked = true;
    setLocation({ lat: e.latlng.lat, lng: e.latlng.lng }, 'map point you picked');
  });
  userMarker = L.circleMarker(userLoc, { radius: 8, color: '#b91c1c' }).addTo(map).bindTooltip('You');
}

function initLocation() {
  const fallback = () => userPicked || setLocation(MANILA, 'Metro Manila (default)');
  if (!navigator.geolocation) return fallback();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (userPicked) return;
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocation(loc, 'your current location');
      if (map) map.setView(loc);
    },
    fallback,
    { timeout: 10000 },
  );
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function safeHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function directionsUrl(c, mode) {
  const u = new URL('https://www.google.com/maps/dir/');
  u.search = new URLSearchParams({
    api: '1',
    destination: `${c.lat},${c.lng}`,
    travelmode: mode,
  });
  return u.href;
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(href, text) {
  const a = el('a', text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function companyDetails(c) {
  const box = el('div', null, 'company');
  box.append(el('h3', c.name));
  if (c.address) box.append(el('p', c.address));
  const site = safeHttpUrl(c.website);
  if (site) {
    const p = el('p');
    p.append(link(site, 'Website'));
    box.append(p);
  }
  if (c.why) box.append(el('p', `Why it matches: ${c.why}`, 'why'));
  const dirs = el('p', 'Directions: ', 'directions');
  MODES.forEach(([label, mode], i) => {
    if (i) dirs.append(' · ');
    dirs.append(link(directionsUrl(c, mode), label));
  });
  box.append(dirs);
  return box;
}

// Details always go in the sidebar too, so keyboard and screen-reader users never depend on the map popup.
function showCompany(i) {
  $('details').replaceChildren(companyDetails(companies[i]));
  markers[i]?.openPopup();
}

function renderMarkers() {
  markers.forEach((m) => m.remove());
  markers = [];
  if (!map || !companies.length) return;
  markers = companies.map((c) => L.marker(c, { title: c.name, alt: c.name })
    .addTo(map)
    .bindPopup(() => companyDetails(c)));
  map.fitBounds(L.latLngBounds([userLoc, ...companies]), { padding: [24, 24] });
}

function renderResults(data) {
  const profile = data.profile || {};
  $('profile-titles').textContent = (profile.titles || []).join(', ') || '—';
  $('profile-skills').textContent = (profile.skills || []).join(', ') || '—';
  $('profile').hidden = false;

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  $('jobs-heading').hidden = !jobs.length;
  $('jobs').replaceChildren(...jobs.map((j) => {
    const li = el('li');
    const href = safeHttpUrl(j.link);
    const title = el('p', null, 'job-title');
    title.append(href ? link(href, j.title) : j.title);
    li.append(title);
    const meta = [j.company, j.location, j.salary].filter(Boolean).join(' · ');
    if (meta) li.append(el('p', meta, 'address'));
    if (j.snippet) li.append(el('p', j.snippet, 'snippet'));
    return li;
  }));

  companies = Array.isArray(data.companies) ? data.companies : [];
  $('details').replaceChildren();
  $('results-heading').hidden = false;
  $('results').replaceChildren(...companies.map((c, i) => {
    const li = el('li');
    const btn = el('button', c.name);
    btn.type = 'button';
    btn.addEventListener('click', () => showCompany(i));
    li.append(btn);
    if (c.address) li.append(el('span', c.address, 'address'));
    return li;
  }));
  renderMarkers();
  const found = [jobs.length && `${jobs.length} job openings`, companies.length && `${companies.length} companies`].filter(Boolean);
  setStatus(found.length ? `Found ${found.join(' and ')}.` : 'No matching companies or jobs found near this location.');
}

async function onSubmit(e) {
  e.preventDefault();
  const file = $('resume').files[0];
  if (!file) return setStatus('Choose a PDF resume first.', true);
  if (file.type && file.type !== 'application/pdf') return setStatus('The resume must be a PDF file.', true);
  if (file.size > MAX_PDF_BYTES) return setStatus('The PDF is larger than 5 MB. Please upload a smaller file.', true);

  const btn = $('search-btn');
  btn.disabled = true;
  document.body.setAttribute('aria-busy', 'true');
  setStatus('Reading your resume and finding companies… this can take about 15 seconds.');
  try {
    const pdfBase64 = await readAsBase64(file);
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfBase64, lat: userLoc.lat, lng: userLoc.lng }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Search failed (HTTP ${res.status}).`);
    renderResults(data);
  } catch (err) {
    setStatus(err.message || 'Search failed. Please try again.', true);
  } finally {
    btn.disabled = false;
    document.body.removeAttribute('aria-busy');
  }
}

$('search-form').addEventListener('submit', onSubmit);
initMap();
initLocation();

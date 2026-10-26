const MANILA = { lat: 14.5995, lng: 120.9842 };
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MODES = [
  ['Drive', 'driving'],
  ['Motorcycle', 'two-wheeler'],
  ['Commute', 'transit'],
  ['Walk', 'walking'],
];
// In-app routes from FOSSGIS's free OSRM servers (the ones openstreetmap.org uses): [label, server profile, OSRM mode].
// shortcut: public servers are for light use and have no traffic or transit data; use a hosted router for real traffic.
const ROUTES = [
  ['Drive', 'routed-car', 'driving'],
  ['Walk', 'routed-foot', 'foot'],
];

let userLoc = MANILA;
let map = null;
let userMarker = null;
let markers = [];
let companies = [];
let active = -1; // index of the selected company
let routeLayer = null;
let routeRequest = 0; // answers to superseded route requests are ignored
let userPicked = false; // a map click wins over a late geolocation answer
let topTitle = ''; // first job title from the last resume search; narrows the feed's openings
let feedItems = [];
let feedFilter = 'all';
let feedKey = ''; // area + title the feed was loaded for
let feedLoadedAt = 0;
let feedRequest = 0; // answers to superseded feed requests are ignored

const $ = (id) => document.getElementById(id);

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(href, text, className) {
  const a = el('a', text, className);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  return a;
}

function setStatus(text, isError = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', isError);
}

function setLocation(loc, label) {
  userLoc = loc;
  $('location').replaceChildren(el('span', label, 'loc-name'), el('span', `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`, 'loc-coords'));
  if (userMarker) userMarker.setLatLng(loc);
  if (!$('view-feed').hidden) loadFeed();
}

function showMapMessage(text) {
  $('map').replaceChildren(el('p', text, 'map-message'));
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
    $('area-select').value = 'map';
    setLocation({ lat: e.latlng.lat, lng: e.latlng.lng }, 'Point picked on the map');
  });
  userMarker = L.marker(userLoc, {
    icon: L.divIcon({ className: 'pin-you', iconSize: [18, 18] }),
    keyboard: false,
    zIndexOffset: -100,
  }).addTo(map).bindTooltip('Search area', { direction: 'top', offset: [0, -10] });
}

function useCurrentLocation() {
  userPicked = false;
  $('location').textContent = 'Getting your location...';
  // Without location access, fall back to Manila and say so in the dropdown and the label.
  const fallback = () => {
    if (userPicked) return;
    $('area-select').value = '14.5995,120.9842';
    setLocation(MANILA, 'Manila (your location is unavailable)');
    if (map) map.setView(MANILA, 12);
  };
  if (!navigator.geolocation) return fallback();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (userPicked) return;
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocation(loc, 'Your current location');
      if (map) map.setView(loc, 13);
    },
    fallback,
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

function onAreaChange() {
  const select = $('area-select');
  if (select.value === 'current') return useCurrentLocation();
  if (select.value === 'map') return;
  userPicked = true; // a late geolocation answer must not override a chosen city
  const [lat, lng] = select.value.split(',').map(Number);
  setLocation({ lat, lng }, select.selectedOptions[0].textContent);
  if (map) map.setView([lat, lng], 13);
}

/* ---------- Upload ---------- */

function showFile() {
  const file = $('resume').files[0];
  $('dropzone').classList.toggle('has-file', !!file);
  $('file-name').textContent = file ? file.name : 'Drop your resume here';
  $('file-hint').textContent = file
    ? `${Math.max(1, Math.round(file.size / 1024))} KB. Click or drop to change.`
    : 'or click to browse. PDF up to 5 MB.';
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

/* ---------- Results ---------- */

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
  u.search = new URLSearchParams({ api: '1', destination: `${c.lat},${c.lng}`, travelmode: mode });
  return u.href;
}

function clearRoute() {
  routeRequest++;
  routeLayer?.remove();
  routeLayer = null;
}

function formatDuration(seconds) {
  const min = Math.max(1, Math.round(seconds / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

async function showRoute(c, [label, profile, mode], button, out) {
  const req = ++routeRequest;
  for (const b of button.parentNode.children) b.setAttribute('aria-pressed', String(b === button));
  out.classList.remove('error');
  out.textContent = 'Finding a route...';
  try {
    const res = await fetch(`https://routing.openstreetmap.de/${profile}/route/v1/${mode}/${userLoc.lng},${userLoc.lat};${c.lng},${c.lat}?overview=full&geometries=geojson`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (!res.ok || data.code !== 'Ok' || !route) throw new Error('no route');
    if (req !== routeRequest) return;
    const line = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    routeLayer?.remove();
    if (map) {
      // A dark casing under the line keeps it readable over busy streets; walking routes are dashed.
      routeLayer = L.layerGroup([
        L.polyline(line, { color: '#0b0e12', weight: 9, opacity: 0.85, interactive: false }),
        L.polyline(line, {
          color: label === 'Walk' ? '#e8ebf0' : '#f5b72e',
          weight: 5,
          lineCap: 'square',
          dashArray: label === 'Walk' ? '10 8' : null,
          interactive: false,
          attribution: 'Routes &copy; <a href="https://routing.openstreetmap.de/">FOSSGIS OSRM</a>',
        }),
      ]).addTo(map);
      map.fitBounds(L.latLngBounds(line), { padding: [48, 48] });
      map.getContainer().scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    out.textContent = `${label} from your search area: ${(route.distance / 1000).toFixed(1)} km, about ${formatDuration(route.duration)}${label === 'Drive' ? ' without traffic' : ''}.`;
  } catch {
    if (req !== routeRequest) return;
    out.classList.add('error');
    out.textContent = 'Could not find a route. Try the Google Maps links below.';
  }
}

// withHead adds the name and address, which the list row already shows but the map popup needs.
function companyDetails(c, withHead) {
  const box = el('div', null, 'detail');
  if (withHead) {
    const head = el('div', null, 'detail-head');
    head.append(el('h3', c.name));
    if (c.address) head.append(el('p', c.address));
    box.append(head);
  }
  if (c.why) {
    const why = el('p', null, 'why');
    why.append(el('span', 'Why it fits', 'eyebrow'), c.why);
    box.append(why);
  }
  const site = safeHttpUrl(c.website);
  if (site) {
    const p = el('p', null, 'site');
    p.append(link(site, 'Visit website'));
    box.append(p);
  }
  const routes = el('div', null, 'directions');
  const routeGrid = el('div', null, 'dir-grid route-grid');
  const out = el('p', null, 'route-result');
  out.setAttribute('aria-live', 'polite');
  for (const route of ROUTES) {
    const b = el('button', route[0]);
    b.type = 'button';
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => showRoute(c, route, b, out));
    routeGrid.append(b);
  }
  routes.append(el('span', 'Route on map', 'eyebrow'), routeGrid, out);

  const dirs = el('div', null, 'directions');
  const grid = el('div', null, 'dir-grid');
  for (const [label, mode] of MODES) grid.append(link(directionsUrl(c, mode), label));
  dirs.append(el('span', 'Navigate in Google Maps', 'eyebrow'), grid);
  box.append(routes, dirs);
  return box;
}

function selectTab(name, focus = false) {
  for (const t of ['jobs', 'companies']) {
    const on = t === name;
    const tab = $(`tab-${t}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${t}`).hidden = !on;
    if (on && focus) tab.focus();
  }
}

// Expands the company in the list and highlights its marker. fromMap: the marker was clicked, so its popup is already opening.
function showCompany(i, fromMap = false) {
  if (active >= 0 && active !== i) {
    clearRoute();
    const prev = $(`company-${active}`);
    prev?.classList.remove('is-active');
    prev?.querySelector('.company-row').setAttribute('aria-expanded', 'false');
    prev?.querySelector('.company-details').replaceChildren();
    prev?.querySelector('.company-details').setAttribute('hidden', '');
    markers[active]?.getElement()?.classList.remove('is-active');
    markers[active]?.setZIndexOffset(0);
  }
  active = i;
  const item = $(`company-${i}`);
  item.classList.add('is-active');
  item.querySelector('.company-row').setAttribute('aria-expanded', 'true');
  const details = item.querySelector('.company-details');
  details.replaceChildren(companyDetails(companies[i], false));
  details.hidden = false;
  markers[i]?.getElement()?.classList.add('is-active');
  markers[i]?.setZIndexOffset(1000);

  if (fromMap) {
    selectTab('companies');
    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } else {
    markers[i]?.openPopup();
  }
}

function renderMarkers() {
  markers.forEach((m) => m.remove());
  markers = [];
  if (!map || !companies.length) return;
  markers = companies.map((c, i) => L.marker(c, {
    icon: L.divIcon({ className: 'pin', html: String(i + 1), iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] }),
    title: c.name,
  })
    .addTo(map)
    // Top-left padding keeps the popup clear of the zoom buttons.
    .bindPopup(() => companyDetails(c, true), { minWidth: 240, maxWidth: 300, autoPanPaddingTopLeft: [56, 16] })
    .on('click', () => showCompany(i, true)));
  map.fitBounds(L.latLngBounds([userLoc, ...companies]), { padding: [32, 32] });
}

function renderTags(id, items) {
  $(id).replaceChildren(...(items.length ? items : ['None found']).map((t) => el('li', t)));
}

function renderJobs(jobs) {
  $('jobs-count').textContent = jobs.length;
  if (!jobs.length) {
    $('jobs').replaceChildren(el('li', 'No job openings found for your top job title in this city. Try another search area.', 'empty'));
    return;
  }
  $('jobs').replaceChildren(...jobs.map((j) => {
    const li = el('li', null, 'job');
    const href = safeHttpUrl(j.link);
    li.append(href ? link(href, j.title, 'job-title') : el('p', j.title, 'job-title'));
    const meta = el('p', null, 'job-meta');
    for (const part of [j.company, j.location]) if (part) meta.append(el('span', part));
    if (meta.childNodes.length) li.append(meta);
    if (j.salary) li.append(el('p', j.salary, 'job-salary'));
    if (j.snippet) li.append(el('p', j.snippet, 'job-snippet'));
    return li;
  }));
}

function renderCompanies() {
  $('companies-count').textContent = companies.length;
  if (!companies.length) {
    $('results').replaceChildren(el('li', 'No matching companies found near this location. Try another search area.', 'empty'));
    return;
  }
  $('results').replaceChildren(...companies.map((c, i) => {
    const li = el('li', null, 'company-item');
    li.id = `company-${i}`;
    const row = el('button', null, 'company-row');
    row.type = 'button';
    row.setAttribute('aria-expanded', 'false');
    row.setAttribute('aria-controls', `company-${i}-details`);
    const text = el('span');
    text.append(el('span', c.name, 'company-name'));
    if (c.address) text.append(el('span', c.address, 'company-addr'));
    row.append(el('span', String(i + 1), 'num'), text);
    row.addEventListener('click', () => showCompany(i));
    const details = el('div', null, 'company-details');
    details.id = `company-${i}-details`;
    details.hidden = true;
    li.append(row, details);
    return li;
  }));
}

function renderResults(data) {
  const profile = data.profile || {};
  topTitle = profile.titles?.[0] ?? '';
  renderTags('profile-titles', profile.titles || []);
  renderTags('profile-skills', profile.skills || []);
  $('profile').hidden = false;

  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  companies = Array.isArray(data.companies) ? data.companies : [];
  active = -1;
  clearRoute();
  renderJobs(jobs);
  renderCompanies();
  renderMarkers();

  $('welcome').hidden = true;
  $('result-tabs').hidden = false;
  selectTab(jobs.length || !companies.length ? 'jobs' : 'companies');
  const found = [jobs.length && `${jobs.length} job openings`, companies.length && `${companies.length} companies`].filter(Boolean);
  setStatus(found.length ? `Found ${found.join(' and ')}.` : 'No matching jobs or companies found near this location.');
}

async function onSubmit(e) {
  e.preventDefault();
  const file = $('resume').files[0];
  if (!file) return setStatus('Choose a PDF resume first.', true);
  if (file.type && file.type !== 'application/pdf') return setStatus('The resume must be a PDF file.', true);
  if (file.size > MAX_PDF_BYTES) return setStatus('The PDF is larger than 5 MB. Please upload a smaller file.', true);

  const btn = $('search-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Searching...';
  document.body.setAttribute('aria-busy', 'true');
  setStatus('Reading your resume and finding matches. This can take up to 15 seconds.');
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
    btn.textContent = label;
    document.body.removeAttribute('aria-busy');
  }
}

/* ---------- Feed ---------- */

const FEED_STALE_MS = 10 * 60 * 1000;

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h ago`;
  const days = Math.round(min / (24 * 60));
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function selectView(name, focus = false) {
  for (const v of ['search', 'feed']) {
    const on = v === name;
    const tab = $(`tab-${v}`);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`view-${v}`).hidden = !on;
    if (on && focus) tab.focus();
  }
  if (name === 'feed') loadFeed();
}

async function loadFeed() {
  const key = `${userLoc.lat.toFixed(2)},${userLoc.lng.toFixed(2)}|${topTitle}`;
  if (key === feedKey && Date.now() - feedLoadedAt < FEED_STALE_MS) return;
  const req = ++feedRequest;
  feedKey = key;
  $('feed-status').classList.remove('error');
  $('feed-status').textContent = 'Loading the latest openings and news...';
  $('feed-context').textContent = topTitle
    ? `New "${topTitle}" openings from the last 3 days, plus hiring news from Philippine outlets.`
    : 'New openings from the last 3 days, plus hiring news from Philippine outlets. Search with your resume to match openings to your job title.';
  try {
    const params = new URLSearchParams({ lat: userLoc.lat, lng: userLoc.lng });
    if (topTitle) params.set('title', topTitle);
    const res = await fetch(`/api/feed?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not load the feed (HTTP ${res.status}).`);
    if (req !== feedRequest) return;
    feedLoadedAt = Date.now();
    $('feed-city').textContent = data.city || 'your area';
    feedItems = [
      ...(data.jobs || []).map((j) => ({ kind: 'job', time: j.posted, ...j })),
      ...(data.news || []).map((n) => ({ kind: 'news', time: n.published, ...n })),
    ].sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
    $('feed-status').textContent = '';
    renderFeed();
  } catch (err) {
    if (req !== feedRequest) return;
    feedKey = ''; // let the next open retry
    $('feed-status').classList.add('error');
    $('feed-status').textContent = err.message || 'Could not load the feed.';
  }
}

function feedCard(item) {
  const li = el('li', null, `feed-card is-${item.kind}`);
  const meta = el('p', null, 'feed-meta');
  meta.append(el('span', item.kind === 'job' ? 'New opening' : 'News', 'feed-kind'), el('span', timeAgo(item.time), 'feed-time'));
  li.append(meta);
  const href = safeHttpUrl(item.link);
  li.append(href ? link(href, item.title, 'feed-title') : el('p', item.title, 'feed-title'));
  const sub = el('p', null, 'feed-sub');
  for (const part of item.kind === 'job' ? [item.company, item.location] : [item.source]) if (part) sub.append(el('span', part));
  if (sub.childNodes.length) li.append(sub);
  if (item.kind === 'job' && item.salary) li.append(el('p', item.salary, 'job-salary'));
  return li;
}

function renderFeed() {
  const items = feedItems.filter((i) => feedFilter === 'all' || i.kind === feedFilter);
  if (!items.length) {
    const empty = {
      all: 'Nothing new right now. Try another search area.',
      job: 'No openings from the last 3 days in this area. Try another search area.',
      news: 'No hiring news in the last 30 days yet. Headlines build up as Philippine outlets publish them.',
    }[feedFilter];
    $('feed').replaceChildren(el('li', empty, 'empty'));
    return;
  }
  $('feed').replaceChildren(...items.map(feedCard));
}

/* ---------- Wiring ---------- */

for (const v of ['search', 'feed']) $(`tab-${v}`).addEventListener('click', () => selectView(v));
$('view-switch').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  selectView($('tab-search').getAttribute('aria-selected') === 'true' ? 'feed' : 'search', true);
});
for (const chip of document.querySelectorAll('.chips button')) {
  chip.addEventListener('click', () => {
    feedFilter = chip.dataset.filter;
    for (const c of document.querySelectorAll('.chips button')) c.setAttribute('aria-pressed', String(c === chip));
    renderFeed();
  });
}

$('search-form').addEventListener('submit', onSubmit);
$('resume').addEventListener('change', showFile);
for (const type of ['dragenter', 'dragover']) $('resume').addEventListener(type, () => $('dropzone').classList.add('is-dragging'));
for (const type of ['dragleave', 'drop']) $('resume').addEventListener(type, () => $('dropzone').classList.remove('is-dragging'));

for (const name of ['jobs', 'companies']) $(`tab-${name}`).addEventListener('click', () => selectTab(name));
$('result-tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  selectTab($('tab-jobs').getAttribute('aria-selected') === 'true' ? 'companies' : 'jobs', true);
});

$('area-select').addEventListener('change', onAreaChange);

initMap();
useCurrentLocation();

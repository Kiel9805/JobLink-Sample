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
let maps = null; // { Map, InfoWindow, Marker, LatLngBounds } once loaded
let infoWindow = null;
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
  if (!map) return;
  if (userMarker) userMarker.setPosition(loc);
  else userMarker = new maps.Marker({ map, position: loc, title: 'Your location', label: 'You' });
}

function showMapMessage(text) {
  const p = document.createElement('p');
  p.className = 'map-message';
  p.textContent = text;
  $('map').replaceChildren(p);
}

// Official Maps JS dynamic-loader bootstrap, wrapped so the key comes from /api/config.
function loadMapsBootstrap(key) {
  (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
    key,
    v: 'weekly',
  });
}

async function initMap() {
  let key;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    key = (await res.json()).mapsBrowserKey;
  } catch {
    key = null;
  }
  if (!key) {
    showMapMessage('The map is unavailable (no Maps key configured). You can still search; results appear in the list.');
    return;
  }

  // Google calls this global when the key is rejected (bad key, wrong referrer, API not enabled).
  window.gm_authFailure = () => {
    map = null;
    showMapMessage('The map could not load: the Maps key was rejected. You can still search; results appear in the list.');
  };

  try {
    loadMapsBootstrap(key);
    const [{ Map, InfoWindow }, { Marker }, { LatLngBounds }] = await Promise.all([
      google.maps.importLibrary('maps'),
      google.maps.importLibrary('marker'),
      google.maps.importLibrary('core'),
    ]);
    maps = { Map, InfoWindow, Marker, LatLngBounds };
  } catch {
    showMapMessage('The map could not load. You can still search; results appear in the list.');
    return;
  }

  map = new maps.Map($('map'), { center: userLoc, zoom: 12, clickableIcons: false });
  infoWindow = new maps.InfoWindow();
  map.addListener('click', (e) => {
    userPicked = true;
    setLocation(e.latLng.toJSON(), 'map point you picked');
  });
  userMarker = new maps.Marker({ map, position: userLoc, title: 'Your location', label: 'You' });
  if (markers.length === 0 && companies.length) renderMarkers();
}

function initLocation() {
  const fallback = () => userPicked || setLocation(MANILA, 'Metro Manila (default)');
  if (!navigator.geolocation) return fallback();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (userPicked) return;
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setLocation(loc, 'your current location');
      if (map) map.setCenter(loc);
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
    destination_place_id: c.placeId,
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
  if (typeof c.rating === 'number') box.append(el('p', `Rating: ${c.rating} / 5`));
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
  if (map && markers[i]) {
    infoWindow.setContent(companyDetails(companies[i]));
    infoWindow.open({ map, anchor: markers[i] });
  }
}

function renderMarkers() {
  markers.forEach((m) => m.setMap(null));
  markers = [];
  if (!map) return;
  infoWindow.close();
  if (!companies.length) return;
  const bounds = new maps.LatLngBounds();
  bounds.extend(userLoc);
  companies.forEach((c, i) => {
    const marker = new maps.Marker({ map, position: { lat: c.lat, lng: c.lng }, title: c.name });
    marker.addListener('click', () => showCompany(i));
    markers.push(marker);
    bounds.extend({ lat: c.lat, lng: c.lng });
  });
  map.fitBounds(bounds);
}

function renderResults(data) {
  const profile = data.profile || {};
  $('profile-titles').textContent = (profile.titles || []).join(', ') || '—';
  $('profile-skills').textContent = (profile.skills || []).join(', ') || '—';
  $('profile').hidden = false;

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
  setStatus(companies.length ? `Found ${companies.length} companies.` : 'No matching companies found near this location.');
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
initLocation();
initMap();

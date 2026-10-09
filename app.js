import { validateSettings, importExperience, positiveNumber, reportCsv, queryLayer } from './core.js';

const $ = id => document.getElementById(id);
const storageKey = `mwt-screening:${location.pathname}`;
let config = { ...window.MWT_CONFIG };
try { config = { ...config, ...JSON.parse(localStorage.getItem(storageKey) || '{}') }; } catch {}
let sdkPromise, sdk, view, webmap, sketch, projectLayer, zoneLayer, hitsLayer;
let projectGeometry = null, layers = [], report = null, selectMode = false, busy = false;

function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error-text', error); }
function setupStatus(message, error = false) { $('setup-status').textContent = message; $('setup-status').classList.toggle('error-text', error); }
function download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); }
function updateControls() {
  const available = Boolean(view && layers.length) && !busy;
  for (const id of ['draw-polygon','draw-line','select-feature','clear']) $(id).disabled = !view || busy;
  $('run').disabled = !available || !projectGeometry || !document.querySelector('#layer-list input:checked');
  $('export').disabled = busy || !report; $('print').disabled = busy || !report;
  for (const id of ['half-width','distance','project-name','settings','sign-in','sign-out']) $(id).disabled = busy;
  document.querySelectorAll('#layer-list input').forEach(el => el.disabled = busy || layers[Number(el.value)]?.isTable);
  document.body.classList.toggle('busy', busy);
}
function invalidate() {
  report = null; zoneLayer?.removeAll(); hitsLayer?.removeAll();
  $('results-heading').textContent = 'Ready for a new check';
  $('results-body').replaceChildren(); status('Project or screening settings changed. Run screening to update results.'); updateControls();
}
function showSetup() {
  $('portal-input').value = config.portalUrl || '';
  $('webmap-input').value = config.webmapId || '';
  $('client-input').value = config.clientId || '';
  // Inline OAuth uses the current page as its return address.
  $('redirect-url').textContent = location.origin + location.pathname;
  setupStatus(''); $('setup').showModal();
}
function formConfig() { return validateSettings({ ...config, portalUrl: $('portal-input').value.trim(), webmapId: $('webmap-input').value.trim(), clientId: $('client-input').value.trim() }); }
$('settings').onclick = showSetup; $('connect').onclick = showSetup; $('close-setup').onclick = () => $('setup').close();
$('setup-form').onsubmit = event => {
  event.preventDefault();
  try { const next = formConfig(); localStorage.setItem(storageKey, JSON.stringify(next)); config = next; location.reload(); }
  catch (error) { setupStatus(error.message, true); }
};
$('download-config').onclick = () => {
  try { const next = formConfig(); download('config.js', '// Public settings only. Never add an App Secret or token.\nwindow.MWT_CONFIG = ' + JSON.stringify(next, null, 2) + ';\n', 'text/javascript'); setupStatus('Upload config.js to your GitHub repository to apply these settings for all visitors.'); }
  catch (error) { setupStatus(error.message, true); }
};
$('import-config').onchange = async event => {
  try { const file = event.target.files[0]; if (!file) return; if (file.size > 10_000_000) throw new Error('Choose a config.json smaller than 10 MB.'); const imported = importExperience(JSON.parse(await file.text())); $('portal-input').value = imported.portalUrl; $('webmap-input').value = imported.webmapId; $('client-input').value = imported.clientId; setupStatus(imported.clientId ? 'Map and application settings imported. Save to connect.' : 'Web map imported. Add your registered App ID to connect.'); }
  catch (error) { setupStatus(error.message, true); }
};

function loadSdk() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://js.arcgis.com/4.34/esri/themes/light/main.css'; document.head.append(css);
    const script = document.createElement('script'); script.src = 'https://js.arcgis.com/4.34/';
    const timer = setTimeout(() => reject(new Error('ArcGIS did not load. Check your connection and reload the page.')), 30000);
    script.onerror = () => { clearTimeout(timer); reject(new Error('Could not load ArcGIS. Check your connection and reload the page.')); };
    script.onload = () => window.require([
      'esri/WebMap','esri/views/MapView','esri/layers/GraphicsLayer','esri/Graphic',
      'esri/widgets/Sketch/SketchViewModel','esri/identity/OAuthInfo','esri/identity/IdentityManager',
      'esri/portal/Portal','esri/geometry/operators/geodesicBufferOperator'
    ], (WebMap, MapView, GraphicsLayer, Graphic, SketchViewModel, OAuthInfo, identity, Portal, buffer) => {
      clearTimeout(timer); sdk = { WebMap, MapView, GraphicsLayer, Graphic, SketchViewModel, OAuthInfo, identity, Portal, buffer };
      identity.registerOAuthInfos([new OAuthInfo({ appId: config.clientId, portalUrl: config.portalUrl, popup: false, flowType: 'authorization-code', authNamespace: 'mwt-screening-' + config.clientId })]);
      resolve(sdk);
    }, error => { clearTimeout(timer); reject(error); });
    document.head.append(script);
  });
  return sdkPromise;
}
async function showAccount() {
  try {
    await sdk.identity.checkSignInStatus(config.portalUrl + '/sharing');
    const portal = new sdk.Portal({ url: config.portalUrl, authMode: 'immediate' }); await portal.load();
    $('account').textContent = portal.user?.fullName || portal.user?.username || 'Signed in';
    $('sign-in').hidden = true; $('sign-out').hidden = false;
  } catch { $('account').textContent = 'Not signed in'; $('sign-in').hidden = false; $('sign-out').hidden = true; }
}
$('sign-in').onclick = async () => {
  try { config = validateSettings(config); await loadSdk(); await sdk.identity.getCredential(config.portalUrl + '/sharing'); await showAccount(); if (!view) await connectMap(); }
  catch (error) { if (!config.clientId || !config.webmapId) showSetup(); else status('Sign-in failed: ' + error.message, true); }
};
$('sign-out').onclick = () => { sdk?.identity.destroyCredentials(); projectGeometry = null; report = null; view?.destroy(); $('map').replaceChildren(); location.reload(); };

function symbol(geometry, hit = false) {
  const color = hit ? '#bf6655' : '#1d7779';
  if (geometry.type === 'point' || geometry.type === 'multipoint') return { type: 'simple-marker', size: hit ? 12 : 10, color, outline: { color: 'white', width: 1.5 } };
  if (geometry.type === 'polyline') return { type: 'simple-line', color, width: hit ? 4 : 3 };
  return { type: 'simple-fill', color: hit ? [191,102,85,0.20] : [29,119,121,0.14], outline: { color, width: 2 } };
}
function setProject(geometry) {
  projectGeometry = geometry.clone(); projectLayer.removeAll();
  projectLayer.add(new sdk.Graphic({ geometry: projectGeometry, symbol: symbol(geometry) }));
  $('project-status').textContent = geometry.type === 'polyline' ? 'Route selected. A work-area offset will be applied.' : geometry.type === 'point' ? 'Point selected. Add a screening distance for a surrounding area.' : 'Project area selected.';
  invalidate();
}
function stopSelection() { selectMode = false; $('select-feature').classList.remove('active'); if (view) view.popupEnabled = true; }
async function connectMap() {
  status('Connecting to your ArcGIS Online web map…'); await loadSdk(); await showAccount();
  webmap = new sdk.WebMap({ portalItem: { id: config.webmapId, portal: { url: config.portalUrl } } });
  await webmap.load();
  view = new sdk.MapView({ container: 'map', map: webmap }); await view.when();
  $('map-placeholder').hidden = true; $('map-chip').hidden = false; $('map-title').textContent = webmap.portalItem.title;
  projectLayer = new sdk.GraphicsLayer({ title: 'Project footprint', listMode: 'hide' });
  zoneLayer = new sdk.GraphicsLayer({ title: 'Screening area', listMode: 'hide' });
  hitsLayer = new sdk.GraphicsLayer({ title: 'Screening matches', listMode: 'hide' });
  webmap.addMany([zoneLayer, hitsLayer, projectLayer]);
  sketch = new sdk.SketchViewModel({ view, layer: projectLayer, updateOnGraphicClick: false, polygonSymbol: symbol({type:'polygon'}), polylineSymbol: symbol({type:'polyline'}) });
  sketch.on('create', event => { if (event.state === 'complete') setProject(event.graphic.geometry); });
  const candidates = webmap.allLayers.toArray().filter(layer => layer.type === 'feature');
  const outcomes = await Promise.allSettled(candidates.map(layer => layer.load()));
  layers = candidates; $('layer-list').replaceChildren();
  layers.forEach((layer, index) => {
    const row = document.createElement('label'); row.className = 'layer-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = String(index);
    input.checked = (config.screeningLayerIds || []).includes(layer.id);
    const text = document.createElement('span'); text.className = 'layer-name'; text.textContent = layer.title || layer.id;
    const note = document.createElement('small'); note.className = 'visibility';
    note.textContent = outcomes[index].status === 'rejected' ? 'Load failed; a selected layer will be reported as failed.' : layer.isTable ? 'Nonspatial table; cannot screen.' : layer.visible ? 'Visible on map' : 'Hidden on map; can still be checked';
    if (layer.isTable) { input.disabled = true; input.checked = false; }
    text.append(note); row.append(input, text); $('layer-list').append(row); input.onchange = invalidate;
  });
  if (!layers.length) $('layer-list').textContent = 'No feature layers found. Add hosted feature layers to your web map. Map-image, tile and raster layers are display-only in this app.';
  view.on('click', async event => {
    if (!selectMode || busy) return;
    try { const hit = await view.hitTest(event); const match = hit.results.find(r => r.type === 'graphic' && layers.includes(r.graphic.layer) && r.graphic.geometry); if (!match) { $('project-status').textContent = 'Click a visible feature, such as a broadband route or project polygon.'; return; } setProject(match.graphic.geometry); stopSelection(); }
    catch (error) { status('Could not select that feature: ' + error.message, true); }
  });
  $('project-status').textContent = 'Draw an area or route, or select a feature on the map.';
  status('Map connected. Choose the layers you want to check.'); updateControls(); await showAccount();
}
for (const [id, tool] of [['draw-polygon','polygon'],['draw-line','polyline']]) $(id).onclick = () => {
  stopSelection(); sketch.cancel(); projectGeometry = null; projectLayer.removeAll(); invalidate(); sketch.create(tool);
  $('project-status').textContent = 'Click to add vertices. Double-click to finish; press Escape to cancel.';
};
$('select-feature').onclick = () => { sketch.cancel(); selectMode = !selectMode; $('select-feature').classList.toggle('active', selectMode); view.popupEnabled = !selectMode; $('project-status').textContent = selectMode ? 'Click a visible map feature to use its geometry.' : 'Feature selection stopped.'; };
$('clear').onclick = () => { stopSelection(); sketch.cancel(); projectGeometry = null; projectLayer.removeAll(); invalidate(); $('project-status').textContent = 'Project cleared. Draw or select another project.'; };
for (const id of ['project-name','half-width','distance']) $(id).oninput = invalidate;

$('run').onclick = async () => {
  if (busy || !projectGeometry) return;
  const selected = [...document.querySelectorAll('#layer-list input:checked')].map(input => layers[Number(input.value)]);
  if (!selected.length) return;
  busy = true; stopSelection(); sketch.cancel(); updateControls(); report = null; hitsLayer.removeAll(); zoneLayer.removeAll(); $('results-body').replaceChildren();
  try {
    const distance = positiveNumber($('distance').value), halfWidth = projectGeometry.type === 'polyline' ? positiveNumber($('half-width').value, false) : null;
    let footprint = projectGeometry;
    await sdk.buffer.load();
    if (halfWidth) footprint = sdk.buffer.execute(footprint, halfWidth, { unit: 'feet' });
    if (!footprint) throw new Error('Could not create the project work area. Redraw the project.');
    const zone = distance ? sdk.buffer.execute(footprint, distance, { unit: 'feet' }) : footprint;
    if (!zone) throw new Error('Could not create the screening area.');
    zoneLayer.add(new sdk.Graphic({ geometry: zone, symbol: symbol(zone) }));
    status('Checking selected layers…');
    const results = [];
    for (const layer of selected) {
      status(`Checking ${layer.title || layer.id} (${results.length + 1}/${selected.length})…`);
      try {
        await layer.load();
        if (layer.isTable || !layer.geometryType) throw new Error('This is not a spatial feature layer.');
        const result = await queryLayer(layer, zone, Math.min(10000, Math.max(1, Number(config.maxFeaturesPerLayer) || 1000)));
        results.push({ title: layer.title || layer.id, layerId: layer.id, url: layer.url, ...result, features: result.features.map(feature => ({ graphic: feature, objectId: feature.attributes[layer.objectIdField], label: String(feature.attributes[layer.displayField] || feature.attributes.Name || feature.attributes.NAME || `Feature ${feature.attributes[layer.objectIdField]}`), attributes: feature.attributes })) });
      } catch (error) { results.push({ title: layer.title || layer.id, layerId: layer.id, count: null, features: [], error: error.message || 'Layer query failed.' }); }
    }
    report = { project: $('project-name').value.trim() || 'Untitled project', date: new Date().toISOString(), distance, halfWidth, complete: results.every(result => !result.error), results };
    renderReport();
  } catch (error) { status(error.message, true); }
  finally { busy = false; updateControls(); }
};
function renderReport() {
  const total = report.results.reduce((sum, result) => sum + (result.count || 0), 0), failed = report.results.filter(result => result.error).length;
  $('results-heading').textContent = failed ? 'Screening incomplete' : total ? `${total.toLocaleString()} layer matches found` : 'No matches in the checked layers';
  status(`${report.project} · ${new Date(report.date).toLocaleString()} · Additional distance: ${report.distance} ft${report.halfWidth ? ` · Route offset: ${report.halfWidth} ft per side` : ''} · ${report.results.length} layers checked${failed ? `; ${failed} failed. Results cannot establish that there are no intersections.` : '. Matches may include the same site in multiple layers.'}`, Boolean(failed));
  $('results-body').replaceChildren();
  for (const result of report.results) {
    const section = document.createElement('div'); section.className = 'result-layer';
    const heading = document.createElement('div'); heading.className = 'result-heading';
    const name = document.createElement('span'); name.textContent = result.title;
    const badge = document.createElement('span'); badge.className = 'badge' + (result.error ? ' error' : ''); badge.textContent = result.error ? 'Check failed' : `${result.count} matches`;
    heading.append(name, badge); section.append(heading);
    if (result.error || !result.count || result.truncated) {
      const note = document.createElement('p'); note.className = 'result-note';
      note.textContent = result.error || (result.truncated ? `Showing and exporting ${result.features.length} of ${result.count} matches. Use a smaller project area for all feature details.` : 'No features intersect the screening area.'); section.append(note);
    }
    for (const feature of result.features) {
      const button = document.createElement('button'); button.className = 'result-feature'; button.textContent = feature.label;
      const meta = document.createElement('small'); meta.textContent = `Object ID ${feature.objectId} · Click to locate on map`; button.append(meta);
      button.onclick = () => { if (feature.graphic.geometry) view.goTo({ target: feature.graphic.geometry, ...(feature.graphic.geometry.type === 'point' ? { scale: 3000 } : {}) }).catch(() => {}); };
      section.append(button);
      if (feature.graphic.geometry) hitsLayer.add(new sdk.Graphic({ geometry: feature.graphic.geometry, symbol: symbol(feature.graphic.geometry, true) }));
    }
    $('results-body').append(section);
  }
}
$('export').onclick = () => { if (report) download('mwt-screening-' + report.date.slice(0,10) + '.csv', reportCsv(report), 'text/csv;charset=utf-8'); };
$('print').onclick = () => { if (report) window.print(); };
$('app-title').textContent = config.title || 'Broadband Cultural Resource Screening';
try { config = validateSettings(config); await connectMap(); }
catch (error) { if (config.webmapId && config.clientId) status('Could not connect: ' + error.message + ' Check settings and sign in again.', true); }

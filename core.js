export function webmapId(value) {
  const text = String(value || "").trim();
  if (/^[a-f\d]{32}$/i.test(text)) return text;
  try { const u = new URL(text); for (const key of ["webmap", "id"]) { const id = u.searchParams.get(key); if (/^[a-f\d]{32}$/i.test(id || "")) return id; } } catch {}
  throw new Error("Paste a web map URL or a 32-character web map item ID.");
}
export function validateSettings(settings) {
  const portal = new URL(settings.portalUrl);
  if (portal.protocol !== "https:" || portal.username || portal.password || portal.search || portal.hash) throw new Error("Use an HTTPS ArcGIS organization URL without a query or fragment.");
  const clientId = String(settings.clientId || "").trim();
  if (!/^[\w-]+$/.test(clientId)) throw new Error("Enter your registered OAuth App ID / Client ID.");
  return { ...settings, portalUrl: portal.href.replace(/\/$/, ""), webmapId: webmapId(settings.webmapId), clientId };
}
export function importExperience(config) {
  const maps = [...new Set(Object.values(config.dataSources || {}).filter(s => /web.?map/i.test(s.type || "")).map(s => s.itemId).filter(Boolean))];
  if (maps.length !== 1) throw new Error(maps.length ? "This experience has multiple web maps. Paste the map URL you want to use." : "No web map found. Paste your web map URL manually.");
  return { portalUrl: config.attributes?.portalUrl || "https://mwtribe.maps.arcgis.com", clientId: config.attributes?.clientId || "", webmapId: maps[0] };
}
export function positiveNumber(value, allowZero = true) {
  const n = Number(value);
  if (String(value).trim() === "" || !Number.isFinite(n) || n < (allowZero ? 0 : 0.1) || n > 10000) throw new Error("Enter a distance between " + (allowZero ? "0" : "0.1") + " and 10,000 feet.");
  return n;
}
export function csvCell(value) {
  let text = String(value ?? "");
  // Prevent spreadsheet formula execution, including leading whitespace.
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function reportCsv(report) {
  const rows = [["Project", "Checked at", "Overall status", "Route offset each side ft", "Additional distance ft", "Layer", "Layer status", "Total matches", "Returned features", "Object ID", "Feature label", "Details"]];
  for (const result of report.results) {
    const prefix = [report.project, report.date, report.complete ? "Complete" : "Incomplete", report.halfWidth ?? "Not a route", report.distance, result.title, result.error ? "Failed" : result.truncated ? "Matches; download limited" : "Checked", result.count ?? "Unknown", result.features.length];
    if (!result.features.length) rows.push([...prefix, "", "", result.error || "No intersecting features in this layer"]);
    for (const feature of result.features) rows.push([...prefix, feature.objectId, feature.label, JSON.stringify(feature.attributes)]);
  }
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n");
}
export async function queryLayer(layer, geometry, maxFeatures = 1000) {
  const base = layer.createQuery();
  base.geometry = geometry; base.spatialRelationship = "intersects";
  // createQuery retains the web-map layer's definition expression.
  const allIds = await layer.queryObjectIds(base);
  if (!Array.isArray(allIds)) throw new Error("The service did not return a complete list of feature IDs.");
  const ids = [...new Set(allIds)];
  const limited = ids.slice(0, maxFeatures); const features = [];
  for (let offset = 0; offset < limited.length; offset += 100) {
    const q = layer.createQuery(); q.objectIds = limited.slice(offset, offset + 100); q.outFields = ["*"]; q.returnGeometry = true;
    const response = await layer.queryFeatures(q);
    if (response.exceededTransferLimit || response.features.length !== q.objectIds.length) throw new Error("Feature retrieval was incomplete. Try again or use a smaller project area.");
    features.push(...response.features);
  }
  return { count: ids.length, features, truncated: ids.length > maxFeatures };
}

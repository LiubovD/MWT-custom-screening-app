# MWT Broadband Cultural Resource Screening

A standalone HTML/CSS/JavaScript application for GitHub Pages. Uses ArcGIS Maps SDK for JavaScript 4.34, ArcGIS Online web maps and OAuth user authentication. No Experience Builder, Node server or build step is required for deployment.

## Start with a separate repository

1. Create a new GitHub repository, for example `MWT-screening-custom`, so your current Experience Builder app remains available.
2. Extract this ZIP. Upload the **contents** of this folder to the repository root: `index.html`, `styles.css`, `app.js`, `core.js`, `config.js`, `.nojekyll` and this README. The ZIP has no enclosing folder. Include `.nojekyll` if uploading through GitHub Desktop; the app does not otherwise depend on it.
3. In GitHub **Settings → Pages**, deploy from branch `main`, folder `/(root)`. Open the published HTTPS address.
4. Click **Connect web map**. Paste your web map URL and registered OAuth App ID. You can instead import your existing Experience Builder `cdn/7/config.json` (or the corresponding folder in your export). The importer supports one WEB_MAP data source. If the experience uses multiple web maps, enter the chosen map manually.
5. In ArcGIS Online, open the application item whose App ID you are using. Under **Settings → Credentials**, add this new app's complete address to **Redirect URLs**, including its repository path and trailing slash. The settings screen displays the address. Preserve the old redirect URL if still using your Experience Builder app. This app uses full-page OAuth with PKCE; no popup callback page is needed.
6. Click **Save & connect**, then sign in if required. Your ArcGIS account must have permission to view the web map and layers. Keep restricted cultural resource data restricted in AGOL.
7. To configure the app for **all visitors**, reopen Settings, click **Download config.js**, and replace the repository's `config.js` with that downloaded file. Commit/push, wait for Pages to update, and test in a new private browser window. Browser-saved settings override repository defaults in the same browser.
8. Add the new app's URL to your ArcGIS Online web mapping application item, or create a separate item. AGOL stores the link and GIS content; GitHub Pages serves the app files.

The App ID is a public identifier. **Never put an App Secret, password, access token or restricted GIS feature data into the repository.** Settings saved by this app contain only public configuration identifiers. Authentication is managed by Esri's IdentityManager. The app does not store screening results in browser storage or upload them to a third party. Fonts and the ArcGIS SDK are loaded from external CDNs.

## Screen a project

1. Name the project.
2. Draw an area, draw a route, or click **Select on map** and then a visible feature. Click to add vertices; double-click to finish drawing, or Escape to cancel. A newly selected geometry replaces the previous one.
3. A route is buffered by the **Route work-area offset, each side** (default 4 feet). Polygon and point selections do not use this setting.
4. Explicitly select the feature layers to check. A selected hidden feature layer is still queried. The layer's web-map definition expression is respected; display scale and visibility do not limit queries. Map-image sublayers, tiles, raster layers and related records are not screening targets in this version. Publish/add appropriate feature layers where needed.
5. Keep **Additional screening distance** at **0** when querying existing 50-foot burial protection polygons. Enter **50** when checking raw site points or polygons instead. This expands the project screening footprint by that distance; it does not modify your source layers. Do not add 50 to already buffered protection layers unless you intentionally want an additional setback.
6. Run screening. Intersection includes boundary contact. Inspect matches by clicking their names. Download CSV or print the text report.

The report lists the selected layers, timestamps, route offset, additional distance, matching object IDs and feature attributes. Match counts are per layer, so the same resource can appear more than once. A CSV may contain restricted attributes; share the downloaded report under your organization's usual access rules.

## Completeness and limits

- Results distinguish a failed layer query from zero matches. An incomplete screening is never shown as a completed zero-match check.
- The app first requests matching object IDs and retrieves detail in batches of 100, checking for truncated or missing responses.
- By default, it shows and exports up to **1,000 features per layer**, with the total match count and an explicit notice when detail is limited. Change `maxFeaturesPerLayer` in `config.js` (maximum supported 10,000), or narrow the project area.
- Results are invalidated when the project, layer selection or distance changes. The drawing is kept in memory only; signing out or reloading clears it.
- Footprints and additional distances use geodesic buffers. Drawn geometries use the map's spatial reference; web maps with unusual projected coordinate systems should be tested for operator support before use.
- A no-match report means no intersection was found in the **chosen layers and filters** at that time. It is not an approval or a finding that no cultural resources exist.

## Maintain and test

Use a local web server, not `file://`, when testing. For example, in the extracted folder on Windows: `py -m http.server 8080`, then open `http://localhost:8080/`. Register that exact local address as an additional redirect URL for local OAuth testing; use HTTPS for production. The App ID should be dedicated to this application or authorized for its URLs. Do not change layer sharing to public to resolve a login problem.

There are no package dependencies for hosting. `node --test tests/core.test.mjs` runs the included logic tests if Node.js is installed. Browser/SDK tests require online access. Source files include no mock Tribal datasets. Validate the deployed app with your actual authorized web map, known intersecting and nonintersecting projects, a restricted account, and the intended protection layers before operational use.

References: [ArcGIS Maps SDK](https://developers.arcgis.com/javascript/latest/), [OAuthInfo](https://developers.arcgis.com/javascript/latest/references/core/identity/OAuthInfo/), [Add and register an app](https://doc.arcgis.com/en/arcgis-online/manage-data/add-app-url.htm).

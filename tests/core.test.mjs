import test from 'node:test';
import assert from 'node:assert/strict';
import { webmapId, validateSettings, importExperience, positiveNumber, csvCell, reportCsv, queryLayer } from '../core.js';
const id = '1234567890abcdef1234567890abcdef';
test('accepts web-map URLs and rejects malformed item IDs', () => {
  assert.equal(webmapId('https://mwtribe.maps.arcgis.com/apps/mapviewer/index.html?webmap=' + id), id);
  assert.throws(() => webmapId('not-a-map'));
  assert.throws(() => validateSettings({portalUrl:'http://example.com',clientId:'abc',webmapId:id}));
  assert.throws(() => positiveNumber(''));
  assert.throws(() => positiveNumber(-5));
});
test('imports the experience map and refuses ambiguous maps', () => {
  assert.equal(importExperience({attributes:{clientId:'public-id'},dataSources:{a:{type:'WEB_MAP',itemId:id}}}).webmapId,id);
  assert.throws(() => importExperience({dataSources:{a:{type:'WEB_MAP',itemId:id},b:{type:'WEB_MAP',itemId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}}}));
});
test('batches matching IDs, keeps definition filters, flags limited detail', async () => {
  const requests=[];
  const layer={createQuery:()=>({where:'active = 1'}),queryObjectIds:async()=>Array.from({length:205},(_,i)=>i),queryFeatures:async q=>{requests.push(q);return {features:q.objectIds.map(id=>({attributes:{OBJECTID:id}}))};}};
  const result=await queryLayer(layer,{type:'polygon'},150);
  assert.equal(result.count,205);assert.equal(result.features.length,150);assert.equal(result.truncated,true);
  assert.deepEqual(requests.map(q=>q.objectIds.length),[100,50]);assert.equal(requests[0].where,'active = 1');
});
test('a failed or truncated service cannot masquerade as zero matches', async () => {
  const layer={createQuery:()=>({}),queryObjectIds:async()=>[1,2],queryFeatures:async()=>({features:[{}],exceededTransferLimit:true})};
  await assert.rejects(queryLayer(layer,{}),/incomplete/);
  layer.queryObjectIds=async()=>null;await assert.rejects(queryLayer(layer,{}),/complete list/);
});
test('CSV preserves failed checks and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell(' =SUM(A1)'), '"\' =SUM(A1)"');
  assert.equal(csvCell('a"b'), '"a""b"');
  const csv=reportCsv({project:'Test',date:'2026-10-08',complete:false,distance:0,results:[{title:'Burials',features:[],error:'Access denied',count:null}]});
  assert.match(csv,/Incomplete/);assert.match(csv,/Unknown/);assert.match(csv,/Access denied/);assert.doesNotMatch(csv,/No intersecting/);
});

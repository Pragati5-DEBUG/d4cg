const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const fetch = typeof globalThis.fetch === 'function' ? globalThis.fetch : require('node-fetch');
const { setupGraphQL } = require('./graphql');

const app = express();
const PORT = process.env.PORT || 5002;

function parsePositiveInt(envVal, yamlVal) {
  const raw = envVal != null && envVal !== '' ? envVal : yamlVal;
  if (raw == null || raw === '') return undefined;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function limitLabelsByVolume(countByRowCol, rowLabels, colLabels, maxRows, maxCols) {
  const rows = [...rowLabels];
  const cols = [...colLabels];
  if (!maxRows && !maxCols) {
    return { rowList: rows.sort(), colList: cols.sort() };
  }
  const rowTotals = {};
  for (const r of rows) {
    rowTotals[r] = 0;
    for (const c of cols) rowTotals[r] += countByRowCol[`${r}|${c}`] || 0;
  }
  const colTotals = {};
  for (const c of cols) {
    colTotals[c] = 0;
    for (const r of rows) colTotals[c] += countByRowCol[`${r}|${c}`] || 0;
  }
  let rowList = rows.sort((a, b) => rowTotals[b] - rowTotals[a]);
  if (maxRows && rowList.length > maxRows) rowList = rowList.slice(0, maxRows);
  rowList.sort();
  let colList = cols.sort((a, b) => colTotals[b] - colTotals[a]);
  if (maxCols && colList.length > maxCols) colList = colList.slice(0, maxCols);
  colList.sort();
  return { rowList, colList };
}

function loadConfig() {
  const configPath = path.join(__dirname, 'config.yaml');
  let data = {};
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    data = yaml.load(raw) || {};
  } catch (err) {
    console.warn('Could not load config.yaml:', err.message);
  }
  return {
    graphql: {
      endpoint: process.env.GRAPHQL_ENDPOINT || data.graphql?.endpoint,
      auth_header: process.env.GRAPHQL_AUTH_HEADER || data.graphql?.auth_header,
    },
    heatmap: {
      query_type: process.env.HEATMAP_QUERY_TYPE || data.heatmap?.query_type,
      query_args: data.heatmap?.query_args || null,
      row_field: process.env.HEATMAP_ROW_FIELD || data.heatmap?.row_field,
      col_field: process.env.HEATMAP_COL_FIELD || data.heatmap?.col_field,
      row_label: process.env.HEATMAP_ROW_LABEL || data.heatmap?.row_label,
      col_label: process.env.HEATMAP_COL_LABEL || data.heatmap?.col_label,
      max_rows: parsePositiveInt(process.env.HEATMAP_MAX_ROWS, data.heatmap?.max_rows),
      max_cols: parsePositiveInt(process.env.HEATMAP_MAX_COLS, data.heatmap?.max_cols),
      value_scale: (process.env.HEATMAP_VALUE_SCALE || data.heatmap?.value_scale || 'counts').toLowerCase(),
    },
  };
}

let config = loadConfig();
let configVersion = Date.now();
const configPath = path.join(__dirname, 'config.yaml');
try {
  fs.watch(configPath, (event, filename) => {
    if (filename && event === 'change') {
      try {
        config = loadConfig();
        configVersion = Date.now();
        effectiveHeatmapCache = {};
        console.log('Config reloaded from config.yaml');
      } catch (e) {
        console.warn('Config reload failed:', e.message);
      }
    }
  });
} catch (e) {
  console.warn('Could not watch config.yaml:', e.message);
}

app.use(cors());
app.use(express.json());

function getValueByPath(obj, pathStr) {
  if (!pathStr) return undefined;
  const parts = pathStr.split('.');
  let v = obj;
  for (const p of parts) {
    v = v?.[p];
  }
  return v;
}

const MAX_SELECTION_DEPTH = 3;

function selectionForPath(pathStr) {
  if (!pathStr) return '';
  const parts = pathStr.split('.').slice(0, MAX_SELECTION_DEPTH);
  if (parts.length === 1) return parts[0];
  return parts[0] + ' { ' + parts.slice(1).join(' { ') + ' }'.repeat(parts.length - 1);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'heatmap-api', config: { endpoint: config.graphql.endpoint } });
});

app.get('/api/heatmap/config', async (req, res) => {
  try {
    const effective = await getEffectiveHeatmapConfig();
    res.json({
      query_type: effective.query_type,
      row_field: effective.row_field,
      col_field: effective.col_field,
      row_label: effective.row_label,
      col_label: effective.col_label,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/heatmap/config/version', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ version: configVersion });
});

function deriveLabel(fieldPath) {
  if (!fieldPath || typeof fieldPath !== 'string') return 'Field';
  const last = fieldPath.split('.').pop() || fieldPath;
  return last.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

let effectiveHeatmapCache = {};

async function getEffectiveHeatmapConfig() {
  const h = config.heatmap || {};
  const queryType = h.query_type;
  if (!queryType) throw new Error('Config missing: heatmap.query_type');

  const hasExplicitFields = h.row_field && h.col_field;
  if (hasExplicitFields) {
    return {
      query_type: queryType,
      row_field: h.row_field,
      col_field: h.col_field,
      row_label: h.row_label || deriveLabel(h.row_field),
      col_label: h.col_label || deriveLabel(h.col_field),
    };
  }

  if (effectiveHeatmapCache[queryType]) return effectiveHeatmapCache[queryType];

  const result = await introspectFields();
  if (result.error) throw new Error(result.error);
  const fields = result.fields || [];
  if (fields.length < 2) throw new Error('Schema has fewer than 2 fields for ' + queryType + '. Set row_field and col_field in config.yaml.');
  const row_field = fields[0];
  const col_field = fields[1] === row_field ? (fields[2] || row_field) : fields[1];
  const effective = {
    query_type: queryType,
    row_field,
    col_field,
    row_label: h.row_label || deriveLabel(row_field),
    col_label: h.col_label || deriveLabel(col_field),
  };
  effectiveHeatmapCache[queryType] = effective;
  return effective;
}

function getNamedType(type) {
  if (!type) return null;
  const concreteKinds = ['OBJECT', 'SCALAR', 'INTERFACE', 'ENUM', 'INPUT_OBJECT'];
  if (type.name && type.kind && concreteKinds.includes(type.kind)) return type.name;
  if (type.ofType) return getNamedType(type.ofType);
  return null;
}

async function introspectFields() {
  const endpoint = config.graphql.endpoint;
  const queryType = config.heatmap.query_type;
  if (!endpoint || !queryType) return { error: 'No endpoint or query_type configured' };

  const introspect = `
    query {
      __schema {
        queryType {
          fields {
            name
            type { name kind ofType { name kind ofType { name } } }
          }
        }
      }
    }
  `;
  const headers = { 'Content-Type': 'application/json' };
  if (config.graphql.auth_header) headers['Authorization'] = config.graphql.auth_header;

  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: introspect }) });
  const json = await res.json().catch(() => ({}));
  if (json.errors) return { error: json.errors[0]?.message || 'Introspection failed' };
  const queryFields = json.data?.__schema?.queryType?.fields || [];
  const field = queryFields.find((f) => f.name === queryType);
  if (!field) return { error: 'Query type "' + queryType + '" not found', available_queries: queryFields.map((f) => f.name) };

  const knownQueryToType = { countries: 'Country', continents: 'Continent', languages: 'Language', users: 'User', products: 'Product' };
  let itemType = knownQueryToType[queryType] || knownQueryToType[queryType.toLowerCase()];
  if (!itemType) itemType = getNamedType(field.type);
  if (!itemType && queryType.length > 0) {
    const singular = queryType.replace(/s$/i, '');
    itemType = singular.charAt(0).toUpperCase() + singular.slice(1).toLowerCase();
  }
  if (!itemType) {
    return {
      error: 'Could not get item type for ' + queryType,
      hint: 'Set heatmap.query_type to a root query that returns a list (e.g. countries). Use GET /api/heatmap/queries for options.',
      available_queries: queryFields.map((f) => f.name),
    };
  }

  const typeQuery = `
    query($name: String!) {
      __type(name: $name) {
        name
        fields {
          name
          type { name kind ofType { name } }
        }
      }
    }
  `;
  const typeRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: typeQuery, variables: { name: itemType } }) });
  const typeJson = await typeRes.json().catch(() => ({}));
  if (typeJson.errors) {
    return { error: 'Type introspection failed: ' + (typeJson.errors[0]?.message || 'unknown'), item_type_tried: itemType, available_queries: queryFields.map((f) => f.name) };
  }
  const type = typeJson.data?.__type;
  if (!type) {
    return { error: 'Schema has no type named "' + itemType + '". Some APIs disable __type introspection.', item_type_tried: itemType, available_queries: queryFields.map((f) => f.name) };
  }
  const typeFields = type.fields || [];

  const fields = [];
  for (const f of typeFields) {
    const sub = f.type?.ofType?.name || f.type?.name;
    const isObject = f.type?.kind === 'OBJECT' || (f.type?.ofType && f.type.ofType.kind === 'OBJECT');
    if (isObject && sub) {
      const subRes = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: `query($n: String!) { __type(name: $n) { fields { name } } }`, variables: { n: sub } }) });
      const subJson = await subRes.json().catch(() => ({}));
      const subFields = subJson.data?.__type?.fields || [];
      subFields.forEach((sf) => fields.push(f.name + '.' + sf.name));
    } else {
      fields.push(f.name);
    }
  }

  return {
    query_type: queryType,
    item_type: itemType,
    fields: fields.sort(),
    available_queries: queryFields.map((f) => f.name),
  };
}

async function introspectQueries() {
  const endpoint = config.graphql?.endpoint;
  if (!endpoint) return { error: 'No graphql.endpoint configured' };
  const introspect = `
    query { __schema { queryType { fields { name } } } }
  `;
  const headers = { 'Content-Type': 'application/json' };
  if (config.graphql.auth_header) headers['Authorization'] = config.graphql.auth_header;
  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query: introspect }) });
  const json = await res.json().catch(() => ({}));
  if (json.errors) return { error: json.errors[0]?.message || 'Introspection failed' };
  const queryFields = json.data?.__schema?.queryType?.fields || [];
  return { queries: queryFields.map((f) => f.name).sort() };
}

app.get('/api/heatmap/queries', async (req, res) => {
  res.set('Content-Type', 'application/json');
  try {
    const result = await introspectQueries();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const serveFields = async (req, res) => {
  res.set('Content-Type', 'application/json');
  try {
    const result = await introspectFields();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
app.get('/api/heatmap/fields', serveFields);
app.get('/api/heatmap/fields/', serveFields);

async function fetchData() {
  if (!config.graphql?.endpoint) throw new Error('Config missing: graphql.endpoint (set in config.yaml or GRAPHQL_ENDPOINT)');
  const heatmap = await getEffectiveHeatmapConfig();

  const rowSel = selectionForPath(heatmap.row_field);
  const colSel = selectionForPath(heatmap.col_field);
  if (!rowSel || !colSel) {
    throw new Error('Could not build selection for row_field or col_field. Use GET /api/heatmap/fields for valid names.');
  }
  const args = config.heatmap?.query_args && Object.keys(config.heatmap.query_args).length > 0
    ? '(' + Object.entries(config.heatmap.query_args).map(([k, v]) => {
        if (typeof v === 'string') return k + ': "' + v.replace(/"/g, '\\"') + '"';
        if (typeof v === 'number' || typeof v === 'boolean') return k + ': ' + v;
        return k + ': ' + JSON.stringify(v);
      }).join(', ') + ')'
    : '';
  const query = `
    query {
      ${heatmap.query_type}${args} {
        ${rowSel}
        ${colSel}
      }
    }
  `;
  const headers = { 'Content-Type': 'application/json' };
  if (config.graphql.auth_header) headers['Authorization'] = config.graphql.auth_header;

  const res = await fetch(config.graphql.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('GraphQL API returned non-JSON. ' + (text ? text.slice(0, 200) : res.statusText || 'Check endpoint and network.'));
  }
  if (json.errors) throw new Error('GraphQL error: ' + (json.errors[0]?.message || 'see response'));
  const key = heatmap.query_type;
  let payload = json.data?.[key];
  if (payload == null) throw new Error('GraphQL response had no data.' + (key ? ' Expected data.' + key : '') + ' Check query_type and schema.');
  const items = Array.isArray(payload) ? payload : [payload];
  return { items, heatmap };
}

app.get('/api/heatmap/data', async (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  try {
    const { items, heatmap } = await fetchData();
    const rowField = heatmap.row_field;
    const colField = heatmap.col_field;
    const countByRowCol = {};
    const rowLabels = new Set();
    const colLabels = new Set();

    for (const item of items) {
      const row = String(getValueByPath(item, rowField) ?? 'Unknown').trim();
      const col = String(getValueByPath(item, colField) ?? 'Unknown').trim();
      rowLabels.add(row);
      colLabels.add(col);
      const key = `${row}|${col}`;
      countByRowCol[key] = (countByRowCol[key] || 0) + 1;
    }

    const maxRows = config.heatmap?.max_rows;
    const maxCols = config.heatmap?.max_cols;
    const { rowList, colList } = limitLabelsByVolume(
      countByRowCol,
      rowLabels,
      colLabels,
      maxRows,
      maxCols
    );

    const cells = [];
    for (const row of rowList) {
      for (const col of colList) {
        const value = countByRowCol[`${row}|${col}`] || 0;
        cells.push({ row, col, value });
      }
    }

    const valueScale = config.heatmap?.value_scale === 'zscore' ? 'zscore' : 'counts';
    let cellsOut = cells.map((c) => ({ row: c.row, col: c.col, value: c.value }));

    if (valueScale === 'zscore') {
      const vals = cellsOut.map((c) => c.value);
      const n = vals.length || 1;
      const mean = vals.reduce((a, b) => a + b, 0) / n;
      const variance = vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
      const std = Math.sqrt(variance);
      const safeStd = std < 1e-12 ? 1 : std;
      cellsOut = cellsOut.map((c) => ({
        ...c,
        z: (c.value - mean) / safeStd,
      }));
      const maxAbsZ = Math.max(...cellsOut.map((c) => Math.abs(c.z)), 1e-9);
      cellsOut = cellsOut.map((c) => ({
        ...c,
        intensity: Math.min(1, Math.abs(c.z) / maxAbsZ),
      }));
    } else {
      const maxValue = Math.max(...cellsOut.map((c) => c.value), 1);
      cellsOut = cellsOut.map((c) => ({
        ...c,
        intensity: c.value / maxValue,
      }));
    }

    return res.json({
      rowLabels: rowList,
      colLabels: colList,
      cells: cellsOut,
      value_scale: valueScale,
      row_label: heatmap.row_label,
      col_label: heatmap.col_label,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.use('/docs', express.static(path.join(__dirname, 'docs')));
app.use(express.static(path.join(__dirname, 'public')));

setupGraphQL(app).then(() => {
  app.listen(PORT, () => {
    console.log('Heatmap API running at http://localhost:' + PORT);
    console.log('  Config: ' + path.join(__dirname, 'config.yaml'));
    console.log('  GET http://localhost:' + PORT + '/api/health');
    console.log('  GET http://localhost:' + PORT + '/api/heatmap/data');
    console.log('  GET http://localhost:' + PORT + '/api/heatmap/queries  (root query names from endpoint)');
    console.log('  GET http://localhost:' + PORT + '/api/heatmap/fields   (fields for current query_type)');
    console.log('  POST http://localhost:' + PORT + '/graphql          (mock AdverseEvent GraphQL)');
    console.log('  Open http://localhost:' + PORT + ' for the heatmap page.');
  });
  app.use((req, res) => {
    res.status(404).json({
      error: 'Not found',
      path: req.path,
      available: [
        'GET /',
        'GET /index.html',
        'GET /clustergrammer.html',
        'GET /api/health',
        'GET /api/heatmap/config',
        'GET /api/heatmap/config/version',
        'GET /api/heatmap/queries',
        'GET /api/heatmap/fields',
        'GET /api/heatmap/data',
        'POST /graphql',
      ],
    });
  });
}).catch((err) => {
  console.error('Failed to start GraphQL server:', err);
});

# Testing the configuration-driven heatmap

This document describes how to **verify** that the heatmap application is configuration-driven. You can follow these steps and use the summary at the end in your proposal.

---

## Test without editing any file (environment variables)

If you cannot edit `config.yaml`, you can test using **environment variables**. The server reads these **before** the YAML file, so they override config.

**Test 1 – Change labels (PowerShell):**

```powershell
cd spacex-heatmap
$env:HEATMAP_ROW_LABEL="Continent (from env)"; $env:HEATMAP_COL_LABEL="Region (from env)"; npm start
```

Open the heatmap in the browser. You should see **"Continent (from env)"** and **"Region (from env)"** as the axis labels.

**Test 2 – Swap row and column (PowerShell):**

```powershell
$env:HEATMAP_ROW_FIELD="awsRegion"; $env:HEATMAP_COL_FIELD="continent.name"; npm start
```

Restart the server with the above, then reload the page. Rows should be AWS regions and columns should be continents (axes swapped).

**Env vars that override config:**

| Env var | Overrides |
|---------|-----------|
| `GRAPHQL_ENDPOINT` | `graphql.endpoint` |
| `GRAPHQL_AUTH_HEADER` | `graphql.auth_header` |
| `HEATMAP_QUERY_TYPE` | `heatmap.query_type` |
| `HEATMAP_ROW_FIELD` | `heatmap.row_field` |
| `HEATMAP_COL_FIELD` | `heatmap.col_field` |
| `HEATMAP_ROW_LABEL` | `heatmap.row_label` |
| `HEATMAP_COL_LABEL` | `heatmap.col_label` |

---

## What “configuration-driven” means here

- **No hardcoded** GraphQL URL, query shape, or row/column fields in the server code.
- All of that is read from **`config.yaml`** (and optional env vars).
- Changing the config (or env) changes the heatmap **without changing any code**.

---

## Test 1: Change UI labels

1. Open **`config.yaml`**.
2. Change the labels:
   - Set `row_label: "Continent (config)"`
   - Set `col_label: "Region (config)"`
3. Restart the server: `npm start`
4. Open the heatmap in the browser (e.g. http://localhost:5002).
5. **Expected:** The table header and/or Clustergrammer view show **"Continent (config)"** and **"Region (config)"** instead of the previous labels. The API response also includes these in `row_label` / `col_label`.

---

## Test 2: Swap row and column dimensions

1. Open **`config.yaml`**.
2. Swap the row/column **fields** (not just labels):
   - Set `row_field: "awsRegion"`
   - Set `col_field: "continent.name"`
3. Restart the server: `npm start`
4. Reload the heatmap page.
5. **Expected:** The **axes swap**: rows are now AWS regions, columns are continents. Same data, different layout—driven only by config.

---

## Test 3: Override endpoint with environment variable

1. In the project folder, set the env var and start the server:
   - **PowerShell:** `$env:GRAPHQL_ENDPOINT="https://countries.trevorblades.com/graphql"; npm start`
   - **Cmd:** `set GRAPHQL_ENDPOINT=https://countries.trevorblades.com/graphql && npm start`
2. Open **http://localhost:5002/api/health**
3. **Expected:** The JSON response includes `"config": { "endpoint": "https://countries.trevorblades.com/graphql" }`, showing the server is using the configured endpoint (from env in this case).

---

## Files that define behavior (no code change needed)

| What you want to change | Where to change it |
|-------------------------|--------------------|
| GraphQL URL             | `config.yaml` → `graphql.endpoint` or env `GRAPHQL_ENDPOINT` |
| Auth header             | `config.yaml` → `graphql.auth_header` or env `GRAPHQL_AUTH_HEADER` |
| Which type to query     | `config.yaml` → `heatmap.query_type` |
| What becomes rows       | `config.yaml` → `heatmap.row_field` (dot path, e.g. `continent.name`) |
| What becomes columns    | `config.yaml` → `heatmap.col_field` |
| Axis labels in UI       | `config.yaml` → `heatmap.row_label`, `heatmap.col_label` |

---

## Summary for your proposal

You can use something like this in your proposal:

> **Configuration-driven heatmap:** The heatmap application is fully configuration-driven. The GraphQL endpoint, authentication, queried type, and the fields used for heatmap rows and columns are read from a single **`config.yaml`** file (with optional overrides via environment variables). No server code changes are required to point at a different endpoint or to change heatmap dimensions—only the configuration file is updated. This was verified by (1) changing axis labels and confirming the UI updates, (2) swapping row and column fields and confirming the axes swap, and (3) overriding the endpoint via `GRAPHQL_ENDPOINT` and confirming the health endpoint reflects the configured URL. A short test guide is provided in the repository (`CONFIG_TEST.md`).

---

## Optional: Restore default config

After testing, you can restore the default setup in **`config.yaml`**:

```yaml
heatmap:
  query_type: "countries"
  row_field: "continent.name"
  col_field: "awsRegion"
  row_label: "Continent"
  col_label: "AWS Region"
```

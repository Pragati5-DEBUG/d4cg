# Data Density Heatmap (configuration-driven)

A **web-based heatmap** that shows **data density** (completeness and distribution) across a dataset. It is **configuration-driven** and works with **live GraphQL endpoints**, so researchers and data managers can assess **data availability** and **dataset quality** without changing code.

- Backend reads endpoint, query type, and row/column dimensions from **`config.yaml`** (and optional env). Supports query arguments (e.g. Open Targets `efoId`).
- Frontend: table heatmap + **Clustergrammer** (D3-based) for interactive visualization.

## What it does

- **Backend (Express):** Loads config from `config.yaml`, calls the configured GraphQL API, and returns heatmap data (rows × columns = counts). Supports optional auth and env overrides.
- **Frontend:** Table heatmap and an optional [Clustergrammer](https://github.com/MaayanLab/clustergrammer) view.

## Configuration-driven design

All of the following are **configured**, not hardcoded:

| Configured in `config.yaml` | Purpose |
|-----------------------------|--------|
| `graphql.endpoint` | GraphQL API URL |
| `graphql.auth_header` | Optional auth header |
| `heatmap.query_type` | Which type to query (e.g. `countries`) |
| `heatmap.row_field` | Dot path for row dimension (e.g. `continent.name`) |
| `heatmap.col_field` | Dot path for column dimension (e.g. `awsRegion`) |
| `heatmap.row_label` / `col_label` | Axis labels in the UI |

**Testing that it is config-driven:** see **[CONFIG_TEST.md](CONFIG_TEST.md)** for step-by-step checks and a short paragraph you can use in a proposal.

## Run it

```bash
cd spacex-heatmap
npm install
npm start
```

Then open **http://localhost:5002** (or the port shown in the terminal).

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check; includes configured endpoint |
| `GET /api/heatmap/config` | Row/column labels from config |
| `GET /api/heatmap/data` | Heatmap data (rowLabels, colLabels, cells) |
| `GET /` | Table heatmap page |
| `GET /clustergrammer.html` | Clustergrammer (D3) view |

## Stack

- Node.js, Express, js-yaml (config), fetch (GraphQL)
- Static HTML + JS; Clustergrammer (D3) for interactive heatmap

---

## Requirements (GSOC: Data Density Heatmap Application)

| Requirement | Status |
|-------------|--------|
| Web-based heatmap visualization tool | ✅ Table + Clustergrammer (D3) views |
| Represents **completeness and distribution** of data | ✅ Distribution (counts per row×col); density = count (availability) |
| Data **density** by GraphQL **node types** and **attributes** | ✅ `query_type` = node type; `row_field` / `col_field` = attributes |
| Identify **high or low data availability** | ✅ Cell color/value shows dense vs sparse areas |
| Support **dataset quality** and **curation** efforts | ✅ Tool supports assessing gaps and guiding curation |
| **Fully functional, configuration-driven** heatmap | ✅ Config-driven; no code change to switch API or layout |
| **Dynamically** from **live GraphQL endpoints** | ✅ Any endpoint; introspection for queries/fields; optional `query_args` |
| **Skills: JavaScript, D3 (or similar)** | ✅ JavaScript; Clustergrammer (D3-based) |

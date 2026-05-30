# 👟 Sale Stomp — Interactive Jumble Sale Route Planner

A fully static, single-page web app for planning walking or driving routes between jumble sale locations. No backend, no API keys, no build tools — just open `index.html` and go.

## Features

- **Load any CSV** — drag-and-drop, file picker, or load from a URL
- **Interactive map** — Leaflet.js + OpenStreetMap, fully offline-capable tiles
- **Filter by category** — auto-extracted from your CSV, toggle in real time
- **Route builder** — set a start, add stops (from pins or free-text), drag to reorder, set an end
- **Geocoding** — addresses without lat/lng are geocoded automatically via Nominatim (free, no key)
- **Responsive** — full sidebar on desktop, bottom sheet drawer on mobile

---

## CSV Format

Your CSV must have a header row. Column names are flexible — Sale Stomp recognises common variations.

### Required (at least one of):
| Column | Aliases accepted |
|--------|-----------------|
| `name` | `title`, `seller`, `location_name` |
| `address` | `location`, `street`, `addr` |

### Optional but recommended:
| Column | Aliases accepted | Notes |
|--------|-----------------|-------|
| `lat` | `latitude` | Decimal degrees. If omitted, address is geocoded. |
| `lng` | `lon`, `longitude` | Decimal degrees. |
| `categories` | `category`, `items`, `tags`, `type` | Pipe- or comma-separated list |

### Example

```csv
name,address,lat,lng,categories
The Johnson's,12 Maple Street,51.5074,-0.1278,Clothes | Books | Toys
Green Family Sale,45 Oak Avenue,51.5090,-0.1260,Furniture | Garden | Electronics
Riverside Stall,8 River Lane,51.5060,-0.1295,Vintage | Clothes | Records
```

A `sample.csv` is included in this repo to test with.

> **Tip:** If you provide `lat`/`lng` columns, the app loads instantly. Without them, each row is geocoded one at a time (≈1 second per row) to respect Nominatim's rate limit.

---

## Running Locally

No build step needed. Open directly in a browser:

```bash
# Option 1 — just open the file
open index.html

# Option 2 — serve locally (avoids CORS issues when loading CSVs from URLs)
npx serve .
# or
python3 -m http.server 8080
```

---

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository (e.g. `your-username/sale-stomp`)
2. Go to **Settings → Pages**
3. Set **Source** to `Deploy from a branch`, branch `main`, folder `/` (root)
4. Click **Save** — your app will be live at `https://your-username.github.io/sale-stomp/`

That's it. No build pipeline required.

---

## Reusing for Other Events

Sale Stomp is intentionally generic. To use it for any event with locations:

1. Prepare a CSV with your locations (see format above)
2. Host the CSV anywhere publicly accessible (GitHub raw URL, Google Sheets CSV export, etc.)
3. Open the app → paste the URL → click **Load**

The app title and colour scheme can be customised in `style.css` (`:root` variables) and `index.html`.

---

## Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| [Leaflet.js](https://leafletjs.com) | 1.9.4 | Interactive map |
| [PapaParse](https://www.papaparse.com) | 5.4.1 | CSV parsing |
| [Sortable.js](https://sortablejs.github.io/Sortable/) | 1.15.2 | Drag-and-drop route reordering |
| [Nominatim](https://nominatim.org) | — | Free geocoding (no key required) |
| [OpenStreetMap](https://www.openstreetmap.org) | — | Map tiles |

All libraries loaded via CDN. No npm, no bundler, no build step.

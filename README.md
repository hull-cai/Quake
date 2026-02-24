# Quake (Vite + React + Leaflet)

Interactive earthquake explorer using the USGS Earthquake Catalog API.

## Features

- Draw a rectangle (bounding box) before data can be loaded.
- Set search filters: start datetime, end datetime, minimum magnitude.
- Fetch events from USGS FDSN endpoint with bbox + filters and `orderby=time-asc`.
- Render quakes as circle markers sized by magnitude.
- Timeline scrubber filters to events with `event.time <= scrub time`.
- Play/Pause animates the scrubber through the selected time window.
- Right-side list shows only currently visible (scrubbed) events.
- Rectangle edits invalidate old results and require a fresh search.
- Event storage uses a `Map` keyed by event ID for efficient updates/lookups.

## Run locally

```bash
npm install
npm run dev
```

Then open the local URL shown by Vite (typically http://localhost:5173).

## Build

```bash
npm run build
npm run preview
```

## Usage

1. Draw a rectangle on the map (required).
2. Choose start/end datetime and minimum magnitude.
3. Click **Search**.
4. Scrub the timeline, or click **Play** to animate events forward in time.
5. Edit the rectangle any time to change bbox; this clears old results and requires a new search.

## Notes

- If npm access is restricted in your environment, `npm install` may fail until registry access is allowed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import { CircleMarker, FeatureGroup, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'

const now = new Date()
const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

const formatInputDate = (date) => {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

const toIso = (value) => new Date(value).toISOString()

const DrawRectangleControl = ({ featureGroupRef, onBoundsChange }) => {
  const map = useMap()

  useEffect(() => {
    if (!featureGroupRef.current) {
      return undefined
    }

    const drawControl = new L.Control.Draw({
      draw: {
        polyline: false,
        polygon: false,
        circle: false,
        marker: false,
        circlemarker: false,
        rectangle: {
          shapeOptions: {
            color: '#2563eb',
            weight: 2,
          },
        },
      },
      edit: {
        featureGroup: featureGroupRef.current,
        edit: true,
        remove: false,
      },
    })

    const handleCreated = (event) => {
      if (event.layerType !== 'rectangle') {
        return
      }
      featureGroupRef.current.clearLayers()
      featureGroupRef.current.addLayer(event.layer)
      onBoundsChange(event.layer.getBounds())
    }

    const handleEdited = (event) => {
      event.layers.eachLayer((layer) => {
        onBoundsChange(layer.getBounds())
      })
    }

    map.addControl(drawControl)
    map.on(L.Draw.Event.CREATED, handleCreated)
    map.on(L.Draw.Event.EDITED, handleEdited)

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated)
      map.off(L.Draw.Event.EDITED, handleEdited)
      map.removeControl(drawControl)
    }
  }, [map, featureGroupRef, onBoundsChange])

  return null
}

const boundsToParams = (bounds) => ({
  minlatitude: bounds.getSouth(),
  maxlatitude: bounds.getNorth(),
  minlongitude: bounds.getWest(),
  maxlongitude: bounds.getEast(),
})

const eventMarkerRadius = (magnitude) => Math.max(4, Number(magnitude || 0) * 2.5)

export default function App() {
  const [bbox, setBbox] = useState(null)
  const [startTime, setStartTime] = useState(formatInputDate(twentyFourHoursAgo))
  const [endTime, setEndTime] = useState(formatInputDate(now))
  const [minMagnitude, setMinMagnitude] = useState('2.5')
  const [eventsById, setEventsById] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hasFreshSearch, setHasFreshSearch] = useState(false)
  const [scrubTime, setScrubTime] = useState(now.getTime())
  const [isPlaying, setIsPlaying] = useState(false)

  const featureGroupRef = useRef(null)

  const startMs = useMemo(() => new Date(startTime).getTime(), [startTime])
  const endMs = useMemo(() => new Date(endTime).getTime(), [endTime])
  const hasValidTimeRange = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs

  const handleBoundsChange = useCallback(
    (bounds) => {
      setBbox(bounds)
      setHasFreshSearch(false)
      setEventsById(new Map())
      setError('')
      setIsPlaying(false)
      if (hasValidTimeRange) {
        setScrubTime(startMs)
      }
    },
    [hasValidTimeRange, startMs],
  )

  useEffect(() => {
    if (!hasFreshSearch) {
      if (hasValidTimeRange) {
        setScrubTime(startMs)
      }
      return
    }

    setScrubTime((prev) => Math.min(Math.max(prev, startMs), endMs))
  }, [startMs, endMs, hasFreshSearch, hasValidTimeRange])

  useEffect(() => {
    if (!isPlaying || !hasValidTimeRange) {
      return undefined
    }

    const stepMs = Math.max(60_000, Math.floor((endMs - startMs) / 200))
    const interval = setInterval(() => {
      setScrubTime((prev) => {
        const current = prev >= endMs ? startMs : prev
        const next = current + stepMs
        if (next >= endMs) {
          setIsPlaying(false)
          return endMs
        }
        return next
      })
    }, 120)

    return () => clearInterval(interval)
  }, [isPlaying, startMs, endMs, hasValidTimeRange])

  const visibleEvents = useMemo(() => {
    const entries = []
    for (const event of eventsById.values()) {
      if (event.time <= scrubTime) {
        entries.push(event)
      }
    }
    return entries
  }, [eventsById, scrubTime])

  const handleSearch = async () => {
    if (!bbox || !hasValidTimeRange) {
      return
    }

    setLoading(true)
    setError('')
    setIsPlaying(false)

    try {
      const bboxParams = boundsToParams(bbox)
      const query = new URLSearchParams({
        format: 'geojson',
        ...Object.fromEntries(Object.entries(bboxParams).map(([key, value]) => [key, String(value)])),
        starttime: toIso(startTime),
        endtime: toIso(endTime),
        minmagnitude: minMagnitude || '0',
        orderby: 'time-asc',
      })

      const response = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?${query.toString()}`)
      if (!response.ok) {
        throw new Error(`USGS request failed (${response.status})`)
      }

      const payload = await response.json()
      const nextMap = new Map()

      for (const feature of payload.features ?? []) {
        const [longitude, latitude] = feature.geometry?.coordinates ?? []
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          continue
        }

        const magnitude = Number(feature.properties?.mag ?? 0)
        nextMap.set(feature.id, {
          id: feature.id,
          title: feature.properties?.title ?? 'Untitled earthquake',
          place: feature.properties?.place ?? 'Unknown location',
          magnitude,
          time: feature.properties?.time ?? 0,
          latitude,
          longitude,
          detailUrl: feature.properties?.url,
        })
      }

      setEventsById(nextMap)
      setHasFreshSearch(true)
      setScrubTime(startMs)
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Unknown error')
      setHasFreshSearch(false)
      setEventsById(new Map())
    } finally {
      setLoading(false)
    }
  }

  const togglePlay = () => {
    if (!hasFreshSearch || !hasValidTimeRange) {
      return
    }

    setScrubTime((prev) => (prev >= endMs ? startMs : prev))
    setIsPlaying((value) => !value)
  }

  return (
    <div className="app-shell">
      <div className="map-pane">
        <MapContainer center={[20, 0]} zoom={2} minZoom={2} className="map-container">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FeatureGroup ref={featureGroupRef} />
          <DrawRectangleControl featureGroupRef={featureGroupRef} onBoundsChange={handleBoundsChange} />

          {hasFreshSearch &&
            visibleEvents.map((event) => (
              <CircleMarker
                key={event.id}
                center={[event.latitude, event.longitude]}
                radius={eventMarkerRadius(event.magnitude)}
                pathOptions={{ color: '#b91c1c', fillColor: '#ef4444', fillOpacity: 0.45, weight: 1 }}
              >
                <Popup>
                  <strong>{event.title}</strong>
                  <br />
                  Magnitude: {event.magnitude}
                  <br />
                  {new Date(event.time).toLocaleString()}
                </Popup>
              </CircleMarker>
            ))}
        </MapContainer>

        <div className="overlay-panel">
          {!bbox && <p className="hint">Draw a rectangle to choose a search area.</p>}

          {bbox && (
            <>
              <div className="controls-grid">
                <label>
                  Start datetime
                  <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </label>
                <label>
                  End datetime
                  <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </label>
                <label>
                  Min magnitude
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={minMagnitude}
                    onChange={(e) => setMinMagnitude(e.target.value)}
                  />
                </label>
                <button type="button" onClick={handleSearch} disabled={loading || !hasValidTimeRange}>
                  {loading ? 'Searching…' : 'Search'}
                </button>
              </div>

              {!hasValidTimeRange && <p className="error">End datetime must be after start datetime.</p>}
              {!hasFreshSearch && <p className="hint">Rectangle changed. Click Search to load data for the updated bbox.</p>}

              <div className="timeline-row">
                <button type="button" onClick={togglePlay} disabled={!hasFreshSearch || !hasValidTimeRange}>
                  {isPlaying ? 'Pause' : 'Play'}
                </button>
                <input
                  type="range"
                  min={hasValidTimeRange ? startMs : 0}
                  max={hasValidTimeRange ? endMs : 1}
                  value={Math.min(Math.max(scrubTime, hasValidTimeRange ? startMs : 0), hasValidTimeRange ? endMs : 1)}
                  onChange={(e) => setScrubTime(Number(e.target.value))}
                  disabled={!hasFreshSearch || !hasValidTimeRange}
                />
                <span>{new Date(scrubTime).toLocaleString()}</span>
              </div>
            </>
          )}

          {error && <p className="error">{error}</p>}
        </div>
      </div>

      <aside className="event-list-pane">
        <h2>Visible Events ({hasFreshSearch ? visibleEvents.length : 0})</h2>
        <ul>
          {hasFreshSearch &&
            visibleEvents.map((event) => (
              <li key={event.id}>
                <p className="event-title">{event.title}</p>
                <p>
                  Mag {event.magnitude} · {new Date(event.time).toLocaleString()}
                </p>
                <p>{event.place}</p>
                {event.detailUrl && (
                  <a href={event.detailUrl} target="_blank" rel="noreferrer">
                    USGS details
                  </a>
                )}
              </li>
            ))}
        </ul>
      </aside>
    </div>
  )
}

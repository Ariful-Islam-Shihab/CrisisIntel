import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
// Map picker (Leaflet)
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix default marker icons in bundlers
const DefaultIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

export default function CrisisNew() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [incidentType, setIncidentType] = useState('general');
  const [severity, setSeverity] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radiusKm, setRadiusKm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const navigate = useNavigate();

  const center = useMemo(() => {
    // Default center (Dhaka) if none; adjust as needed
    const la = parseFloat(lat); const ln = parseFloat(lng);
    if (!isNaN(la) && !isNaN(ln)) return [la, ln];
    return [23.8103, 90.4125];
  }, [lat, lng]);

  function ClickToSetMarker() {
    useMapEvents({
      click(e) {
        setLat(e.latlng.lat.toFixed(6));
        setLng(e.latlng.lng.toFixed(6));
      },
    });
    return null;
  }

  // Recenter map when lat/lng change
  function RecenterOnChange({ latV, lngV }) {
    const map = useMapEvents({});
    useEffect(() => {
      const la = parseFloat(latV); const ln = parseFloat(lngV);
      if (!isNaN(la) && !isNaN(ln)) {
        map.setView([la, ln], map.getZoom());
      }
    }, [latV, lngV, map]);
    return null;
  }

  // Geocoding search (Nominatim)
  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 3) {
      setSearchResults([]);
      setSearchError(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(searchQuery.trim())}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!alive) return;
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch (e) {
        if (alive) setSearchError(e.message || 'Search failed');
      } finally {
        if (alive) setSearching(false);
      }
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [searchQuery]);

  async function useMyLocation() {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by your browser.');
      return;
    }
    setGeoBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false);
        const la = pos.coords.latitude.toFixed(6);
        const ln = pos.coords.longitude.toFixed(6);
        setLat(la);
        setLng(ln);
      },
      (err) => {
        setGeoBusy(false);
        setError(err && err.message ? `Geolocation failed: ${err.message}` : 'Failed to get current location');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body = { title, description, incident_type: incidentType };
      if (severity) body.severity = severity;
      if (lat && lng) { body.lat = parseFloat(lat); body.lng = parseFloat(lng); }
      if (radiusKm) body.radius_km = parseFloat(radiusKm);
      const res = await api.createCrisis(body);
      navigate(`/crises/${res.crisis_id}`);
    } catch (e) {
      setError(e.message || 'Failed to create crisis');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white p-6 rounded shadow">
      <h2 className="text-xl font-semibold mb-4">Create Crisis (Admin)</h2>
      {error && <div className="text-red-600 mb-3">{error}</div>}
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Title</label>
          <input value={title} onChange={(e)=>setTitle(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" required />
        </div>
        <div>
          <label className="block text-sm font-medium">Description</label>
          <textarea value={description} onChange={(e)=>setDescription(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" rows={3} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium">Incident Type</label>
            <input value={incidentType} onChange={(e)=>setIncidentType(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium">Severity</label>
            <select value={severity} onChange={(e)=>setSeverity(e.target.value)} className="mt-1 w-full border rounded px-3 py-2">
              <option value="">Select severity</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium">Radius (km)</label>
            <input value={radiusKm} onChange={(e)=>setRadiusKm(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" type="number" min="0" step="0.1" />
          </div>
        </div>
        <div className="mb-2">
          <label className="block text-sm font-medium">Search place</label>
          <input
            value={searchQuery}
            onChange={(e)=>setSearchQuery(e.target.value)}
            className="mt-1 w-full border rounded px-3 py-2"
            placeholder="Type a place name, address, city"
          />
          {searching && <div className="text-xs text-gray-500 mt-1">Searching…</div>}
          {searchError && <div className="text-xs text-red-600 mt-1">{searchError}</div>}
          {!!searchResults.length && (
            <div className="mt-2 border rounded divide-y bg-white max-h-52 overflow-auto">
              {searchResults.map((r, idx) => (
                <button
                  key={`${r.place_id}-${idx}`}
                  type="button"
                  className="w-full text-left px-3 py-2 hover:bg-gray-50"
                  onClick={() => {
                    const la = parseFloat(r.lat).toFixed(6);
                    const ln = parseFloat(r.lon).toFixed(6);
                    setLat(la); setLng(ln);
                    setSearchResults([]);
                  }}
                >
                  <div className="text-sm">{r.display_name}</div>
                  <div className="text-xs text-gray-500">Lat {parseFloat(r.lat).toFixed(5)}, Lng {parseFloat(r.lon).toFixed(5)}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Latitude</label>
            <input value={lat} onChange={(e)=>setLat(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" type="number" step="0.000001" placeholder="Click on map to fill" />
          </div>
          <div>
            <label className="block text-sm font-medium">Longitude</label>
            <input value={lng} onChange={(e)=>setLng(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" type="number" step="0.000001" placeholder="Click on map to fill" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={useMyLocation} className="px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50" disabled={geoBusy}>
            {geoBusy ? 'Locating…' : 'Use my location'}
          </button>
          <span className="text-xs text-gray-500">You can also click on the map to set coordinates.</span>
        </div>
        <div className="h-72 rounded overflow-hidden border">
          <MapContainer center={center} zoom={12} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToSetMarker />
            <RecenterOnChange latV={lat} lngV={lng} />
            {!isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng)) && (
              <Marker position={[parseFloat(lat), parseFloat(lng)]}>
                <Popup>Selected location<br/>Lat {lat}, Lng {lng}</Popup>
              </Marker>
            )}
          </MapContainer>
        </div>
        <div className="pt-2">
          <button disabled={submitting} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
            {submitting ? 'Creating…' : 'Create Crisis'}
          </button>
        </div>
      </form>
    </div>
  );
}

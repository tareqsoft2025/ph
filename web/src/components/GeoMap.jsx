import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * خريطة بسيطة: مواقع العمل كدوائر، ونقطة اختيارية (موقعي)، والنقر لاختيار موقع.
 * @param {{ center?: [number, number], zoom?: number, circles?: {lat:number,lng:number,radius:number,name?:string,active?:boolean}[], point?: {lat:number,lng:number,accuracy?:number}, onPick?: (p:{lat:number,lng:number}) => void, height?: number }} props
 */
export default function GeoMap({ center, zoom = 16, circles = [], point, onPick, height = 300 }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(center || [24.7136, 46.6753], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', (e) => pickRef.current?.({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }));
    map.current = m;
    let alive = true;
    const t = setTimeout(() => alive && m.invalidateSize(), 50);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => alive && m.invalidateSize()) : null;
    ro?.observe(el.current);
    return () => { alive = false; clearTimeout(t); ro?.disconnect(); map.current = null; m.remove(); };
  }, []); // eslint-disable-line

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const g = layer.current;
    g.clearLayers();
    const css = getComputedStyle(document.documentElement);
    const primary = css.getPropertyValue('--primary').trim() || '#0b6b3a';
    const accent = css.getPropertyValue('--accent').trim() || '#b87333';
    const bounds = [];
    circles.forEach((c) => {
      const color = c.active === false ? '#999' : primary;
      L.circle([c.lat, c.lng], { radius: c.radius, color, weight: 2, fillColor: color, fillOpacity: 0.15 }).addTo(g);
      L.circleMarker([c.lat, c.lng], { radius: 5, color, weight: 2, fillColor: '#fff', fillOpacity: 1 })
        .bindTooltip(c.name || '', { direction: 'top', permanent: !!c.name, className: 'geo-tip' }).addTo(g);
      bounds.push(L.latLng(c.lat, c.lng).toBounds(c.radius * 2.4));
    });
    if (point && Number.isFinite(point.lat)) {
      if (point.accuracy) L.circle([point.lat, point.lng], { radius: point.accuracy, color: accent, weight: 1, fillOpacity: 0.08, dashArray: '4 4' }).addTo(g);
      L.circleMarker([point.lat, point.lng], { radius: 8, color: '#fff', weight: 3, fillColor: accent, fillOpacity: 1 }).bindTooltip('موقعك', { direction: 'top' }).addTo(g);
      bounds.push(L.latLng(point.lat, point.lng).toBounds(Math.max(80, (point.accuracy || 0) * 2)));
    }
    if (bounds.length) {
      const b = bounds.reduce((acc, x) => acc.extend(x), bounds[0]);
      m.fitBounds(b, { padding: [24, 24], maxZoom: 18, animate: false });
    } else if (center) m.setView(center, zoom, { animate: false });
  }, [JSON.stringify(circles), point?.lat, point?.lng, point?.accuracy]); // eslint-disable-line

  return <div ref={el} className="geo-map" style={{ height }} role="application" aria-label="خريطة مواقع الحضور" />;
}

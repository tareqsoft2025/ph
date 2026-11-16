// قراءة الموقع ومعرّف الجهاز وتسجيل الحضور/الانصراف بأمان
import { registerPlugin } from '@capacitor/core';
import { api, isNative } from './api.js';

const SecureLocation = registerPlugin('SecureLocation');

/** معرّف ثابت للجهاز: Android ID في التطبيق، ومعرّف عشوائي محفوظ في المتصفح */
export async function deviceId() {
  if (isNative) {
    try { return (await SecureLocation.deviceInfo()).deviceId; } catch { /* fallthrough */ }
  }
  try {
    let id = localStorage.getItem('ph-device-id');
    if (!id) {
      const b = new Uint8Array(16);
      crypto.getRandomValues(b);
      id = `web-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
      localStorage.setItem('ph-device-id', id);
    }
    return id;
  } catch {
    return null;
  }
}

/** موقع جديد (لا يُقبل موقع مخزّن) مع مؤشرات سلامة الجهاز */
export async function readPosition() {
  if (isNative) {
    const p = await SecureLocation.getPosition();
    return { lat: p.lat, lng: p.lng, accuracy: p.accuracy, age_ms: p.ageMs, mock: !!p.mock, emulator: !!p.emulator, rooted: !!p.rooted, device_id: p.deviceId, platform: 'android' };
  }
  if (!('geolocation' in navigator)) throw Object.assign(new Error('المتصفح لا يدعم تحديد الموقع'), { reason: 'no_geo' });
  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, (e) => {
      const msg = e.code === 1 ? 'يجب السماح للمتصفح بتحديد الموقع' : e.code === 3 ? 'انتهت مهلة تحديد الموقع، حاول مجدداً' : 'تعذّر تحديد موقعك';
      reject(Object.assign(new Error(msg), { reason: e.code === 1 ? 'permission_denied' : 'no_fix' }));
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  });
  return {
    lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy,
    age_ms: Math.max(0, Date.now() - pos.timestamp), platform: 'web', device_id: await deviceId(),
  };
}

/**
 * تسجيل حضور أو انصراف
 * @param {'check-in'|'check-out'} action
 * @param {{ needLocation: boolean }} opts
 * @param {(step: string) => void} onStep
 */
export async function punch(action, { needLocation }, onStep = () => {}) {
  onStep('device');
  const did = await deviceId();
  let pos = { platform: isNative ? 'android' : 'web', device_id: did };
  if (needLocation || isNative) {
    onStep('location');
    try {
      pos = { ...pos, ...(await readPosition()) };
    } catch (e) {
      if (needLocation) throw e;
    }
  }
  onStep('verify');
  const { nonce } = await api('/attendance/challenge', { method: 'POST' });
  return api(`/attendance/${action}`, { method: 'POST', body: { nonce, ...pos } });
}

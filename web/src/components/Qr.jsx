import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** رمز QR كصورة */
export default function Qr({ url, size = 200 }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(url, { margin: 1, width: size * 2, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc('')); }, [url, size]);
  return src ? <img src={src} alt="رمز QR" width={size} height={size} /> : <div style={{ width: size, height: size }} />;
}

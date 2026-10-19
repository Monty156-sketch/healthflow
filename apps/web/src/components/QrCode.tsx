"use client";

import QRCode from "qrcode";
import { useMemo } from "react";

/** A QR code drawn as plain SVG squares, so it prints sharp and needs no script policy exceptions. */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const cells = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    const squares: string[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) squares.push(`M${x + 2} ${y + 2}h1v1h-1z`);
    return { n: n + 4, d: squares.join("") }; // a 2-square quiet zone on every side
  }, [value]);
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${cells.n} ${cells.n}`} shapeRendering="crispEdges" style={{ background: "#fff" }}>
      <path d={cells.d} fill="#000" />
    </svg>
  );
}

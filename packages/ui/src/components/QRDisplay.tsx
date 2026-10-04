"use client";

import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "../utils/cn";

export interface QRDisplayProps {
  token: string;
  customerName?: string;
  bookingRef?: string;
  validUntil?: string;
  className?: string;
}

export const QRDisplay: React.FC<QRDisplayProps> = ({
  token,
  customerName,
  bookingRef,
  validUntil,
  className,
}) => {
  // Generated on the device: the token is a signed access credential and must
  // never be sent to a third-party QR service.
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setQrFailed(false);
    QRCode.toString(token, { type: "svg", margin: 1 })
      .then((svg) => {
        if (!cancelled) {
          setQrSrc(
            `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setQrFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-6 bg-white rounded-2xl border border-slate-200 shadow-md max-w-sm mx-auto text-center",
        className,
      )}
    >
      <div className="w-12 h-1 bg-[#1f3a68] rounded-full mb-4"></div>
      <h3 className="font-semibold text-lg text-slate-900">Access Pass</h3>
      {bookingRef && (
        <p className="text-xs font-mono text-slate-500 uppercase mt-0.5">
          Ref: {bookingRef}
        </p>
      )}

      <div className="my-5 p-3 bg-slate-50 rounded-xl border border-slate-200">
        {qrSrc && !qrFailed ? (
          <img
            src={qrSrc}
            alt={`QR Code Access for ${bookingRef || "booking"}`}
            className="w-48 h-48 object-contain rounded-lg"
          />
        ) : (
          <div
            className={cn(
              "w-48 h-48 rounded-lg bg-slate-100 flex items-center justify-center text-xs text-slate-500",
              !qrFailed && "animate-pulse",
            )}
          >
            {qrFailed ? "QR code unavailable" : null}
          </div>
        )}
      </div>

      {customerName && (
        <p className="font-medium text-sm text-slate-800">{customerName}</p>
      )}
      {validUntil && (
        <p className="text-xs text-slate-500 mt-1">
          Valid Until: <span className="font-semibold">{validUntil}</span>
        </p>
      )}
      <div className="mt-4 text-[11px] text-slate-400">
        Present this QR code at reception or security check-in
      </div>
    </div>
  );
};

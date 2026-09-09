"use client";

import { useEffect, useState } from "react";

export function VerifiedCheck() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span
      className={`verified-check text-go ${visible ? "verified-check-in" : ""}`}
      aria-label="Verified against the register"
      role="img"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

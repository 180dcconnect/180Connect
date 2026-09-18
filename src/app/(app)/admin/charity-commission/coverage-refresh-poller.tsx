"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * First deployment starts with four intentionally blank rows. Refreshing the
 * server component briefly lets those figures appear as soon as the
 * after-response worker finishes, without asking an administrator to reload.
 * The loop is finite and only mounts while the server says work remains.
 */
export function CoverageRefreshPoller() {
  const router = useRouter();

  useEffect(() => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      router.refresh();
      if (attempts >= 12) window.clearInterval(timer);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return null;
}

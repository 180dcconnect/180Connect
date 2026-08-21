"use client";

import Image from "next/image";
import { MotionConfig } from "motion/react";

import { BrandSearchBar } from "@/components/brand/search-bar";
import { GROUND } from "@/components/brand/tokens";

/**
 * Preview harness for the glass search bar, alongside preview-invite. A leaf
 * crop sits behind the pill on purpose — the bar is glass, and glass with
 * nothing behind it to blur reads as a flat grey rectangle.
 */
export default function PreviewSearchPage() {
  return (
    <MotionConfig reducedMotion="user">
      <main
        className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-6"
        style={{ backgroundColor: GROUND }}
      >
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <Image
            src="/crops/leaf-moss.png"
            alt=""
            width={280}
            height={280}
            className="absolute top-[26%] left-[12%]"
            unoptimized
          />
          <Image
            src="/crops/leaf-bark.png"
            alt=""
            width={200}
            height={200}
            className="absolute top-[52%] right-[16%]"
            unoptimized
          />
        </div>

        <div className="relative z-10 flex w-full justify-center">
          <BrandSearchBar />
        </div>
      </main>
    </MotionConfig>
  );
}

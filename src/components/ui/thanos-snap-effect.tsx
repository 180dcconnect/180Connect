"use client";

/**
 * Highly inspired by Mikhail Bespalov's codepen
 * https://codepen.io/Mikhail-Bespalov/pen/yLmpxOG
 */

import * as React from "react";
import {
  motion,
  useAnimate,
  useMotionValue,
  useMotionValueEvent,
} from "motion/react";
import { cn } from "@/lib/utils";

const DURATION_SECONDS = 0.6;
const MAX_DISPLACEMENT = 300;
const OPACITY_CHANGE_START = 0.5;
const transition = {
  duration: DURATION_SECONDS,
  ease: (time: number) => 1 - Math.pow(1 - time, 3),
};

export interface ThanosSnapEffectProps extends React.PropsWithChildren {
  /** Optional custom class name for the wrapper */
  className?: string;
  /** Optional callback fired when the dissolve animation finishes */
  onComplete?: () => void;
  /** Whether clicking directly triggers the animation (default: true if no external trigger) */
  triggerOnClick?: boolean;
  /** Optional external boolean to trigger the snap animation */
  trigger?: boolean;
}

export interface ThanosSnapEffectRef {
  snap: () => Promise<void>;
  reset: () => void;
}

export const ThanosSnapEffect = React.forwardRef<
  ThanosSnapEffectRef,
  ThanosSnapEffectProps
>(function ThanosSnapEffect(
  {
    children,
    className,
    onComplete,
    triggerOnClick = true,
    trigger,
  },
  ref
) {
  const reactId = React.useId();
  const filterId = React.useMemo(
    () => `dissolve-filter-${reactId.replace(/[^a-zA-Z0-9-_]/g, "")}`,
    [reactId]
  );

  const [scope, animate] = useAnimate<HTMLDivElement>();
  const displacementMapRef = React.useRef<SVGFEDisplacementMapElement>(null);
  const dissolveTargetRef = React.useRef<HTMLDivElement>(null);
  const displacement = useMotionValue(0);

  useMotionValueEvent(displacement, "change", (latest) => {
    displacementMapRef.current?.setAttribute("scale", latest.toString());
  });

  const snap = React.useCallback(async () => {
    if (!scope.current || !dissolveTargetRef.current) return;
    if (scope.current.dataset.isAnimating === "true") return;

    scope.current.dataset.isAnimating = "true";

    await Promise.all([
      animate(
        dissolveTargetRef.current,
        { scale: 1.2, opacity: [1, 1, 0] },
        { ...transition, times: [0, OPACITY_CHANGE_START, 1] }
      ),
      animate(displacement, MAX_DISPLACEMENT, transition),
    ]);

    onComplete?.();

    setTimeout(() => {
      if (dissolveTargetRef.current) {
        animate(
          dissolveTargetRef.current,
          { scale: 1, opacity: 1 },
          { duration: 0 }
        );
      }
      displacement.set(0);
      if (scope.current) {
        scope.current.dataset.isAnimating = "false";
      }
    }, 500);
  }, [animate, displacement, onComplete, scope]);

  const reset = React.useCallback(() => {
    if (dissolveTargetRef.current) {
      animate(
        dissolveTargetRef.current,
        { scale: 1, opacity: 1 },
        { duration: 0 }
      );
    }
    displacement.set(0);
    if (scope.current) {
      scope.current.dataset.isAnimating = "false";
    }
  }, [animate, displacement, scope]);

  React.useImperativeHandle(ref, () => ({
    snap,
    reset,
  }));

  React.useEffect(() => {
    if (trigger) {
      snap();
    }
  }, [trigger, snap]);

  const handleClick = () => {
    if (triggerOnClick) {
      snap();
    }
  };

  return (
    <div ref={scope} className={cn("relative inline-block", className)}>
      <motion.div
        ref={dissolveTargetRef}
        onClick={handleClick}
        style={{ filter: `url(#${filterId})` }}
        className="will-change-transform"
      >
        {children}
      </motion.div>

      <svg width="0" height="0" className="absolute -z-10 pointer-events-none opacity-0">
        <defs>
          <filter
            id={filterId}
            x="-300%"
            y="-300%"
            width="600%"
            height="600%"
            colorInterpolationFilters="sRGB"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.015"
              numOctaves="1"
              result="bigNoise"
            />
            <feComponentTransfer in="bigNoise" result="bigNoiseAdjusted">
              <feFuncR type="linear" slope="0.5" intercept="-0.2" />
              <feFuncG type="linear" slope="3" intercept="-0.6" />
            </feComponentTransfer>
            <feTurbulence
              type="fractalNoise"
              baseFrequency="1"
              numOctaves="2"
              result="fineNoise"
            />
            <feMerge result="combinedNoise">
              <feMergeNode in="bigNoiseAdjusted" />
              <feMergeNode in="fineNoise" />
            </feMerge>
            <feDisplacementMap
              ref={displacementMapRef}
              in="SourceGraphic"
              in2="combinedNoise"
              scale="0"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
    </div>
  );
});

ThanosSnapEffect.displayName = "ThanosSnapEffect";

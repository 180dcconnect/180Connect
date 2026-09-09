"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

// Helper function to convert a value to its percentage representation within a range
const valueToPercent = (value: number, min: number, max: number) => {
  if (max === min) return 0;
  return ((value - min) / (max - min)) * 100;
};

// Helper function to format currency values
const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

/**
 * Color ramp inspired by the Financials Sankey chart:
 * Money Out ramp (deep brick red #8C3A2B, rust #B05840, terracotta #C67C5C)
 * transitioning through warm orange, amber, golden yellow, chartreuse,
 * to Money In ramp (eucalyptus green, deep jade #356B58, forest #204A3E).
 */
export const SANKEY_COLOR_STOPS: readonly [number, string][] = [
  [0.00, "#8C3A2B"], // Sankey OUT_RAMP[0] - Deep brick red
  [0.15, "#B44E36"], // Sankey rust red
  [0.30, "#D96E32"], // Sankey terracotta orange
  [0.45, "#E59B2C"], // Warm amber orange
  [0.58, "#E0BA38"], // Golden yellow
  [0.70, "#8CB948"], // Warm lime / chartreuse
  [0.82, "#509668"], // Eucalyptus green
  [0.92, "#356B58"], // Sankey IN_RAMP[1] - Deep jade green
  [1.00, "#204A3E"], // Sankey IN_RAMP[0] - Darkest forest green
];

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function getSankeyGradientColor(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  for (let i = 0; i < SANKEY_COLOR_STOPS.length - 1; i++) {
    const [t0, c0] = SANKEY_COLOR_STOPS[i];
    const [t1, c1] = SANKEY_COLOR_STOPS[i + 1];
    if (clamped >= t0 && clamped <= t1) {
      const localT = (clamped - t0) / (t1 - t0);
      const [r0, g0, b0] = hexToRgb(c0);
      const [r1, g1, b1] = hexToRgb(c1);
      const r = Math.round(r0 + localT * (r1 - r0));
      const g = Math.round(g0 + localT * (g1 - g0));
      const b = Math.round(b0 + localT * (b1 - b0));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return SANKEY_COLOR_STOPS[SANKEY_COLOR_STOPS.length - 1][1];
}

export interface PriceRangeSliderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "defaultValue" | "title"> {
  data?: number[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: [number, number];
  value?: [number, number];
  onValueChange?: (value: [number, number]) => void;
  formatValue?: (value: number) => string;
  title?: React.ReactNode;
  minLabel?: string;
  maxLabel?: string;
  minSubtitle?: React.ReactNode;
  maxSubtitle?: React.ReactNode;
  showHistogram?: boolean;
  showValueDisplays?: boolean;
  histogramHeight?: string;
  colorScheme?: "sankey" | "primary";
  getBarColor?: (index: number, count: number, isInRange: boolean) => string;
  barCounts?: number[];
}

const PriceRangeSlider = React.forwardRef<HTMLDivElement, PriceRangeSliderProps>(
  (
    {
      className,
      data = [],
      min = 0,
      max = 5000,
      step = 10,
      defaultValue = [1000, 4000],
      value: controlledValue,
      onValueChange,
      formatValue = formatCurrency,
      title = "Price Range",
      minLabel = "Minimum",
      maxLabel = "Maximum",
      minSubtitle,
      maxSubtitle,
      showHistogram = true,
      showValueDisplays = true,
      histogramHeight = "h-36 sm:h-40",
      colorScheme = "sankey",
      getBarColor,
      barCounts,
      ...props
    },
    ref
  ) => {
    const isControlled = controlledValue !== undefined;
    const [localValues, setLocalValues] = React.useState<[number, number]>(defaultValue);

    const [minVal, maxVal] = isControlled ? controlledValue : localValues;

    const valuesRef = React.useRef<[number, number]>([minVal, maxVal]);
    valuesRef.current = [minVal, maxVal];

    const [isMinThumbDragging, setIsMinThumbDragging] = React.useState(false);
    const [isMaxThumbDragging, setIsMaxThumbDragging] = React.useState(false);

    const sliderRef = React.useRef<HTMLDivElement>(null);
    const minThumbRef = React.useRef<HTMLButtonElement>(null);
    const maxThumbRef = React.useRef<HTMLButtonElement>(null);

    const minPercent = Math.max(0, Math.min(100, valueToPercent(minVal, min, max)));
    const maxPercent = Math.max(0, Math.min(100, valueToPercent(maxVal, min, max)));

    // Handles value updates and calls the onValueChange callback
    const handleValueChange = React.useCallback(
      (newValues: [number, number]) => {
        valuesRef.current = newValues;
        if (!isControlled) {
          setLocalValues(newValues);
        }
        if (onValueChange) {
          onValueChange(newValues);
        }
      },
      [isControlled, onValueChange]
    );

    // Clicking anywhere on track moves the closest thumb
    const handleTrackMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
      if (!sliderRef.current) return;
      if ((event.target as HTMLElement).tagName === "BUTTON") return;
      const rect = sliderRef.current.getBoundingClientRect();
      const percent = Math.max(
        0,
        Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)
      );
      const clickedValue =
        Math.round((min + (percent / 100) * (max - min)) / step) * step;
      const clampedValue = Math.max(min, Math.min(max, clickedValue));

      const [curMin, curMax] = valuesRef.current;
      const distToMin = Math.abs(clampedValue - curMin);
      const distToMax = Math.abs(clampedValue - curMax);

      if (distToMin <= distToMax) {
        handleValueChange([Math.min(clampedValue, curMax - step), curMax]);
        setIsMinThumbDragging(true);
      } else {
        handleValueChange([curMin, Math.max(clampedValue, curMin + step)]);
        setIsMaxThumbDragging(true);
      }
    };

    // Effect for handling mouse/touch move events
    React.useEffect(() => {
      const handleMouseMove = (event: MouseEvent | TouchEvent) => {
        if (!sliderRef.current) return;

        const clientX =
          "touches" in event ? event.touches[0].clientX : event.clientX;
        const rect = sliderRef.current.getBoundingClientRect();
        const rawPercent = Math.max(
          0,
          Math.min(100, ((clientX - rect.left) / rect.width) * 100)
        );
        const newValue =
          Math.round((min + (rawPercent / 100) * (max - min)) / step) * step;
        const clampedNewValue = Math.max(min, Math.min(max, newValue));

        const [curMin, curMax] = valuesRef.current;

        if (isMinThumbDragging) {
          handleValueChange([Math.min(clampedNewValue, curMax - step), curMax]);
        }
        if (isMaxThumbDragging) {
          handleValueChange([curMin, Math.max(clampedNewValue, curMin + step)]);
        }
      };

      const handleMouseUp = () => {
        setIsMinThumbDragging(false);
        setIsMaxThumbDragging(false);
      };

      if (isMinThumbDragging || isMaxThumbDragging) {
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("touchmove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        document.addEventListener("touchend", handleMouseUp);
      }

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("touchmove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("touchend", handleMouseUp);
      };
    }, [isMinThumbDragging, isMaxThumbDragging, min, max, step, handleValueChange]);

    // Handles keyboard navigation for accessibility
    const handleKeyDown = (
      e: React.KeyboardEvent<HTMLButtonElement>,
      thumb: "min" | "max"
    ) => {
      let newMinValue = minVal;
      let newMaxValue = maxVal;

      if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
        e.preventDefault();
        if (thumb === "min") newMinValue = Math.max(min, minVal - step);
        else newMaxValue = Math.max(minVal + step, maxVal - step);
      } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
        e.preventDefault();
        if (thumb === "min") newMinValue = Math.min(maxVal - step, minVal + step);
        else newMaxValue = Math.min(max, maxVal + step);
      } else if (e.key === "Home") {
        e.preventDefault();
        if (thumb === "min") newMinValue = min;
        else newMaxValue = minVal + step;
      } else if (e.key === "End") {
        e.preventDefault();
        if (thumb === "min") newMinValue = maxVal - step;
        else newMaxValue = max;
      }

      handleValueChange([newMinValue, newMaxValue]);
    };

    const hasData = Boolean(data && data.length > 0);
    const maxDataValue = React.useMemo(() => {
      if (!data || data.length === 0) return 1;
      const max = Math.max(...data);
      return max > 0 ? max : 1;
    }, [data]);

    return (
      <div className={cn("w-full px-4", className)} {...props} ref={ref}>
        {title ? (
          <div className="mb-6 text-center">
            <h3 className="text-lg font-medium text-foreground">{title}</h3>
          </div>
        ) : null}

        <div
          className={cn("relative w-full cursor-pointer select-none", histogramHeight)}
          ref={sliderRef}
          onMouseDown={handleTrackMouseDown}
        >
          {/* Histogram Bars */}
          {showHistogram && hasData && (
            <div className="absolute inset-0 flex items-end gap-px">
              {data.map((value, index) => {
                const barPercent = (index / (data.length - 1)) * 100;
                const isInRange =
                  barPercent >= minPercent && barPercent <= maxPercent;
                const barHeightPercent = Math.max(8, (value / maxDataValue) * 100);
                const ratio = data.length > 1 ? index / (data.length - 1) : 0;
                const barColor = getBarColor
                  ? getBarColor(index, data.length, isInRange)
                  : colorScheme === "sankey"
                  ? getSankeyGradientColor(ratio)
                  : undefined;
                const countText = barCounts?.[index] !== undefined
                  ? `${barCounts[index].toLocaleString()} charities`
                  : undefined;

                return (
                  <div
                    key={index}
                    title={countText}
                    className={cn(
                      "w-full rounded-t-sm transition-all duration-200 pointer-events-none",
                      !barColor && (isInRange ? "bg-primary" : "bg-muted")
                    )}
                    style={{
                      height: `${barHeightPercent}%`,
                      backgroundColor: barColor
                        ? isInRange
                          ? barColor
                          : "#E5E5E2"
                        : undefined,
                    }}
                  />
                );
              })}
            </div>
          )}

          {/* Slider Thumbs */}
          <div className="relative h-full pointer-events-none">
            <button
              ref={minThumbRef}
              type="button"
              role="slider"
              aria-valuemin={min}
              aria-valuemax={maxVal - step}
              aria-valuenow={minVal}
              aria-label={minLabel}
              onMouseDown={(e) => {
                e.stopPropagation();
                setIsMinThumbDragging(true);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                setIsMinThumbDragging(true);
              }}
              onKeyDown={(e) => handleKeyDown(e, "min")}
              className={cn(
                "pointer-events-auto absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing rounded-full border-2 bg-background shadow-sm transition-transform duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                colorScheme !== "sankey" && "border-primary",
                isMinThumbDragging ? "z-20 scale-125 ring-2 ring-primary/40 ring-offset-2" : "z-10 hover:scale-110"
              )}
              style={{
                left: `${minPercent}%`,
                borderColor: colorScheme === "sankey" ? getSankeyGradientColor(minPercent / 100) : undefined,
              }}
            />
            <button
              ref={maxThumbRef}
              type="button"
              role="slider"
              aria-valuemin={minVal + step}
              aria-valuemax={max}
              aria-valuenow={maxVal}
              aria-label={maxLabel}
              onMouseDown={(e) => {
                e.stopPropagation();
                setIsMaxThumbDragging(true);
              }}
              onTouchStart={(e) => {
                e.stopPropagation();
                setIsMaxThumbDragging(true);
              }}
              onKeyDown={(e) => handleKeyDown(e, "max")}
              className={cn(
                "pointer-events-auto absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing rounded-full border-2 bg-background shadow-sm transition-transform duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                colorScheme !== "sankey" && "border-primary",
                isMaxThumbDragging ? "z-20 scale-125 ring-2 ring-primary/40 ring-offset-2" : "z-10 hover:scale-110"
              )}
              style={{
                left: `${maxPercent}%`,
                borderColor: colorScheme === "sankey" ? getSankeyGradientColor(maxPercent / 100) : undefined,
              }}
            />
          </div>
        </div>

        {/* Value Displays */}
        {showValueDisplays && (
          <div className="mt-4 grid grid-cols-2 items-center gap-4">
            <div className="rounded-lg p-3 sm:p-4 text-center">
              <p className="text-[18px] font-medium text-muted-foreground">{minLabel}</p>
              <p className="text-[44px] sm:text-[56px] font-bold tracking-tight text-card-foreground">
                {formatValue(minVal)}
              </p>
              {minSubtitle ? (
                <div className="mt-0.5 text-[18px] text-muted-foreground">{minSubtitle}</div>
              ) : null}
            </div>
            <div className="rounded-lg p-3 sm:p-4 text-center">
              <p className="text-[18px] font-medium text-muted-foreground">{maxLabel}</p>
              <p className="text-[44px] sm:text-[56px] font-bold tracking-tight text-card-foreground">
                {formatValue(maxVal)}
              </p>
              {maxSubtitle ? (
                <div className="mt-0.5 text-[18px] text-muted-foreground">{maxSubtitle}</div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  }
);

PriceRangeSlider.displayName = "PriceRangeSlider";

export { PriceRangeSlider, PriceRangeSlider as RangeSlider };
export default PriceRangeSlider;

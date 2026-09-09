import * as React from 'react';

import {
  HoverCard as HoverCardPrimitive,
  HoverCardTrigger as HoverCardTriggerPrimitive,
  HoverCardContent as HoverCardContentPrimitive,
  HoverCardArrow as HoverCardArrowPrimitive,
  type HoverCardProps as HoverCardPrimitiveProps,
  type HoverCardTriggerProps as HoverCardTriggerPrimitiveProps,
  type HoverCardContentProps as HoverCardContentPrimitiveProps,
  type HoverCardArrowProps as HoverCardArrowPrimitiveProps,
} from '@/components/animate-ui/primitives/radix/hover-card';

import { cn } from '@/lib/utils';

type HoverCardProps = HoverCardPrimitiveProps;

function HoverCard(props: HoverCardProps) {
  return <HoverCardPrimitive data-slot="hover-card" {...props} />;
}

type HoverCardTriggerProps = HoverCardTriggerPrimitiveProps;

function HoverCardTrigger(props: HoverCardTriggerProps) {
  return (
    <HoverCardTriggerPrimitive
      data-slot="hover-card-trigger"
      {...props}
    />
  );
}

type HoverCardContentProps = HoverCardContentPrimitiveProps & {
  className?: string;
};

function HoverCardContent({
  className,
  ...props
}: HoverCardContentProps) {
  return (
    <HoverCardContentPrimitive
      data-slot="hover-card-content"
      className={cn(
        'bg-white/95 backdrop-blur-xl border border-black/[0.08] dark:bg-black/95 dark:border-white/[0.08] rounded-2xl shadow-[0_12px_40px_rgba(0,0,0,0.15)] p-4 min-w-[280px] max-w-[360px]',
        className
      )}
      {...props}
    />
  );
}

type HoverCardArrowProps = HoverCardArrowPrimitiveProps;

function HoverCardArrow(props: HoverCardArrowProps) {
  return <HoverCardArrowPrimitive data-slot="hover-card-arrow" {...props} />;
}

export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  HoverCardArrow,
  type HoverCardProps,
  type HoverCardTriggerProps,
  type HoverCardContentProps,
  type HoverCardArrowProps,
};
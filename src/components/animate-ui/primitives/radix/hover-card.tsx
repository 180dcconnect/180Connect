'use client';

import * as React from 'react';
import {
  Root as HoverCardRoot,
  Trigger as HoverCardTriggerPrimitive,
  Content as HoverCardContentPrimitive,
  Arrow as HoverCardArrowPrimitive,
  Portal as HoverCardPortalPrimitive,
  type HoverCardProps as HoverCardPrimitiveProps,
} from '@radix-ui/react-hover-card';

import { AnimatePresence, motion, type HTMLMotionProps } from 'motion/react';

import { getStrictContext } from '@/lib/get-strict-context';
import { useControlledState } from '@/hooks/use-controlled-state';

/*
 * Every Radix import above is aliased to `*Primitive`, and the wrappers below are
 * named `*Component`. That is load-bearing, not style: importing
 * `Trigger as HoverCardTrigger` and then declaring `function HoverCardTrigger()`
 * in the same module makes the function shadow the import, so the JSX inside it
 * resolves to the function itself — each wrapper called itself forever and blew
 * the stack on first render.
 */

type HoverCardContextType = {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
};

const [LocalHoverCardProvider, useHoverCard] =
  getStrictContext<HoverCardContextType>('HoverCardContext');

type HoverCardProps = React.ComponentProps<typeof HoverCardRoot> & {
  openDelay?: number;
  closeDelay?: number;
};

function HoverCard({
  openDelay = 150,
  closeDelay = 100,
  ...props
}: {
  openDelay?: number;
  closeDelay?: number;
} & React.ComponentProps<typeof HoverCardRoot>) {
  const [isOpen, setIsOpen] = useControlledState({
    value: props?.open,
    defaultValue: props?.defaultOpen,
    onChange: props?.onOpenChange,
  });

  const openTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenChange = (open: boolean) => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    if (open) {
      openTimeoutRef.current = setTimeout(() => {
        setIsOpen(true);
      }, openDelay);
    } else {
      closeTimeoutRef.current = setTimeout(() => {
        setIsOpen(false);
      }, closeDelay);
    }

    // NOT `props.onOpenChange?.(open)` here: setIsOpen already forwards to it
    // through useControlledState's `onChange`, so calling it again fired every
    // open and close twice — and undelayed, before the card had appeared.
  };

  React.useEffect(() => {
    return () => {
      if (openTimeoutRef.current) clearTimeout(openTimeoutRef.current);
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  return (
    <LocalHoverCardProvider value={{ isOpen, setIsOpen: handleOpenChange }}>
      <HoverCardRoot data-slot="hover-card" {...props} onOpenChange={handleOpenChange} />
    </LocalHoverCardProvider>
  );
}

type HoverCardTriggerProps = React.ComponentProps<typeof HoverCardTriggerPrimitive>;

function HoverCardTriggerComponent(props: HoverCardTriggerProps) {
  return <HoverCardTriggerPrimitive data-slot="hover-card-trigger" {...props} />;
}

type HoverCardPortalProps = React.ComponentProps<typeof HoverCardPortalPrimitive>;

function HoverCardPortalComponent(props: HoverCardPortalProps) {
  const { isOpen } = useHoverCard();

  if (!isOpen) return null;

  return <HoverCardPortalPrimitive forceMount data-slot="hover-card-portal" {...props} />;
}

type HoverCardContentProps = {
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  align?: 'start' | 'center' | 'end';
  alignOffset?: number;
  avoidCollisions?: boolean;
  collisionBoundary?: Element | null;
  collisionPadding?: number | Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>;
  arrowPadding?: number;
  /** Radix's own union — NOT a boolean. */
  sticky?: 'partial' | 'always';
  hideWhenDetached?: boolean;
  transition?: {
    type?: 'spring' | 'tween';
    stiffness?: number;
    damping?: number;
    duration?: number;
  };
  style?: React.CSSProperties;
  /*
   * The rest props land on a `motion.div`, so they have to be motion's prop type
   * and not React's. `React.HTMLProps<HTMLDivElement>` collides on the drag
   * handlers — React's `onDrag` is a DragEventHandler, motion's is
   * `(event, info: PanInfo) => void` — and TS rejects the whole spread over that
   * one incompatible key.
   */
} & Omit<HTMLMotionProps<'div'>, 'ref' | 'style' | 'transition'>;

function HoverCardContentComponent({
  side = 'right',
  sideOffset = 8,
  align = 'center',
  alignOffset = 0,
  avoidCollisions = true,
  collisionBoundary,
  collisionPadding = 8,
  arrowPadding,
  hideWhenDetached = true,
  transition = { type: 'spring', stiffness: 300, damping: 25 },
  style,
  ...restProps
}: Omit<HoverCardContentProps, 'sticky'>) {
  const { isOpen } = useHoverCard();

  return (
    <AnimatePresence>
      {isOpen && (
        <HoverCardPortalPrimitive forceMount>
          <HoverCardContentPrimitive
            asChild
            forceMount
            side={side}
            sideOffset={sideOffset}
            align={align}
            alignOffset={alignOffset}
            avoidCollisions={avoidCollisions}
            collisionBoundary={collisionBoundary}
            collisionPadding={collisionPadding}
            sticky="always"
            hideWhenDetached={hideWhenDetached}
          >
            <motion.div
              key="hover-card-content"
              data-slot="hover-card-content"
              initial={{ opacity: 0, scale: 0.95, y: 4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 4 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              style={{ willChange: 'opacity, transform', ...style }}
              {...restProps}
            />
          </HoverCardContentPrimitive>
        </HoverCardPortalPrimitive>
      )}
    </AnimatePresence>
  );
}

type HoverCardArrowProps = React.ComponentProps<typeof HoverCardArrowPrimitive>;

function HoverCardArrowComponent(props: HoverCardArrowProps) {
  return <HoverCardArrowPrimitive data-slot="hover-card-arrow" {...props} />;
}

export {
  HoverCard,
  HoverCardTriggerComponent as HoverCardTrigger,
  HoverCardPortalComponent as HoverCardPortal,
  HoverCardContentComponent as HoverCardContent,
  HoverCardArrowComponent as HoverCardArrow,
  type HoverCardProps,
  type HoverCardTriggerProps,
  type HoverCardPortalProps,
  type HoverCardContentProps,
  type HoverCardArrowProps,
};

export default HoverCard;
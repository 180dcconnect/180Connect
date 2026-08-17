import * as React from 'react';

import {
  PreviewCard as PreviewLinkCardPrimitive,
  PreviewCardTrigger as PreviewLinkCardTriggerPrimitive,
  PreviewCardPortal as PreviewLinkCardPortalPrimitive,
  PreviewCardPositioner as PreviewLinkCardPositionerPrimitive,
  PreviewCardPopup as PreviewLinkCardPopupPrimitive,
  PreviewCardBackdrop as PreviewLinkCardBackdropPrimitive,
  type PreviewCardProps as PreviewLinkCardPrimitiveProps,
  type PreviewCardTriggerProps as PreviewLinkCardTriggerPrimitiveProps,
  type PreviewCardPositionerProps as PreviewLinkCardPositionerPrimitiveProps,
  type PreviewCardPopupProps as PreviewLinkCardPopupPrimitiveProps,
  type PreviewCardBackdropProps as PreviewLinkCardBackdropPrimitiveProps,
} from '@/components/animate-ui/primitives/base/preview-card';
import { cn } from '@/lib/utils';

type PreviewLinkCardProps = PreviewLinkCardPrimitiveProps;

function PreviewLinkCard(props: PreviewLinkCardProps) {
  return <PreviewLinkCardPrimitive {...props} />;
}

type PreviewLinkCardTriggerProps = PreviewLinkCardTriggerPrimitiveProps;

function PreviewLinkCardTrigger(props: PreviewLinkCardTriggerProps) {
  return <PreviewLinkCardTriggerPrimitive {...props} />;
}

type PreviewLinkCardPanelProps = PreviewLinkCardPositionerPrimitiveProps &
  PreviewLinkCardPopupPrimitiveProps;

function PreviewLinkCardPanel({
  className,
  align = 'center',
  sideOffset = 4,
  style,
  children,
  ...props
}: PreviewLinkCardPanelProps) {
  return (
    <PreviewLinkCardPortalPrimitive>
      <PreviewLinkCardPositionerPrimitive
        align={align}
        sideOffset={sideOffset}
        className="z-50"
        {...props}
      >
        <PreviewLinkCardPopupPrimitive
          className={cn(
            'border origin-(--transform-origin) rounded-md shadow-md outline-hidden overflow-hidden bg-white p-3',
            className,
          )}
          style={style}
        >
          {children}
        </PreviewLinkCardPopupPrimitive>
      </PreviewLinkCardPositionerPrimitive>
    </PreviewLinkCardPortalPrimitive>
  );
}

type PreviewLinkCardBackdropProps = PreviewLinkCardBackdropPrimitiveProps;

function PreviewLinkCardBackdrop(props: PreviewLinkCardBackdropProps) {
  return <PreviewLinkCardBackdropPrimitive {...props} />;
}

export {
  PreviewLinkCard,
  PreviewLinkCardTrigger,
  PreviewLinkCardPanel,
  PreviewLinkCardBackdrop,
  type PreviewLinkCardProps,
  type PreviewLinkCardTriggerProps,
  type PreviewLinkCardPanelProps,
  type PreviewLinkCardBackdropProps,
};

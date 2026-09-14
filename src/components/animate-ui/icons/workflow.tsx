'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@/components/animate-ui/icons/icon';

type WorkflowProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    rect1: {
      initial: {
        scale: 1,
      },
      animate: {
        scale: [1, 1.18, 1],
        transition: {
          ease: 'easeInOut',
          duration: 0.5,
        },
      },
    },
    path: {
      initial: {
        pathLength: 1,
        opacity: 1,
      },
      animate: {
        pathLength: [0.1, 1],
        opacity: [0.5, 1],
        transition: {
          ease: 'easeInOut',
          duration: 0.5,
          delay: 0.1,
        },
      },
    },
    rect2: {
      initial: {
        scale: 1,
      },
      animate: {
        scale: [1, 1.18, 1],
        transition: {
          ease: 'easeInOut',
          duration: 0.5,
          delay: 0.2,
        },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: WorkflowProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.rect
        width="8"
        height="8"
        x="3"
        y="3"
        rx="2"
        variants={variants.rect1}
        initial="initial"
        animate={controls}
      />
      <motion.path
        d="M7 11v4a2 2 0 0 0 2 2h4"
        variants={variants.path}
        initial="initial"
        animate={controls}
      />
      <motion.rect
        width="8"
        height="8"
        x="13"
        y="13"
        rx="2"
        variants={variants.rect2}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Workflow(props: WorkflowProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Workflow,
  Workflow as WorkflowIcon,
  type WorkflowProps,
  type WorkflowProps as WorkflowIconProps,
};

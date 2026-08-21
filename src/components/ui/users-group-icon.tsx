"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from "@/components/animate-ui/icons/icon";

type UsersGroupIconProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    center: {
      initial: {
        y: 0,
        scale: 1,
      },
      animate: {
        y: [0, -2, 0],
        scale: [1, 1.05, 1],
        transition: {
          duration: 0.5,
          ease: "easeInOut",
        },
      },
    },
    left: {
      initial: {
        x: 0,
        scale: 1,
      },
      animate: {
        x: [0, -1.5, 0],
        scale: [1, 1.03, 1],
        transition: {
          duration: 0.55,
          ease: "easeInOut",
          delay: 0.05,
        },
      },
    },
    right: {
      initial: {
        x: 0,
        scale: 1,
      },
      animate: {
        x: [0, 1.5, 0],
        scale: [1, 1.03, 1],
        transition: {
          duration: 0.55,
          ease: "easeInOut",
          delay: 0.05,
        },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: UsersGroupIconProps) {
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
      <path stroke="none" d="M0 0h24v24H0z" fill="none" />

      {/* Center user */}
      <motion.g variants={variants.center} initial="initial" animate={controls}>
        <path d="M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
        <path d="M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1" />
      </motion.g>

      {/* Right user */}
      <motion.g variants={variants.right} initial="initial" animate={controls}>
        <path d="M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
        <path d="M17 10h2a2 2 0 0 1 2 2v1" />
      </motion.g>

      {/* Left user */}
      <motion.g variants={variants.left} initial="initial" animate={controls}>
        <path d="M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
        <path d="M3 13v-1a2 2 0 0 1 2 -2h2" />
      </motion.g>
    </motion.svg>
  );
}

function UsersGroupIcon(props: UsersGroupIconProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  UsersGroupIcon,
  UsersGroupIcon as default,
  type UsersGroupIconProps,
};

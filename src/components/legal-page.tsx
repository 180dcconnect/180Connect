"use client";

import {
  AnimatePresence,
  MotionConfig,
  motion,
  type Variants,
} from "motion/react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";

const MotionLink = motion.create(Link);

const EASE = [0.2, 0.7, 0.2, 1] as const;

/* ─── Menu data (same as landing) ──────────────────────────────────────── */

const menuLinks = [
  { label: "About", href: "/about" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Changelog", href: "/changelog" },
  { label: "Cookies", href: "/cookies" },
] as const;

const MAIL = "sheffield@180dc.org";

const socials = [
  {
    label: "Instagram",
    href: "https://www.instagram.com/180dcsheffield/",
    sprite: "ig-sprite",
  },
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/180dcsheffield/",
    sprite: "li-sprite",
  },
  {
    label: "Linktree",
    href: "https://linktr.ee/180dcsheffield",
    sprite: "lt-sprite",
  },
  {
    label: `Email ${MAIL}`,
    href: `mailto:${MAIL}`,
    sprite: "mail-sprite",
  },
] as const;

/* ─── Menu sheet variants (identical to landing) ───────────────────────── */

const SHEET_ORIGIN = "95% 5%";
const SHEET_EASE = [0.76, 0, 0.24, 1] as const;

const sheet: Variants = {
  hidden: { clipPath: `circle(0% at ${SHEET_ORIGIN})` },
  show: {
    clipPath: `circle(150% at ${SHEET_ORIGIN})`,
    transition: {
      duration: 0.85,
      ease: SHEET_EASE,
      staggerChildren: 0.06,
      delayChildren: 0.45,
    },
  },
  exit: {
    clipPath: `circle(0% at ${SHEET_ORIGIN})`,
    transition: { duration: 0.6, ease: SHEET_EASE, staggerChildren: 0.04 },
  },
};

const sheetItem: Variants = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
  exit: { opacity: 0, y: 12, transition: { duration: 0.2, ease: EASE } },
};

const CTA_GLASS = "rgba(28, 26, 24, 0.72)";
const CTA_LIP = "inset 0 1px 0 rgba(255, 255, 255, 0.3)";
const SHEET_INK = "#0c1014";

const sheetCtaDisc: Variants = {
  rest: {
    boxShadow: `inset 0 0 0 3px ${SHEET_INK}, ${CTA_LIP}`,
    transition: { duration: 0.25, ease: EASE },
  },
  hover: {
    boxShadow: `inset 0 0 0 0px ${SHEET_INK}, ${CTA_LIP}`,
    transition: { duration: 0.22, ease: EASE },
  },
};

const ctaWash: Variants = {
  rest: { left: "100%", transition: { duration: 0.28, ease: EASE } },
  hover: {
    left: "0%",
    transition: { duration: 0.38, ease: EASE, delay: 0.22 },
  },
};

const ctaLabel: Variants = {
  rest: { color: "#f4f4ef", transition: { duration: 0.2 } },
  hover: { color: "#0c1014", transition: { duration: 0.18, delay: 0.32 } },
};

const navArrow: Variants = {
  rest: { x: 0, transition: { duration: 0.25, ease: EASE } },
  hover: {
    x: [0, 22, -22, 0],
    transition: { duration: 0.6, times: [0, 0.45, 0.4501, 1], ease: EASE },
  },
};

/* ─── Small helpers ────────────────────────────────────────────────────── */

function Wordmark({ tone }: { tone: "light" | "dark" }) {
  return (
    <div
      className={`flex items-center gap-3 font-body text-2xl font-black tracking-tight ${
        tone === "light" ? "text-white" : "text-[#0c1014]"
      }`}
    >
      <Image
        src={tone === "light" ? "/180dc-globe-white.png" : "/180dc-globe.png"}
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 object-contain"
      />
      <span>180Connect</span>
    </div>
  );
}

function TreeMark() {
  return (
    <Image
      src="/try.png"
      alt=""
      fill
      sizes="(max-width: 640px) 60vw, 660px"
      className="object-contain object-bottom"
      priority={false}
    />
  );
}

/* ─── Page entrance ────────────────────────────────────────────────────── */

const entrance: Variants = {
  hidden: { opacity: 0, y: 20, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.7, ease: EASE },
  },
};

/* ─── Types ────────────────────────────────────────────────────────────── */

export type LegalSection = {
  heading: string;
  body: string[];
};

type LegalPageProps = {
  title: string;
  subtitle: string;
  lastUpdated: string;
  sections: LegalSection[];
  activeLink: string;
};

/* ─── Component ────────────────────────────────────────────────────────── */

export default function LegalPage({
  title,
  subtitle,
  lastUpdated,
  sections,
  activeLink,
}: LegalPageProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState(0);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);

  /* Escape closes sheet */
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  /* Lock body scroll when menu open */
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  /* Track active section for sidebar TOC */
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    sectionRefs.current.forEach((el, idx) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(idx);
        },
        { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((obs) => obs.disconnect());
  }, [sections.length]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative min-h-screen bg-[#f4f4ef]">
        {/* ── top bar ── */}
        <header className="relative z-30 px-6 py-6 sm:px-10 sm:py-8">
          <div className="flex items-center justify-between">
            <Link href="/" aria-label="180Connect home">
              <Wordmark tone="dark" />
            </Link>
          </div>

          {/* get-started pill */}
          <MotionLink
            href="/login"
            aria-label="Get started"
            className="absolute top-0 right-[68px] z-30 mt-6 flex h-11 items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0c1014] sm:right-[86px] sm:mt-8"
            initial="rest"
            animate="rest"
            whileHover="hover"
            whileTap={{ scale: 0.96 }}
          >
            <span
              className="relative flex h-9 items-center overflow-hidden rounded-full ring-1 ring-white/25 backdrop-blur-md"
              style={{ backgroundColor: CTA_GLASS, boxShadow: CTA_LIP }}
            >
              <span className="whitespace-nowrap px-4 font-body text-xs font-medium text-[#f4f4ef] sm:px-5 sm:text-sm">
                Get Started
              </span>
            </span>
            <span
              className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#e6f5c0] text-[#0c1014]"
              style={{
                boxShadow: `inset 0 0 0 3px ${CTA_GLASS}, ${CTA_LIP}`,
              }}
            >
              <motion.span variants={navArrow} className="flex">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-[15px] w-[15px]"
                  aria-hidden="true"
                >
                  <path d="M5 12h14" />
                  <path d="m13 6 6 6-6 6" />
                </svg>
              </motion.span>
            </span>
          </MotionLink>

          {/* burger */}
          <motion.button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="absolute top-0 right-0 z-50 mt-6 mr-4 flex h-11 w-11 items-center justify-center sm:mt-8 sm:mr-8"
          >
            <span className="relative block h-[14px] w-7">
              {[0, 1, 2].map((line) => (
                <motion.span
                  key={line}
                  className="absolute left-0 block h-[2px] w-full rounded-full"
                  style={{ top: line * 6 }}
                  animate={{
                    y: menuOpen ? (line === 0 ? 6 : line === 2 ? -6 : 0) : 0,
                    rotate: menuOpen
                      ? line === 0
                        ? 45
                        : line === 2
                          ? -45
                          : 0
                      : 0,
                    opacity: menuOpen && line === 1 ? 0 : 1,
                    backgroundColor: menuOpen ? "#f4f4ef" : "#0c1014",
                  }}
                  transition={{ duration: 0.35, ease: EASE }}
                />
              ))}
            </span>
          </motion.button>
        </header>

        {/* ── menu sheet ── */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              variants={sheet}
              initial="hidden"
              animate="show"
              exit="exit"
              className="fixed inset-0 z-40 flex flex-col justify-center bg-[#0c1014] px-6 sm:px-10"
            >
              <div className="absolute top-0 left-0 px-6 py-6 sm:px-10 sm:py-8">
                <Wordmark tone="light" />
              </div>

              <motion.div
                variants={sheetItem}
                className="pointer-events-none absolute right-0 bottom-0 h-[min(88vh,760px)] w-[min(71vh,613px)] translate-x-[10%] translate-y-[4%] opacity-25"
                aria-hidden="true"
              >
                <TreeMark />
              </motion.div>

              <nav className="flex flex-col gap-2 sm:gap-4">
                {menuLinks.map((link) => (
                  <motion.div key={link.label} variants={sheetItem}>
                    <Link
                      href={link.href}
                      onClick={() => setMenuOpen(false)}
                      className={`font-body text-[clamp(2.5rem,8vw,5.5rem)] font-black leading-[1.05] tracking-[-0.03em] transition-opacity hover:opacity-50 ${
                        link.href === `/${activeLink}`
                          ? "text-[#e6f5c0]"
                          : "text-[#f4f4ef]"
                      }`}
                    >
                      {link.label}
                    </Link>
                  </motion.div>
                ))}
              </nav>

              {/* sheet CTA */}
              <div className="absolute top-0 right-[68px] mt-6 flex h-11 items-center sm:right-[86px] sm:mt-8">
                <MotionLink
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f4f4ef]"
                  initial="rest"
                  animate="rest"
                  whileHover="hover"
                  whileTap={{ scale: 0.97 }}
                  variants={{ rest: { y: 0 }, hover: { y: -2 } }}
                  transition={{ type: "spring", stiffness: 420, damping: 28 }}
                >
                  <motion.span
                    className="relative flex h-9 items-center overflow-hidden rounded-full px-4 ring-1 ring-white/25 sm:px-5"
                    style={{
                      backgroundColor: "rgba(244, 244, 239, 0.08)",
                      boxShadow: CTA_LIP,
                    }}
                  >
                    <motion.div
                      variants={ctaWash}
                      className="absolute inset-y-0 w-[999px] rounded-l-full"
                      style={{ backgroundColor: "#f4f4ef" }}
                      aria-hidden="true"
                    />
                    <motion.span
                      variants={ctaLabel}
                      className="relative z-10 whitespace-nowrap font-body text-xs font-medium sm:text-sm"
                    >
                      Get Started
                    </motion.span>
                  </motion.span>
                  <motion.span
                    variants={sheetCtaDisc}
                    className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full text-[#0c1014]"
                    style={{ backgroundColor: "#f4f4ef" }}
                  >
                    <motion.span variants={navArrow} className="flex">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-[15px] w-[15px]"
                        aria-hidden="true"
                      >
                        <path d="M5 12h14" />
                        <path d="m13 6 6 6-6 6" />
                      </svg>
                    </motion.span>
                  </motion.span>
                </MotionLink>
              </div>

              {/* socials + copyright */}
              <motion.div
                variants={sheetItem}
                className="absolute right-0 bottom-0 left-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 px-6 pb-6 sm:px-10 sm:pb-8"
              >
                <div className="flex items-center gap-5">
                  {socials.map((social) => (
                    <a
                      key={social.label}
                      href={social.href}
                      target={
                        social.href.startsWith("http") ? "_blank" : undefined
                      }
                      rel={
                        social.href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      aria-label={social.label}
                      className="text-[#f4f4ef]/60 transition-colors hover:text-[#f4f4ef]"
                    >
                      <span
                        className={`icon-sprite ${social.sprite} block opacity-60 transition-opacity hover:opacity-100`}
                        aria-hidden="true"
                      />
                    </a>
                  ))}
                </div>
                <p className="font-body text-xs tracking-[0.02em] text-[#f4f4ef]/40 sm:mx-auto sm:-translate-x-40">
                  © {new Date().getFullYear()} 180 Degrees Consulting Sheffield
                </p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── hero strip ── */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
          }}
          className="border-b border-[#0c1014]/8 px-6 pb-12 sm:px-10 sm:pb-16 lg:px-16"
        >
          <div className="max-w-[1200px]">
            {/* back link */}
            <motion.div variants={entrance} className="mb-8">
              <Link
                href="/"
                className="group inline-flex items-center gap-2 font-body text-[13px] font-medium tracking-wide text-[#0c1014]/40 uppercase transition-colors hover:text-[#0c1014]"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5"
                  aria-hidden="true"
                >
                  <path d="M19 12H5" />
                  <path d="m11 18-6-6 6-6" />
                </svg>
                Home
              </Link>
            </motion.div>

            {/* title */}
            <motion.h1
              variants={entrance}
              className="font-body text-[clamp(2.75rem,6vw,5rem)] font-black leading-[0.95] tracking-[-0.035em] text-[#0c1014]"
            >
              {title}
            </motion.h1>

            {/* meta row */}
            <motion.div
              variants={entrance}
              className="mt-6 flex flex-wrap items-center gap-4"
            >
              <span className="rounded-full bg-[#0c1014] px-3 py-1 font-body text-[11px] font-bold uppercase tracking-[0.1em] text-[#f4f4ef]">
                Legal
              </span>
              <span className="font-body text-[13px] text-[#0c1014]/35">
                {lastUpdated}
              </span>
            </motion.div>

            <motion.p
              variants={entrance}
              className="mt-6 max-w-2xl font-body text-[15px] leading-[1.7] text-[#0c1014]/50"
            >
              {subtitle}
            </motion.p>
          </div>
        </motion.div>

        {/* ── body: sidebar TOC + sections ── */}
        <div className="px-6 pt-10 pb-20 sm:px-10 sm:pt-14 lg:px-16">
          <div className="flex max-w-[1200px] gap-16 xl:gap-24">
            {/* sidebar — desktop only */}
            <aside className="hidden shrink-0 lg:block lg:w-52 xl:w-56">
              <nav className="sticky top-8">
                <p className="mb-4 font-body text-[11px] font-bold uppercase tracking-[0.12em] text-[#0c1014]/30">
                  Contents
                </p>
                <ol className="flex flex-col gap-0.5">
                  {sections.map((section, idx) => (
                    <li key={idx}>
                      <a
                        href={`#section-${idx}`}
                        onClick={(e) => {
                          e.preventDefault();
                          sectionRefs.current[idx]?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }}
                        className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 font-body text-[13px] leading-snug transition-all ${
                          activeSection === idx
                            ? "bg-[#0c1014]/[0.04] font-semibold text-[#0c1014]"
                            : "text-[#0c1014]/35 hover:text-[#0c1014]/65"
                        }`}
                      >
                        <span className="shrink-0 font-mono text-[11px] tabular-nums opacity-50">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className="truncate">{section.heading}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </aside>

            {/* main content */}
            <motion.main
              initial="hidden"
              animate="show"
              variants={{
                hidden: {},
                show: {
                  transition: { staggerChildren: 0.04, delayChildren: 0.25 },
                },
              }}
              className="min-w-0 flex-1"
            >
              {sections.map((section, idx) => (
                <motion.section
                  key={idx}
                  ref={(el) => {
                    sectionRefs.current[idx] = el;
                  }}
                  id={`section-${idx}`}
                  variants={entrance}
                  className="scroll-mt-8"
                >
                  {/* heading */}
                  <div className="flex items-baseline gap-3">
                    <span className="hidden font-mono text-[12px] tabular-nums text-[#0c1014]/15 sm:inline">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <h2 className="font-body text-[1.125rem] font-black tracking-[-0.015em] text-[#0c1014] sm:text-[1.25rem]">
                      {section.heading}
                    </h2>
                  </div>

                  {/* paragraphs */}
                  <div className="mt-3 flex flex-col gap-4 sm:ml-[30px]">
                    {section.body.map((para, pIdx) => (
                      <p
                        key={pIdx}
                        className="font-body text-[15px] leading-[1.8] text-[#0c1014]/55"
                      >
                        {para}
                      </p>
                    ))}
                  </div>

                  {/* divider */}
                  {idx < sections.length - 1 && (
                    <div className="my-10 h-px bg-[#0c1014]/6 sm:ml-[30px]" />
                  )}
                </motion.section>
              ))}

              {/* contact card */}
              <motion.div
                variants={entrance}
                className="mt-16 flex items-start justify-between gap-6 rounded-xl bg-[#0c1014] px-7 py-7 sm:items-center sm:px-9"
              >
                <div>
                  <p className="font-body text-[13px] font-medium text-[#f4f4ef]/40">
                    Have questions?
                  </p>
                  <p className="mt-0.5 font-body text-[15px] font-bold text-[#f4f4ef]">
                    Reach out at{" "}
                    <a
                      href={`mailto:${MAIL}`}
                      className="text-[#e6f5c0] underline-offset-2 hover:underline"
                    >
                      {MAIL}
                    </a>
                  </p>
                </div>
                <a
                  href={`mailto:${MAIL}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f4f4ef]/10 text-[#f4f4ef] transition-colors hover:bg-[#f4f4ef]/20"
                  aria-label="Send email"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4"
                  >
                    <path d="M5 12h14" />
                    <path d="m13 6 6 6-6 6" />
                  </svg>
                </a>
              </motion.div>
            </motion.main>
          </div>
        </div>

        {/* ── footer ── */}
        <footer className="border-t border-[#0c1014]/6 px-6 py-6 sm:px-10 lg:px-16">
          <div className="flex max-w-[1200px] flex-wrap items-center justify-between gap-4">
            <div className="flex gap-6">
              {menuLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={`font-body text-[12px] tracking-wide transition-colors hover:text-[#0c1014] ${
                    link.href === `/${activeLink}`
                      ? "font-bold text-[#0c1014]"
                      : "text-[#0c1014]/30"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <p className="font-body text-[12px] text-[#0c1014]/25">
              © {new Date().getFullYear()} 180 Degrees Consulting Sheffield
            </p>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}

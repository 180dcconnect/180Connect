"use client";

import { motion } from "motion/react";
import { MotionConfig } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { entranceSoft, stagger } from "@/components/brand/motion";
import { MAIL } from "@/components/brand/nav";
import { SiteChrome } from "@/components/brand/site-chrome";
import { GROUND } from "@/components/brand/tokens";
import { useAuthDialog } from "@/components/brand/use-auth-dialog";
import { Wordmark } from "@/components/brand/wordmark";

export type LegalSection = {
  heading: string;
  body: string[];
};

type LegalPageProps = {
  title: string;
  subtitle: string;
  lastUpdated?: string;
  sections: LegalSection[];
  /** Path of this page, so the menu sheet can mark it as current. */
  activeHref: string;
  showHomeLink?: boolean;
};

export default function LegalPage({
  title,
  subtitle,
  lastUpdated,
  sections,
  activeHref,
  showHomeLink = true,
}: LegalPageProps) {
  const [activeSection, setActiveSection] = useState(0);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  // Only for the chrome's pill — the chrome renders the dialog itself.
  const { openSignin } = useAuthDialog();

  /* Track active section for the sidebar TOC */
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    sectionRefs.current.forEach((el, idx) => {
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActiveSection(idx);
        },
        { rootMargin: "-20% 0px -60% 0px", threshold: 0 },
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach((obs) => obs.disconnect());
  }, [sections.length]);

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="relative min-h-screen"
        style={{ backgroundColor: GROUND }}
      >
        {/* ── top bar ── */}
        <header className="relative z-30 px-6 py-6 sm:px-10 sm:py-8">
          <Link href="/" aria-label="180Connect home">
            <Wordmark tone="dark" />
          </Link>
        </header>

        <SiteChrome activeHref={activeHref} onCtaClick={openSignin} />

        {/* ── hero strip ── */}
        <motion.div
          initial="hidden"
          animate="show"
          variants={stagger(0.08, 0.05)}
          className="border-b border-[#0c1014]/8 px-6 pb-12 sm:px-10 sm:pb-16 lg:px-16"
        >
          <div className="max-w-[1200px]">
            {showHomeLink && (
              <motion.div variants={entranceSoft} className="mb-8">
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
            )}

            <motion.h1
              variants={entranceSoft}
              className="font-body text-[clamp(2.75rem,6vw,5rem)] font-black leading-[0.95] tracking-[-0.035em] text-[#0c1014]"
            >
              {title}
            </motion.h1>

            {lastUpdated && (
              <motion.div
                variants={entranceSoft}
                className="mt-6 flex flex-wrap items-center gap-4"
              >
                <span className="rounded-full bg-[#0c1014] px-3 py-1 font-body text-[11px] font-bold uppercase tracking-[0.1em] text-[#f4f4ef]">
                  Legal
                </span>
                <span className="font-body text-[13px] text-[#0c1014]/35">
                  {lastUpdated}
                </span>
              </motion.div>
            )}

            <motion.p
              variants={entranceSoft}
              className="mt-6 max-w-2xl font-body text-[15px] leading-[1.7] text-[#0c1014]/50"
            >
              {subtitle}
            </motion.p>
          </div>
        </motion.div>

        {/* ── body: sidebar TOC + sections ── */}
        <div className="px-6 pt-10 pb-20 sm:px-10 sm:pt-14 lg:px-16">
          <div className="flex max-w-[1200px] gap-16 xl:gap-24">
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
                        <span className="shrink-0 font-body text-[13px] font-bold text-[#0c1014] tabular-nums">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className="truncate">{section.heading}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            </aside>

            <motion.main
              initial="hidden"
              animate="show"
              variants={stagger(0.04, 0.25)}
              className="min-w-0 flex-1"
            >
              {sections.map((section, idx) => (
                <motion.section
                  key={idx}
                  ref={(el) => {
                    sectionRefs.current[idx] = el;
                  }}
                  id={`section-${idx}`}
                  variants={entranceSoft}
                  className="scroll-mt-8"
                >
                  <div className="flex items-baseline gap-3.5">
                    <span className="hidden font-body text-2xl sm:text-3xl font-black text-[#0c1014] tabular-nums sm:inline">
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <h2 className="font-body text-2xl font-black tracking-[-0.02em] text-[#0c1014] sm:text-3xl">
                      {section.heading}
                    </h2>
                  </div>

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

                  {idx < sections.length - 1 && (
                    <div className="my-10 h-px bg-[#0c1014]/6 sm:ml-[30px]" />
                  )}
                </motion.section>
              ))}

              {/* contact card */}
              <motion.div
                variants={entranceSoft}
                className="mt-16 relative overflow-hidden rounded-2xl border border-[#0c1014]/10 bg-white/80 p-8 shadow-sm backdrop-blur-md sm:p-10"
              >
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <span className="font-body text-xs font-bold uppercase tracking-[0.12em] text-[#0c1014]/40">
                      Have questions?
                    </span>
                    <h3 className="mt-1 font-body text-2xl font-black tracking-[-0.02em] text-[#0c1014] sm:text-3xl">
                      Reach out to our team
                    </h3>
                    <p className="mt-1 font-body text-sm text-[#0c1014]/60">
                      We&rsquo;re here to help with any inquiries about our terms
                      or platform.
                    </p>
                  </div>
                  <a
                    href={`mailto:${MAIL}`}
                    className="inline-flex shrink-0 items-center justify-center gap-2.5 rounded-full bg-[#0c1014] px-6 py-3 font-body text-xs sm:text-sm font-bold text-[#f4f4ef] transition-all hover:bg-[#0c1014]/85 hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <span>{MAIL}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                    >
                      <path d="M5 12h14" />
                      <path d="m13 6 6 6-6 6" />
                    </svg>
                  </a>
                </div>
              </motion.div>
            </motion.main>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}

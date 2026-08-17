/**
 * Contents of the menu sheet, shared by every public page so the sheet is the
 * same sheet wherever it is opened from.
 */

export const MAIL = "sheffield@180dc.org";

export const menuLinks = [
  { label: "Home", href: "/" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy", href: "/privacy" },
  { label: "Changelog", href: "/changelog" },
  { label: "Cookies", href: "/cookies" },
] as const;

/**
 * Rendered from vertical sprite sheets rather than <svg> or the source GIFs —
 * see `.icon-sprite` in globals.css for why. The Linktree URL is stored bare:
 * the shared link carried utm_* and fbclid parameters from an Instagram bio
 * click, which have no business being hard-coded into our own site.
 */
export const socials = [
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

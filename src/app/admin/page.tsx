import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentActor } from "@/lib/auth/actor";
import { adminRouteDestination } from "@/lib/auth/admin-route";
import {
  Users,
  ScrollText,
  ArrowDownToLine,
  Building2,
  Landmark,
  HandCoins,
  ShieldAlert,
  Copy,
  ArrowRight,
} from "lucide-react";

/**
 * `/admin` is a hub of tiles, one per admin workspace that actually exists.
 *
 * It briefly became a straight redirect to `/admin/users`, because team
 * management was the only destination and three of the tiles pointed at
 * features that had not been built. F221 added the audit log, so there is a
 * real choice to make again and the hub earns its place.
 *
 * The rule that made the redirect necessary still stands: a tile for a feature
 * that does not exist is worse than no tile, because the user spends a click
 * finding out. Add a tile here only when its route exists — see the same
 * argument in `src/lib/nav.ts`.
 */

const SECTIONS = [
  {
    heading: "Team & Activity",
    description: "Manage users, roles, and review the audit trail.",
    cards: [
      {
        href: "/admin/users",
        icon: Users,
        title: "Team management",
        description: "Invite members, assign roles, and manage access across the platform.",
        accent: "bg-emerald-50 text-emerald-600",
      },
      {
        href: "/admin/audit-log",
        icon: ScrollText,
        title: "Audit log",
        description: "Every recorded admin action, with timestamps and actor details.",
        accent: "bg-amber-50 text-amber-600",
      },
      {
        href: "/admin/import-status",
        icon: ArrowDownToLine,
        title: "Import status",
        description: "Track the progress and health of active data import pipelines.",
        accent: "bg-sky-50 text-sky-600",
      },
    ],
  },
  {
    heading: "Data Ingestion",
    description: "Import and reconcile external data sources into the pipeline.",
    cards: [
      {
        href: "/admin/companies-house",
        icon: Building2,
        title: "Companies House",
        description: "Import UK company records, directors, and registration data.",
        accent: "bg-violet-50 text-violet-600",
      },
      {
        href: "/admin/charity-commission",
        icon: Landmark,
        title: "Charity Commission",
        description: "Bring UK charity registration and contact data into the pipeline.",
        accent: "bg-rose-50 text-rose-600",
      },
      {
        href: "/admin/three-sixty-giving",
        icon: HandCoins,
        title: "360Giving",
        description: "Attach grant and funding history to charities already in the pipeline.",
        accent: "bg-teal-50 text-teal-600",
      },
    ],
  },
  {
    heading: "Data Quality",
    description: "Review flagged records and manage suppressions.",
    cards: [
      {
        href: "/admin/duplicates",
        icon: Copy,
        title: "Possible duplicates",
        description: "Review charities the import pipeline flagged as likely duplicates.",
        accent: "bg-orange-50 text-orange-600",
      },
      {
        href: "/admin/suppressions",
        icon: ShieldAlert,
        title: "Suppressions",
        description: "Suppress a charity, or approve and reject a CAM's request.",
        accent: "bg-red-50 text-red-600",
      },
    ],
  },
] as const;

export default async function AdminPage() {
  const authorization = await getCurrentActor("user:manage", { route: "/admin" });
  if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));

  return (
    <main className="min-h-screen bg-[#f7f7f8]">
      {/* Header */}
      <div className="border-b border-black/[0.06] bg-white/80 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-10 sm:px-10">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand">
            Admin workspace
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-black sm:text-4xl">
            Platform management
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-foreground/55">
            Manage your team, import external data sources, and maintain data quality across the 180Connect platform.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl space-y-10 px-6 py-10 sm:px-10">
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <div className="mb-4">
              <h2 className="text-lg font-bold tracking-tight text-black">
                {section.heading}
              </h2>
              <p className="mt-0.5 text-sm text-foreground/50">
                {section.description}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.cards.map((card) => {
                const Icon = card.icon;
                return (
                  <Link
                    key={card.href}
                    href={card.href}
                    className="group relative flex flex-col rounded-2xl border border-black/[0.06] bg-white p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:border-black/[0.12] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:-translate-y-0.5"
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.accent} transition-transform duration-200 group-hover:scale-105`}
                    >
                      <Icon className="h-5 w-5" strokeWidth={1.75} />
                    </div>

                    <h3 className="mt-4 text-[15px] font-bold text-black">
                      {card.title}
                    </h3>
                    <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-foreground/55">
                      {card.description}
                    </p>

                    <div className="mt-4 flex items-center gap-1 text-xs font-bold text-brand opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0.5">
                      Open
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

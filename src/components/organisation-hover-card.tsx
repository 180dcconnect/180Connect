'use client';

import Link from 'next/link';
import { Building2, Mail, Globe, MapPin, User, Tag } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/animate-ui/components/radix/hover-card';
import { cn } from '@/lib/utils';
import { formatOutreachStatus } from '@/lib/organisation-format';

export type OrganisationPreview = {
  id: string;
  legalName: string;
  organisationType: string | null;
  sector: string | null;
  city: string | null;
  countryCode: string | null;
  outreachStatus: string;
  website: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
};

function formatLocation(city: string | null, countryCode: string | null): string {
  if (!city && !countryCode) return 'Unknown location';
  if (!city) return countryCode ?? 'Unknown location';
  if (!countryCode) return city;
  return `${city}, ${countryCode.toUpperCase()}`;
}

export function OrganisationHoverCard({
  org,
  className,
}: {
  org: OrganisationPreview;
  className?: string;
}) {
  const statusLabel = formatOutreachStatus(org.outreachStatus);
  const statusStyles: Record<string, string> = {
    not_contacted: 'bg-slate-100/70 text-slate-900 border-slate-200 dark:bg-slate-900/30 dark:text-slate-100 dark:border-slate-800',
    initial_outreach_sent: 'bg-sky-100/70 text-sky-900 border-sky-200 dark:bg-sky-900/30 dark:text-sky-100 dark:border-sky-800',
    outreach_sent: 'bg-blue-100/70 text-blue-900 border-blue-200 dark:bg-blue-900/30 dark:text-blue-100 dark:border-blue-800',
    call_scheduled: 'bg-violet-100/70 text-violet-900 border-violet-200 dark:bg-violet-900/30 dark:text-violet-100 dark:border-violet-800',
    meeting_booked: 'bg-purple-100/70 text-purple-900 border-purple-200 dark:bg-purple-900/30 dark:text-purple-100 dark:border-purple-800',
    proposal_sent: 'bg-amber-100/70 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800',
    negotiation: 'bg-orange-100/70 text-orange-900 border-orange-200 dark:bg-orange-900/30 dark:text-orange-100 dark:border-orange-800',
    converted: 'bg-emerald-100/70 text-emerald-900 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-100 dark:border-emerald-800',
    lost: 'bg-rose-100/70 text-rose-900 border-rose-200 dark:bg-rose-900/30 dark:text-rose-100 dark:border-rose-800',
    dormant: 'bg-zinc-100/70 text-zinc-900 border-zinc-200 dark:bg-zinc-900/30 dark:text-zinc-100 dark:border-zinc-800',
  };
  const statusStyle = statusStyles[org.outreachStatus] ?? 'bg-black/5 text-foreground/75 border-black/10';

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className="cursor-pointer">{org.legalName}</span>
      </HoverCardTrigger>
      <HoverCardContent side="right" sideOffset={8} align="start">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand/20 via-brand/10 to-transparent text-lg font-black text-brand-hover shadow-xs ring-1 ring-black/[0.08]">
              <Building2 className="h-7 w-7" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-foreground truncate">{org.legalName}</p>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusStyles[org.outreachStatus] ?? 'bg-black/5 text-foreground/75 border-black/10'}`}
              >
                {statusLabel}
              </span>
            </div>
          </div>

          <div className="border-t border-black/[0.06] pt-3 dark:border-white/[0.08] space-y-2.5">
            {org.ownerName && (
              <div className="flex items-center gap-2 text-sm text-foreground/60">
                <User className="h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">{org.ownerName}</span>{' '}
                  <span className="text-foreground/50">(Owner)</span>
                </span>
              </div>
            )}
            {org.sector && (
              <div className="flex items-center gap-2 text-sm text-foreground/60">
                <Tag className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{org.sector}</span>
              </div>
            )}
            {org.organisationType && (
              <div className="flex items-center gap-2 text-sm text-foreground/60">
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{org.organisationType}</span>
              </div>
            )}
            {(org.city || org.countryCode) && (
              <div className="flex items-center gap-2 text-sm text-foreground/60">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{formatLocation(org.city, org.countryCode)}</span>
              </div>
            )}
            {org.website && (
              <a
                href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-brand hover:underline"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate max-w-[200px]">{org.website}</span>
              </a>
            )}
            {org.ownerEmail && (
              <a
                href={`mailto:${org.ownerEmail}`}
                className="flex items-center gap-2 text-sm text-foreground/60 hover:text-brand"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate max-w-[200px]">{org.ownerEmail}</span>
              </a>
            )}
          </div>

          <Link
            href={`/clients/${org.id}`}
            className="group w-full flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-bold text-foreground transition-colors hover:border-black/20 hover:bg-black/[0.02] dark:border-white/[0.1] dark:bg-black/20 dark:hover:bg-white/[0.03]"
          >
            View organisation
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export default OrganisationHoverCard;
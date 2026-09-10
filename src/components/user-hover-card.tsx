'use client';

import Link from 'next/link';
import { Clock, Mail, Shield } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/animate-ui/components/radix/hover-card';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/display-format';
import type { ActorPreview } from '@/lib/recent-updates';

/**
 * The hover preview for a person's name in the dashboard feeds.
 *
 * NO AVATAR. There are no uploaded profile pictures on this platform, so the
 * only thing an avatar slot could show is generated initials — decoration that
 * repeats the name printed next to it, taking a quarter of the card to do it.
 *
 * NO OWNED-CLIENT COUNT either. It is a portfolio size, not something you act on
 * from a feed row, and it pushed the two facts that ARE useful — who this person
 * is allowed to be, and whether they are still around — into a cramped
 * two-column grid.
 *
 * What survives is what a reader of the feed actually wants: the name, the role
 * (can they approve things?), whether the account is still active, a way to mail
 * them, and the way through to the full profile.
 */

/*
 * Same single-definition rule as the organisation card: this is `ActorPreview`
 * from @/lib/recent-updates, aliased to the name the component has always used
 * rather than re-declared and left to drift out of sync with it.
 */
export type UserPreview = ActorPreview;
export type { ActorPreview };

const ROLE_LABEL: Record<UserPreview['role'], string> = {
  cam: 'CAM',
  admin: 'Admin',
  viewer: 'Viewer',
  leadership: 'Leadership',
};

const ROLE_STYLES: Record<UserPreview['role'], string> = {
  admin: 'bg-purple-100/70 text-purple-900 border-purple-200 dark:bg-purple-900/30 dark:text-purple-100 dark:border-purple-800',
  cam: 'bg-brand/10 text-brand-hover border-brand/20 dark:bg-brand/20 dark:text-brand dark:border-brand/30',
  viewer: 'bg-blue-100/70 text-blue-900 border-blue-200 dark:bg-blue-900/30 dark:text-blue-100 dark:border-blue-800',
  leadership: 'bg-amber-100/70 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:border-amber-800',
};

export function UserHoverCard({
  user,
  className,
  children,
  href,
}: {
  user: UserPreview;
  className?: string;
  children?: React.ReactNode;
  href?: string;
}) {
  const roleLabel = ROLE_LABEL[user.role] ?? user.role;
  const roleStyle = ROLE_STYLES[user.role] ?? 'bg-black/5 text-foreground/75 border-black/10';
  const lastActive = user.lastSeenAt
    ? formatRelativeTime(new Date(user.lastSeenAt), new Date())
    : 'Never signed in';

  const triggerContent = children ?? user.fullName ?? user.email;

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        {href ? (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className={cn('cursor-pointer', className)}
          >
            {triggerContent}
          </Link>
        ) : (
          <span className={cn('cursor-pointer', className)}>
            {triggerContent}
          </span>
        )}
      </HoverCardTrigger>
      <HoverCardContent side="right" sideOffset={8} align="start">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-base font-bold text-foreground">
                {user.fullName ?? 'Unnamed user'}
              </p>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${roleStyle}`}
              >
                <Shield className="h-2.5 w-2.5" />
                {roleLabel}
              </span>
              {/*
                The active/inactive state was previously only a coloured dot on
                the avatar, which went with it. It reads as a word instead — and
                only when it is the exceptional case, since "this account still
                works" is not news. A deactivated colleague still appears in the
                feed for work they did, and a reader chasing that work needs to
                know nobody is behind the name any more.
              */}
              {!user.isActive && (
                <span className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-100/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
                  Deactivated
                </span>
              )}
            </div>

            {/* A mailto rather than plain text: the email is on the card so it
                can be used, and copying it out by hand was the only option. */}
            {user.email ? (
              <a
                href={`mailto:${user.email}`}
                className="mt-1 flex items-center gap-2 text-sm text-foreground/60 transition-colors hover:text-brand"
              >
                <Mail className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{user.email}</span>
              </a>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-black/[0.06] pt-3 text-sm text-foreground/60 dark:border-white/[0.08]">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {/* The never-signed-in case is its own sentence — "Last signed in
                never signed in" is what prefixing it unconditionally produces. */}
            {user.lastSeenAt ? (
              <span>
                Last signed in <span className="font-medium text-foreground">{lastActive}</span>
              </span>
            ) : (
              <span className="font-medium text-foreground">Never signed in</span>
            )}
          </div>

          <Link
            href={`/team/${user.id}`}
            className="group w-full flex items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-bold text-foreground transition-colors hover:border-black/20 hover:bg-black/[0.02] dark:border-white/[0.1] dark:bg-black/20 dark:hover:bg-white/[0.03]"
          >
            View profile
            <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
              →
            </span>
          </Link>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export default UserHoverCard;
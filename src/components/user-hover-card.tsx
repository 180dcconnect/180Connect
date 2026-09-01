'use client';

import Link from 'next/link';
import { Clock, Mail, Shield } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/animate-ui/components/radix/hover-card';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/display-format';

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

export type UserPreview = {
  id: string;
  fullName: string | null;
  email: string;
  role: 'cam' | 'admin' | 'viewer' | 'leadership';
  ownedClientCount: number;
  lastSeenAt: string | null;
  isActive: boolean;
};

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
}: {
  user: UserPreview;
  className?: string;
}) {
  const initials = getInitials(user.fullName, user.email);
  const roleLabel = ROLE_LABEL[user.role] ?? user.role;
  const roleStyle = ROLE_STYLES[user.role] ?? 'bg-black/5 text-foreground/75 border-black/10';
  const now = new Date();
  const lastActive = user.lastSeenAt ? formatRelativeTime(new Date(user.lastSeenAt), now) : 'Never';

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <span className={cn('cursor-pointer', className)}>
          {user.fullName ?? user.email}
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="right" sideOffset={8} align="start">
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand/20 via-brand/10 to-transparent text-lg font-black text-brand-hover shadow-xs ring-1 ring-black/[0.08]">
              {initials}
              <span
                className={`absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white ${
                  user.isActive ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                title={user.isActive ? 'Active' : 'Inactive'}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-base font-bold text-foreground truncate">
                  {user.fullName ?? 'Unnamed user'}
                </p>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${roleStyle}`}
                >
                  <Shield className="h-2.5 w-2.5" />
                  {roleLabel}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-foreground/60 truncate">{user.email}</p>
            </div>
          </div>

          <div className="border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-foreground/60">
                <Users className="h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-medium text-foreground">{user.ownedClientCount}</span>{' '}
                  client{user.ownedClientCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-foreground/60">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{lastActive}</span>
              </div>
            </div>
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
# CAM Role Permission Matrix (F017)

The `public.users.role` database field is authoritative. It is read on every request,
so a role change takes effect without a new login.

| Capability                      | CAM | Admin | Viewer |
| ------------------------------- | :-: | :---: | :----: |
| View clients and shared history | Yes |  Yes  |  Yes   |
| Edit permitted client data      | Yes |  Yes  |   No   |
| Contact permitted clients       | Yes |  Yes  |   No   |
| Manage users and roles          | No  |  Yes  |   No   |
| Reassign ownership              | No  |  Yes  |   No   |
| Manage approvals                | No  |  Yes  |   No   |
| Manage platform settings        | No  |  Yes  |   No   |

UI visibility is a convenience only. Every privileged Server Action and route
handler must call `getCurrentActor()` with the relevant permission — this is
the same check that gates `/admin`, `/admin/users`, and `/admin/audit-log`
today (F016). Database tables must also enforce access with RLS. The
authoritative database-level matrix is `docs/rls-permission-matrix.md`.

## How an admin route refuses a CAM

All three admin pages run the same two lines, and nothing else stands between a
typed URL and the page:

```ts
const authorization = await getCurrentActor("user:manage", { route: "/admin" });
if (!authorization.ok) redirect(adminRouteDestination(authorization.reason));
```

`adminRouteDestination` (`src/lib/auth/admin-route.ts`) is the whole boundary,
which is why it is a pure function with its own tests rather than a branch
copied into each page. It splits two different situations that look alike:

- **`forbidden`** — a working session belonging to someone who simply is not an
  admin. They land on `/dashboard`, which reads `?error=admin-access-required`
  and tells them the page is restricted. A refusal the user cannot see is a bug.
- **anything else** (`unauthenticated`, `not_approved`, `inactive`,
  `profile_missing`) — the session itself is unusable. `/dashboard` refuses all
  four too, so these go straight to `/login` rather than through a redirect the
  user never sees.

Both the refusal and the denial log line carry the route, so
`permission.denied` records which screen was reached for, not just which
permission was missing.

## Default role

`public.users.role` defaults to `'cam'`
(`supabase/migrations/20260722103000_create_users.sql`), so a newly created
user is a CAM unless an admin explicitly promotes them via
`public.set_user_role`.

The invite flow (F008) now exercises this. `app.handle_new_auth_user()` inserts
only `(id, email, invited_by_user_id, invited_at)` when Supabase Auth creates
the invited user — it never names `role`, so the column default is what assigns
it. An invited person is therefore a CAM by construction, with no application
code choosing it, and an admin promoting them afterwards goes through the RPC.
`tests.suite_default_role` in `supabase/tests/rls_policies.test.sql` pins both
halves, because a change to that one default would otherwise turn every future
invitee into an administrator with nothing in the diff to notice.

## What a CAM can reach today

`/dashboard` is the only route a CAM can reach right now, and it deliberately
shows them nothing but their role and a plain sentence saying so. The dashboard
builds its links from `NAV_ITEMS` (`src/lib/nav.ts`), which lists only routes
that exist — a tile for an unbuilt feature costs the user a click to discover
it is not there, so the client database, client profiles, and email
generation/review/sending get no placeholder. They are not built for any role
yet and belong to their own tickets; when they ship they join `NAV_ITEMS` with
the permission they already enforce server-side, and this doc gains their real
per-table rules.

"Approvals" and "Team Pipeline View" have no routes and no tiles — `/admin`
lists only User management and Audit log, for the same reason the dashboard
lists only what exists. So `/admin`, `/admin/users` and `/admin/audit-log` are
the whole of what a CAM is blocked from today. When those two screens are
built they must carry the same two lines above: being nested under `/admin`
protects nothing on its own.

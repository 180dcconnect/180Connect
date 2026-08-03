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

## Default role

`public.users.role` defaults to `'cam'`
(`supabase/migrations/20260722103000_create_users.sql`), so a newly created
user is a CAM unless an admin explicitly promotes them via
`public.set_user_role`. There is no invite flow yet (F008 "Invite New CAM"
and F009 "Accept Invite" are both still open), so this default hasn't been
exercised in practice. Once that flow lands, it shouldn't need to set a role
explicitly — this default should just apply.

## What a CAM can reach today

Only `/dashboard` exists as a real, CAM-accessible route right now. It shows
placeholder cards (client database, client profiles, email
generation & review, and "my actions") reserved for CAM and Admin — these
are frontend stubs only, with no backing data or routes yet, and are hidden
from `viewer` accounts. The features themselves — the client database and
profile pages, and email generation/review/sending — aren't built yet, for
any role. They belong to their own tickets. Once they exist, this doc needs
updating to describe their real, per-table access rules (via
`hasPermission`/RLS), not the current placeholder gating.

"Approvals" and "Team Pipeline View" are likewise placeholder cards inside
`/admin`, not separate routes yet — there is nothing beyond `/admin` itself
for a CAM to be blocked from there today.

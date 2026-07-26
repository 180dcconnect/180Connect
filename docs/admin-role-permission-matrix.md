# Admin Role Permission Matrix (F016)

The `public.users.role` database field is authoritative. It is read on every request,
so assigning or removing Admin access takes effect without a new login.

| Capability | CAM | Admin | Viewer |
|---|:---:|:---:|:---:|
| View clients and shared history | Yes | Yes | Yes |
| Edit permitted client data | Yes | Yes | No |
| Contact permitted clients | Yes | Yes | No |
| Manage users and roles | No | Yes | No |
| Reassign ownership | No | Yes | No |
| Manage approvals | No | Yes | No |
| Manage platform settings | No | Yes | No |

UI visibility is a convenience only. Every privileged Server Action and route
handler must call `getCurrentActor()` with the relevant permission. Database
tables must also enforce access with RLS. The authoritative database-level matrix
is `docs/rls-permission-matrix.md`.

The shared `create_users` migration creates `public.users`; F016 does not create a
second user table. Role changes after bootstrap use the audited
`public.set_user_role` RPC.

Initial administrator bootstrap is an operational staging step. An authorised
database operator must promote the first approved user with:

```sql
update public.users
set role = 'admin'
where email = '<approved-admin-email>';
```

Record that operation in the deployment/change log. Subsequent role changes
must use the admin UI/API, which calls `public.set_user_role`.

Account activation and deactivation are intentionally display-only in F016. The
database reserves `is_active` for a future audited deactivation RPC (F011); the
Admin UI must not attempt a direct update.

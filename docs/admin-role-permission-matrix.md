# Admin Role Permission Matrix (F016)

The `USERS.role` database field is authoritative. It is read on every request,
so assigning or removing Admin access takes effect without a new login.

| Capability | CAM | Admin |
|---|:---:|:---:|
| View clients and shared history | Yes | Yes |
| Edit permitted client data | Yes | Yes |
| Contact permitted clients | Yes | Yes |
| Manage users and roles | No | Yes |
| Reassign ownership | No | Yes |
| Manage approvals | No | Yes |
| Manage platform settings | No | Yes |

UI visibility is a convenience only. Every privileged Server Action and route
handler must call `getCurrentActor()` with the relevant permission. Database
tables must also enforce access with RLS.

Initial administrator bootstrap is an operational deployment step: after this
migration is applied, an authorised database operator must promote the first
approved user with:

```sql
update public."USERS"
set role = 'admin', is_active = true, updated_at = now()
where email = '<approved-admin-email>';
```

Record that operation in the deployment/change log. Subsequent role changes
must use the admin UI/API.

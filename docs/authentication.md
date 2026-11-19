# Authentication and organization membership

Users sign up at `/signup` or sign in at `/login`. Signup creates a new organization, fixes its role as Consumer or Producer, and creates its first user. Email addresses are normalized to lowercase and unique. An existing email or normalized organization name cannot be claimed through signup. Names and emails are self-declared; this does not verify a company's legal ownership or control of its email domain.

The account page shows the current user and organization. Using a different account requires signing out and knowing that account's password. The former `/api/demo-session` route is removed, and its cookies are ignored even if correctly signed.

## Existing organizations

Migration `005_authentication.sql` preserves organizations, inventory, reservations and orders. It reserves their existing names and creates no default users or passwords. A trusted administrator with database access can create a user for an existing organization:

```powershell
npm run account:create -- --organization-id 1 --email owner@example.com --name "Organization Owner"
```

The command reads two hidden password entries from an interactive terminal. It does not accept a password argument, echo a password, alter the organization's role, or reset another user's password. Keep database access restricted to administrators. There is no public invitation or existing-organization join flow.

## Passwords and sessions

Passwords allow 15–128 Unicode characters, including spaces, with a 512-byte UTF-8 maximum. Signup rejects shorter passwords; login never trims or silently truncates them. Each password uses a random 16-byte salt and Node's asynchronous scrypt with `N=32768`, `r=8`, `p=3`, a 64-byte derived key, and a 64 MiB memory ceiling. These cost parameters follow one of [OWASP's recommended scrypt configurations](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Comparisons use `timingSafeEqual`; unknown emails still perform the password derivation before returning the same credential error. [Node crypto documentation](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)

Successful authentication generates a new random 32-byte opaque token. Only its SHA-256 digest is stored in MySQL. The `exchange_session` cookie is HttpOnly, SameSite=Lax, host-only, has Path=/, and uses Secure on HTTPS. A session expires after eight hours absolutely or thirty minutes of inactivity. Activity is refreshed at most once per minute. Disabled users cannot use existing sessions. Login rotates the current browser session; logout deletes it, so replaying its cookie fails. Other devices' independent sessions remain valid. This design follows the [OWASP session-management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

Every protected API resolves the user, organization, and role from the database. The caller's organization-ID header is only a stale-tab check, never a substitute for authentication. Supplier ownership and recipient visibility checks remain in force. A signed-in producer cannot reserve/order; a consumer cannot publish/edit/quote. A different user's organization cannot be selected in a body, query, header, or cookie.

## MySQL authorization

Migration `007_database_roles.sh` creates dedicated accounts and activates their roles by default. The app chooses the business connection pool from the authenticated organization's role. The worker has its own credentials. The Compose runtime services receive only the MySQL passwords they use.

| MySQL account | Permitted operations |
| --- | --- |
| `exchange_auth` | Read or register organizations and users, and manage sessions and rate limits |
| `exchange_producer` | Read marketplace data, publish or edit inventory, queue index events, and execute `record_supplier_quote` |
| `exchange_consumer` | Read marketplace data, reserve or place orders, update the index revision, queue events, and execute `confirm_recipient_order` |
| `exchange_worker` | Read batch snapshots and read or acknowledge outbox events |
| Configured `MYSQL_USER` | Schema administration, maintenance tests, and trusted account provisioning |

The producer and consumer roles share read grants on business tables. The API scopes reads and writes to the authenticated organization. MySQL column grants deny cross-role writes and separate authentication data from business connections. The quote and confirmation procedures also check the supplied organization against the order, its role, and the current order state. These are service accounts on one dedicated MySQL instance. The web app controls the tenant identity passed to the database.

Run `npm run test:database` against a development database to verify the effective roles and permission denials through direct SQL connections.

## Request controls

Authentication POSTs require JSON and a maximum 16 KiB body. Mutations reject mismatched Origin and cross-site fetch requests. Business writes also require the account-binding header. API JSON bodies have a bounded reader instead of buffering arbitrary payload sizes. Correct HTTPS and public-origin forwarding must be configured at the production reverse proxy; plain HTTP is for loopback development.

MySQL persists fixed-window login counters: ten attempts per normalized email and two hundred total per fifteen minutes, plus forty signup attempts per hour. A rejected request returns 429 and Retry-After. Both successful and failed attempts count. No untrusted forwarded IP headers are used. Multi-instance deployments share these database counters; an edge rate limit can provide additional traffic protection. Expired rate-limit counters are cleaned in bounded batches.

## API

| Endpoint | Request | Result |
| --- | --- | --- |
| `POST /api/auth/signup` | `{ fullName, email, password, companyName, role }` | `201 { user, organization }` and a new session cookie |
| `POST /api/auth/login` | `{ email, password }` | `200 { user, organization }` and a rotated session cookie |
| `GET /api/auth/session` | Cookie only | Current `{ user, organization }`, or both null |
| `POST /api/auth/logout` | `{}` | Revokes the cookie's session and clears cookies |
| `GET /api/suppliers` | Authenticated session | Marketplace supplier IDs and display names, with no user details |

Signup inserts organization, protected name, user, and session atomically. Duplicate-email or duplicate-name races roll back. No password or session hash is returned to a browser. The client broadcasts authentication changes across tabs and drops protected views on unauthorized responses. Password-manager autofill, paste, show/hide controls and normal keyboard operation remain available.

## Validation and remaining scope

Run `npm run test:auth` with the local app and MySQL running. It verifies password storage, cookie/session behavior, legacy-cookie rejection, signup conflicts and races, ownership and role isolation, cross-origin/body-size checks, login throttling, rotation, logout, expiry, and disabled users. `npm run test:integration` verifies the complete exchange with newly registered Consumer and Producer users. These checks create development accounts and retain their audit records.

Email verification, password recovery, MFA, organization invitations, and legal-company verification are not configured. No nonfunctional recovery link or claimed email-verification badge is shown in the interface. Add those services before relying on email ownership or company verification for business decisions.

# Permissions & Accounts

## Roles

Each account has one site-wide role:

| Role | Can |
|------|-----|
| **admin** | Do everything on every page, and open **Admin** |
| **editor** | Read and edit every unrestricted page, and create pages |
| **viewer** | Read only — even if a page ACL grants write |

Admins create accounts and assign roles in **Admin → Users**.

## Page permissions (ACL)

A page with no permissions set is open to everyone signed in (editors can edit, viewers can read). To restrict it, open **⋯ More actions → Manage permissions** and add users or groups with one of:

| Permission | Means |
|------------|-------|
| **Read** | Can view |
| **Write** | Can edit the content |
| **Manage** | Write, plus change this page's permissions, make it public, and move it somewhere with different permissions |

Rules:

- **Once a page has permissions, only the people listed can see it.** Anyone not listed (other than admins) can't see the page at all — it's absent from search, the page tree, the graph and AI chat
- **Sub-pages inherit from their parent.** A sub-page without its own permissions uses the nearest ancestor that has some; a sub-page with its own permissions uses those instead
- **When several entries match the same person, the most permissive wins.** Read as a user plus write via a group means write
- **Viewers are capped at read**; **admins bypass ACLs**
- On an unrestricted page, its creator manages it; inside a restricted area, only people explicitly granted Manage can change things

:::tip
A common setup is a top-level "HR" or "Finance" page with permissions set, and every related document created under it so they all inherit the same rules.
:::

Moving a page under a different parent can change the permissions it inherits, so it requires Manage.

## Groups

Admins create groups and add members in **Admin → Groups**, then grant a whole group access in one entry. Deleting a group also removes every permission entry that referenced it.

## Public pages

To share a page with someone who has no account:

1. Choose **Make public** under **⋯ More actions** (requires Manage)
2. Choose **Copy public link** — the URL looks like `/public/page/<slug>`

Public pages open in a clean read-only layout with no sign-in. Anonymous access is rate-limited to 60 requests per minute per IP. Choose **Make private** to take it back.

## Anonymous reading (whole site)

To let anyone read the whole wiki without signing in — public project docs, or a demo like this one — set `ANONYMOUS_READ=true` on the server. Signed-out visitors are treated as viewers:

- they can browse the page tree, search, the graph, recent changes, and every page without permissions set
- editing, comments, bookmarks, watching, AI chat and admin still require signing in

## Sign-in methods

| Method | Notes |
|--------|-------|
| Local accounts | Username and password, bcrypt-hashed; logins are rate-limited against brute force |
| OIDC SSO | Google, GitHub and any standard OIDC provider (Keycloak, Authentik, Okta, Auth0…), with PKCE |
| LDAP / AD | Binds to your directory, maps email and display name, can sync groups |

SSO is **invitation-only** by default: an admin pre-creates the account by email under **Admin → Users → Invite (SSO)**, and the SSO login is matched by email. You can instead let first logins create accounts, limited by an email allow-list, domains or groups. Configuration is in the [[en-admin|Admin Guide]].

## Your profile

Open **Profile** from the menu at the top right to:

- change your display name, email and bio (Markdown, wikilinks and @mentions work; it's shown on your public profile at `/u/<username>`)
- change your password — this signs out your other devices
- manage **API Tokens** (see the [[en-developer|Developer Guide]])

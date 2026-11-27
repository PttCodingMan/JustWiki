# Admin Guide

This page is for whoever runs JustWiki. Installation and deployment are covered in the [README on GitHub](https://github.com/PttCodingMan/JustWiki/blob/main/README.en.md); this covers day-to-day administration once it's up.

Admins reach the following from **Admin** in the sidebar.

## Site Settings

| Setting | Meaning |
|---------|---------|
| Site name | Shown top left and in the browser tab |
| Home page slug | The page `/` redirects to; empty shows the page list |
| Login title / subtitle | Text on the sign-in screen |
| Public footer text | Footer on anonymous public pages |
| Login session length | Days a sign-in stays valid (1–365); applies to new logins |
| Keep active users signed in | Extends the session on each visit |
| Max upload size | Per-file media limit (1–100 MB, default 20) |
| Minimum password length | Applied when creating users, resetting or changing passwords (8–128) |

Leave a field blank to restore the built-in default.

## Users

- **+ Add User** — create a local account with a role (admin / editor / viewer; see [[en-permissions|Permissions & Accounts]])
- **Invite (SSO)** — pre-create an account by email; it's matched when that person signs in with Google / GitHub / company SSO
- **Deactivate** — signs the user out and blocks sign-in; their pages and history stay, and they can be reactivated
- **Delete** — deleted accounts are listed under the "Deleted" tab
- Resetting a password or deactivating an account signs that user out everywhere

## Groups

Create groups and add members, then grant a whole group access in page permissions. With LDAP, `LDAP_SYNC_GROUPS=true` syncs groups from the directory.

## Templates

Add, edit and delete the site-wide page templates. Four ship by default: Meeting Notes, Tech Doc, Troubleshooting, ADR.

## Library

- **Images & Files** — every upload with its size and the pages that use it; copy a Markdown snippet to reuse it elsewhere
- **Diagrams** — every Draw.io diagram and where it's used
- Files marked **unused** are safe to delete; files still referenced by a page can't be deleted

## Webhooks

POST a JSON message to an external URL when pages change — Slack, Discord, automation tools and so on. Events you can subscribe to:

| Event | When |
|-------|------|
| `page.created` | A page is created |
| `page.updated` | A page is updated |
| `page.deleted` | A page is deleted |
| `page.review_due` | A page's review falls due |

Payload:

```json
{
  "event": "page.updated",
  "page": { "id": 12, "slug": "aB3xK9pQ", "title": "Release process", "version": 7, "updated_at": "..." },
  "actor": { "id": 3, "username": "alice" },
  "changes": { }
}
```

For safety, webhook URLs can't point at private-network or localhost addresses.

## Backup & Restore

**Back up from the web UI**: Admin → Backup & Restore → **Download Backup** gives you a `.zip` with the database and every media file.

**Restore from the web UI**: upload a backup `.zip`. This **replaces all current data**.

**Back up on the server**: everything lives in the `data/` directory (`just-wiki.db` plus `media/`); copying that directory is a complete backup. When running from source, `make backup` copies the database into `backup/` with a timestamp.

:::warning
JustWiki uses SQLite in WAL mode. When copying the database file on the server, stop the service first or copy `just-wiki.db-wal` along with it. **Download Backup** in the UI handles this for you.
:::

## Site export

**Export Static Site (.zip)** turns the whole wiki into a static HTML site you can unzip and read offline in a browser — good for archiving or handing over.

## Dashboard

**Dashboard** in the sidebar shows:

- storage: database, media and free disk space
- page and user counts
- the running version and whether a newer one exists (no outbound check by default; set `CHECK_UPDATES=true` in `.env` to query ghcr.io for the latest version)
- runtime and SQLite version

## Trash

Deleted pages are in **Trash**. The original author or an admin can restore them; only admins can delete permanently.

## Server settings reference

These live in the server's `.env` and take effect after a restart. The full annotated list is [.env.example](https://github.com/PttCodingMan/JustWiki/blob/main/.env.example).

**SSO (OIDC)**

| Variable | Meaning |
|----------|---------|
| `OIDC_ENABLED` | Turn SSO on |
| `OIDC_PROVIDERS` | Sign-in options to offer, e.g. `google,github,generic` |
| `OIDC_GOOGLE_CLIENT_ID` / `_SECRET` | Google OAuth client |
| `OIDC_GITHUB_CLIENT_ID` / `_SECRET` | GitHub OAuth App |
| `OIDC_GENERIC_NAME` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_DISCOVERY` | Any other OIDC provider (Keycloak, Authentik, Okta…) |
| `OIDC_ALLOW_SIGNUP` | Create accounts on first login (off by default: invited users only) |
| `OIDC_ALLOWED_EMAILS` / `OIDC_ALLOWED_EMAIL_DOMAINS` / `OIDC_REQUIRED_GROUPS` | Limit who can sign in |
| `OIDC_DEFAULT_ROLE` | Role for auto-created accounts, default `editor` |

Register `{public URL}/api/auth/oauth/{google|github|generic}/callback` as the redirect URI with your provider.

**LDAP / Active Directory**

| Variable | Meaning |
|----------|---------|
| `LDAP_ENABLED` | Turn LDAP sign-in on |
| `LDAP_SERVER` | Must be `ldaps://`; plain `ldap://` is refused |
| `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` | Service account used for lookups |
| `LDAP_USER_BASE` / `LDAP_USER_FILTER` | Where and how to find users |
| `LDAP_ATTR_EMAIL` / `LDAP_ATTR_DISPLAY_NAME` | Attribute mapping |
| `LDAP_SYNC_GROUPS` / `LDAP_GROUP_BASE` / `LDAP_GROUP_FILTER` | Group sync |
| `LDAP_ADMIN_GROUPS` | Members of these groups become admins |

:::info
With OIDC or LDAP enabled the site must be served over HTTPS (`COOKIE_SECURE=true` or an `https://` public URL), otherwise it refuses to start.
:::

AI chat settings are in [[en-ai|AI Chat]]; anonymous reading is in [[en-permissions|Permissions & Accounts]].

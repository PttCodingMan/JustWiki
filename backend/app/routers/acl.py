"""Page ACL management endpoints.

`GET /api/pages/{slug}/acl` returns the explicit ACL rows on a page plus
resolved inherited rows (with the source-page info so the UI can show
"inherited from X"). `PUT` replaces the explicit set atomically. `DELETE`
clears explicit rows, which reverts the page to inheriting from its
parent chain.

`GET /api/pages/{slug}/my-permission` returns the caller's effective
permission on a page and is used by the frontend permissions helper
when it needs a fresh resolution (the common page-view path just reads
`effective_permission` piggybacked on `GET /api/pages/{slug}`).

Note on user enumeration: `GET /api/users/search` lives in `users.py`
and is gated by `get_current_user` rather than `require_admin`, so any
authenticated user can search for username substrings to pick ACL
targets. Acceptable for a small-team wiki; flagged so reviewers don't
need to rediscover the trade-off.
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user
from app.database import get_db
from app.routers.activity import log_activity
from app.services.acl import invalidate_readable_cache, resolve_page_permission

router = APIRouter(prefix="/api/pages", tags=["acl"])


class AclRowInput(BaseModel):
    principal_type: Literal["user", "group"]
    principal_id: int
    permission: Literal["read", "write"]


class AclPutBody(BaseModel):
    rows: list[AclRowInput]


class AclRow(BaseModel):
    principal_type: str
    principal_id: int
    permission: str
    principal_name: Optional[str] = None


class AclInheritedRow(AclRow):
    source_page_id: int
    source_page_slug: str
    source_page_title: str


class AclResponse(BaseModel):
    explicit: list[AclRow]
    inherited: list[AclInheritedRow]


async def _get_page_row(db, slug: str) -> dict:
    rows = await db.execute_fetchall(
        "SELECT id, slug, title, parent_id FROM pages WHERE slug = ? AND deleted_at IS NULL",
        (slug,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Page not found")
    return dict(rows[0])


async def _principal_label(db, principal_type: str, principal_id: int) -> Optional[str]:
    if principal_type == "user":
        rows = await db.execute_fetchall(
            """SELECT CASE WHEN display_name IS NOT NULL AND display_name != ''
                        THEN display_name ELSE username END AS label
               FROM users WHERE id = ?""",
            (principal_id,),
        )
        return rows[0]["label"] if rows else None
    if principal_type == "group":
        rows = await db.execute_fetchall(
            "SELECT name FROM groups WHERE id = ?", (principal_id,)
        )
        return rows[0]["name"] if rows else None
    return None


@router.get("/{slug}/acl", response_model=AclResponse)
async def get_page_acl(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    page = await _get_page_row(db, slug)

    # Read-or-better is enough to view ACL. Management is gated separately
    # on PUT/DELETE so random viewers can see "why can I see this?" too.
    perm = await resolve_page_permission(db, user, page["id"])
    if perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")

    explicit_rows = await db.execute_fetchall(
        """SELECT principal_type, principal_id, permission
           FROM page_acl WHERE page_id = ?
           ORDER BY principal_type, principal_id""",
        (page["id"],),
    )
    explicit = []
    for r in explicit_rows:
        d = dict(r)
        d["principal_name"] = await _principal_label(
            db, d["principal_type"], d["principal_id"]
        )
        explicit.append(d)

    # Walk the parent chain to find inherited rows. Stop at the first
    # ancestor that has any ACL rows — that is the "anchor" the resolver
    # uses. Showing rows from deeper ancestors would be misleading because
    # those are shadowed and never affect the resolved permission.
    inherited: list[dict] = []
    ancestor_id = page["parent_id"]
    while ancestor_id is not None:
        anc_rows = await db.execute_fetchall(
            "SELECT id, slug, title, parent_id FROM pages WHERE id = ?",
            (ancestor_id,),
        )
        if not anc_rows:
            break
        anc = dict(anc_rows[0])
        acl_rows = await db.execute_fetchall(
            """SELECT principal_type, principal_id, permission
               FROM page_acl WHERE page_id = ?
               ORDER BY principal_type, principal_id""",
            (anc["id"],),
        )
        for r in acl_rows:
            d = dict(r)
            d["principal_name"] = await _principal_label(
                db, d["principal_type"], d["principal_id"]
            )
            d["source_page_id"] = anc["id"]
            d["source_page_slug"] = anc["slug"]
            d["source_page_title"] = anc["title"]
            inherited.append(d)
        if acl_rows:
            break  # anchor found — deeper ancestors are shadowed
        ancestor_id = anc["parent_id"]

    return {"explicit": explicit, "inherited": inherited}


async def _require_manage_permission(db, user, page_id: int):
    if user.get("role") == "admin":
        return
    perm = await resolve_page_permission(db, user, page_id)
    if perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    if perm in ("read",):
        raise HTTPException(
            status_code=403,
            detail="You do not have permission to manage this page's ACL",
        )


async def _validate_principal(db, principal_type: str, principal_id: int):
    if principal_type == "user":
        rows = await db.execute_fetchall(
            "SELECT id FROM users WHERE id = ?", (principal_id,)
        )
    else:
        rows = await db.execute_fetchall(
            "SELECT id FROM groups WHERE id = ?", (principal_id,)
        )
    if not rows:
        raise HTTPException(
            status_code=400,
            detail=f"{principal_type} {principal_id} does not exist",
        )


@router.put("/{slug}/acl", response_model=AclResponse)
async def put_page_acl(slug: str, body: AclPutBody, user=Depends(get_current_user)):
    if user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot manage ACLs")

    db = await get_db()
    page = await _get_page_row(db, slug)
    await _require_manage_permission(db, user, page["id"])

    # Validate all principals up front so a typo doesn't leave the page
    # half-configured.
    seen: set[tuple[str, int]] = set()
    for r in body.rows:
        key = (r.principal_type, r.principal_id)
        if key in seen:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate ACL row for {r.principal_type} {r.principal_id}",
            )
        seen.add(key)
        await _validate_principal(db, r.principal_type, r.principal_id)

    # Atomically replace.
    await db.execute("DELETE FROM page_acl WHERE page_id = ?", (page["id"],))
    for r in body.rows:
        await db.execute(
            """INSERT INTO page_acl (page_id, principal_type, principal_id, permission)
               VALUES (?, ?, ?, ?)""",
            (page["id"], r.principal_type, r.principal_id, r.permission),
        )
    await log_activity(
        db, user["id"], "acl_updated", "page", page["id"],
        {"slug": slug, "rows": [r.model_dump() for r in body.rows]},
    )
    await db.commit()
    invalidate_readable_cache()

    return await get_page_acl(slug=slug, user=user)


@router.delete("/{slug}/acl", response_model=AclResponse)
async def delete_page_acl(slug: str, user=Depends(get_current_user)):
    if user.get("role") == "viewer":
        raise HTTPException(status_code=403, detail="Viewers cannot manage ACLs")

    db = await get_db()
    page = await _get_page_row(db, slug)
    await _require_manage_permission(db, user, page["id"])

    await db.execute("DELETE FROM page_acl WHERE page_id = ?", (page["id"],))
    await log_activity(
        db, user["id"], "acl_cleared", "page", page["id"],
        {"slug": slug},
    )
    await db.commit()
    invalidate_readable_cache()

    return await get_page_acl(slug=slug, user=user)


@router.get("/{slug}/my-permission")
async def get_my_permission(slug: str, user=Depends(get_current_user)):
    db = await get_db()
    page = await _get_page_row(db, slug)
    perm = await resolve_page_permission(db, user, page["id"])
    if perm == "none":
        raise HTTPException(status_code=404, detail="Page not found")
    return {"permission": perm}

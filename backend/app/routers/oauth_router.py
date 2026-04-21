"""OIDC / OAuth login endpoints.

Three routes:
  * GET /api/auth/providers — list providers for the Login page.
  * GET /api/auth/oauth/{provider}/login — kick off the flow.
  * GET /api/auth/oauth/{provider}/callback — exchange code, issue JWT.

Errors always surface via `302 /login?error=<code>`; the Login page reads
the query string and renders a localized message.
"""
from __future__ import annotations

from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse

from app.auth import create_token
from app.config import settings
from app.services.oidc import (
    OAuthAccessError,
    exchange_and_resolve,
    get_oauth,
    list_enabled_providers,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _safe_redirect(raw: str | None) -> str:
    """Only accept same-origin paths. Otherwise send the user home.

    Mirrors the guard on the frontend Login page; kept here so a crafted
    state cookie can't shove `//evil.com` through the callback.
    """
    if not raw or not isinstance(raw, str):
        return "/"
    if not raw.startswith("/") or raw.startswith("//"):
        return "/"
    return raw


def _error_redirect(code: str, detail: str = "") -> RedirectResponse:
    qs = {"error": code}
    if detail:
        qs["detail"] = detail
    return RedirectResponse(f"/login?{urlencode(qs)}", status_code=303)


@router.get("/providers")
async def providers():
    return list_enabled_providers()


@router.get("/oauth/{provider}/login")
async def oauth_login(provider: str, request: Request, redirect: str = "/"):
    if not settings.OIDC_ENABLED:
        raise HTTPException(status_code=404, detail="OIDC is not enabled")

    oauth = get_oauth()
    client = oauth.create_client(provider)
    if client is None:
        raise HTTPException(status_code=404, detail="Unknown provider")

    # Session stores the post-login redirect so the callback can honour it
    # without having to thread it through the state param (authlib manages
    # state/nonce internally).
    request.session["oauth_redirect"] = _safe_redirect(redirect)

    redirect_uri = f"{settings.PUBLIC_BASE_URL.rstrip('/')}/api/auth/oauth/{provider}/callback"
    return await client.authorize_redirect(request, redirect_uri)


@router.get("/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request):
    if not settings.OIDC_ENABLED:
        raise HTTPException(status_code=404, detail="OIDC is not enabled")

    try:
        user = await exchange_and_resolve(provider, request)
    except OAuthAccessError as e:
        return _error_redirect(e.code, e.detail)

    token = create_token(user["id"], user["username"], user["role"])

    redirect_to = _safe_redirect(request.session.pop("oauth_redirect", "/"))
    response = RedirectResponse(redirect_to, status_code=303)
    response.set_cookie(
        key="token",
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        max_age=86400,
    )
    return response

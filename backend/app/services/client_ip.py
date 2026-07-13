"""Resolve the originating client IP for rate-limit buckets.

When JustWiki sits behind a reverse proxy, `request.client.host` is the
proxy's address — all real clients collapse into a single bucket and the
rate limiter either no-ops or denies everyone. Enabling TRUST_PROXY
tells us to read the client IP from `X-Forwarded-For` instead.

Critically, we take the entry `TRUST_PROXY_HOPS` from the RIGHT, not the
left. `X-Forwarded-For` is `client, proxy1, proxy2, …` and each hop only
appends the address it directly saw, so the trustworthy value is the one
your own proxy appended (rightmost). The left-most entries are supplied by
the client and can be forged — trusting them lets an attacker rotate a
fake IP per request to defeat the login/public rate limiters.

Only enable TRUST_PROXY when a trusted proxy is actually in front of the
app: otherwise anyone can spoof the header and dodge the limiter.
"""
from fastapi import Request

from app.config import settings


def client_ip(request: Request) -> str:
    if settings.TRUST_PROXY:
        fwd = request.headers.get("X-Forwarded-For", "")
        if fwd:
            chain = [p.strip() for p in fwd.split(",") if p.strip()]
            if chain:
                # Take the entry `hops` from the right: index -hops. The
                # rightmost is what our closest trusted proxy observed; going
                # further left crosses into client-controlled territory. Clamp
                # to the leftmost we actually have rather than over-trusting.
                hops = max(1, settings.TRUST_PROXY_HOPS)
                idx = max(0, len(chain) - hops)
                return chain[idx]
        real = request.headers.get("X-Real-IP")
        if real:
            return real.strip()
    if request.client:
        return request.client.host
    return "unknown"

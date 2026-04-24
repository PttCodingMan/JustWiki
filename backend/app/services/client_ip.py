"""Resolve the originating client IP for rate-limit buckets.

When JustWiki sits behind a reverse proxy, `request.client.host` is the
proxy's address — all real clients collapse into a single bucket and the
rate limiter either no-ops or denies everyone. Enabling TRUST_PROXY
tells us to read the left-most `X-Forwarded-For` entry instead.

Only enable TRUST_PROXY when a trusted proxy is actually in front of the
app: otherwise anyone can spoof the header and dodge the limiter.
"""
from fastapi import Request

from app.config import settings


def client_ip(request: Request) -> str:
    if settings.TRUST_PROXY:
        fwd = request.headers.get("X-Forwarded-For", "")
        if fwd:
            # X-Forwarded-For is a comma-separated chain. The left-most
            # entry is the original client; subsequent hops are proxies.
            first = fwd.split(",", 1)[0].strip()
            if first:
                return first
        real = request.headers.get("X-Real-IP")
        if real:
            return real.strip()
    if request.client:
        return request.client.host
    return "unknown"

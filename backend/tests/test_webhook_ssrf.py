"""Webhook SSRF guard regression tests.

An admin (or a compromised admin account) used to be able to point a
webhook at cloud IMDS, loopback, or RFC1918 addresses to exfiltrate
page metadata or pivot into internal services. `validate_webhook_url`
now rejects private/loopback/link-local hostnames at create/update
time and again at dispatch time.
"""
import pytest

from app.services.notifications import validate_webhook_url


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://localhost/hook",
        "http://10.0.0.5/x",
        "http://192.168.1.1/hook",
        "http://169.254.169.254/latest/meta-data/",  # AWS IMDS
        "http://[::1]/",                              # IPv6 loopback
        "http://[fe80::1]/",                          # IPv6 link-local
    ],
)
def test_rejects_private_hosts(url):
    with pytest.raises(ValueError):
        validate_webhook_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com/",
        "https://api.example.com/hooks/abc",
    ],
)
def test_accepts_public_hosts(url):
    # These resolve via DNS in CI; getaddrinfo failures are treated as
    # "not obviously private" so the validator should not raise here.
    validate_webhook_url(url)


def test_rejects_non_http_scheme():
    with pytest.raises(ValueError):
        validate_webhook_url("ftp://example.com/")
    with pytest.raises(ValueError):
        validate_webhook_url("file:///etc/passwd")


@pytest.mark.asyncio
async def test_create_webhook_rejects_loopback(admin_client):
    res = await admin_client.post(
        "/api/webhooks",
        json={"name": "bad", "url": "http://127.0.0.1/hook"},
    )
    assert res.status_code == 400

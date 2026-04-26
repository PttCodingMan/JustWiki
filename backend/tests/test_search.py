import sqlite3

import pytest

@pytest.mark.asyncio
async def test_search(auth_client):
    # Create page to search for
    await auth_client.post("/api/pages", json={
        "title": "Search Me",
        "content_md": "Find this hidden treasure",
        "slug": "search-me"
    })

    # Search by title
    response = await auth_client.get("/api/search", params={"q": "Search"})
    assert response.status_code == 200
    data = response.json()
    assert any(r["title"] == "Search Me" for r in data["results"])

    # Search by content
    response = await auth_client.get("/api/search", params={"q": "treasure"})
    assert response.status_code == 200
    data = response.json()
    assert any(r["slug"] == "search-me" for r in data["results"])

    # Search with tag
    await auth_client.post("/api/pages/search-me/tags", json={"name": "findme"})
    response = await auth_client.get("/api/search", params={"q": "Search", "tag": "findme"})
    assert response.status_code == 200
    data = response.json()
    assert any(r["slug"] == "search-me" for r in data["results"])

@pytest.mark.asyncio
async def test_search_no_results(auth_client):
    response = await auth_client.get("/api/search", params={"q": "nonexistentstuff"})
    assert response.status_code == 200
    assert response.json()["results"] == []


# ---------- CJK search (trigram tokenizer) ----------

_has_trigram = tuple(int(x) for x in sqlite3.sqlite_version.split(".")) >= (3, 43, 0)


@pytest.mark.asyncio
@pytest.mark.skipif(not _has_trigram, reason="SQLite < 3.43 — trigram not available")
async def test_search_cjk_chinese_phrase(auth_client):
    """Multi-character Chinese phrase should be found as a substring."""
    await auth_client.post("/api/pages", json={
        "title": "機器學習入門",
        "content_md": "本文介紹機器學習的基本概念與應用場景。",
        "slug": "ml-intro-zh",
    })

    # Partial phrase — should match via trigram substring
    resp = await auth_client.get("/api/search", params={"q": "機器學習"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "ml-intro-zh" for r in data["results"])

    # Shorter substring in content
    resp = await auth_client.get("/api/search", params={"q": "基本概念"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "ml-intro-zh" for r in data["results"])


@pytest.mark.asyncio
@pytest.mark.skipif(not _has_trigram, reason="SQLite < 3.43 — trigram not available")
async def test_search_cjk_japanese(auth_client):
    """Japanese text should be searchable via trigram."""
    await auth_client.post("/api/pages", json={
        "title": "プログラミング入門",
        "content_md": "この記事ではプログラミングの基礎を学びます。",
        "slug": "prog-intro-ja",
    })

    resp = await auth_client.get("/api/search", params={"q": "プログラミング"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "prog-intro-ja" for r in data["results"])


@pytest.mark.asyncio
@pytest.mark.skipif(not _has_trigram, reason="SQLite < 3.43 — trigram not available")
async def test_search_cjk_korean(auth_client):
    """Korean text should be searchable via trigram."""
    await auth_client.post("/api/pages", json={
        "title": "인공지능 개요",
        "content_md": "이 문서는 인공지능의 기본 개념을 다룹니다.",
        "slug": "ai-intro-ko",
    })

    resp = await auth_client.get("/api/search", params={"q": "인공지능"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "ai-intro-ko" for r in data["results"])


@pytest.mark.asyncio
@pytest.mark.skipif(not _has_trigram, reason="SQLite < 3.43 — trigram not available")
async def test_search_cjk_mixed_with_latin(auth_client):
    """Pages mixing CJK and Latin text should be found by either."""
    await auth_client.post("/api/pages", json={
        "title": "Python 深度學習",
        "content_md": "使用 TensorFlow 進行深度學習模型訓練。",
        "slug": "python-dl-zh",
    })

    # Search by CJK portion
    resp = await auth_client.get("/api/search", params={"q": "深度學習"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "python-dl-zh" for r in data["results"])

    # Search by Latin portion
    resp = await auth_client.get("/api/search", params={"q": "TensorFlow"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "python-dl-zh" for r in data["results"])


@pytest.mark.asyncio
async def test_search_short_query_like_fallback(auth_client):
    """Queries shorter than 3 chars should fall back to LIKE and still find results."""
    await auth_client.post("/api/pages", json={
        "title": "專案總覽",
        "content_md": "這是專案的總覽頁面。",
        "slug": "project-overview-zh",
    })

    # Single character
    resp = await auth_client.get("/api/search", params={"q": "專"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "project-overview-zh" for r in data["results"])

    # Two characters
    resp = await auth_client.get("/api/search", params={"q": "專案"})
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "project-overview-zh" for r in data["results"])


@pytest.mark.asyncio
async def test_search_like_escapes_wildcards(auth_client):
    """LIKE fallback must treat % and _ in user input literally, not as wildcards."""
    # The "hit" page has a literal "%" in its content; the "miss" page does not.
    await auth_client.post("/api/pages", json={
        "title": "折扣",
        "content_md": "全館 80% off 限時優惠",
        "slug": "sale-zh",
    })
    await auth_client.post("/api/pages", json={
        "title": "其他",
        "content_md": "沒有折扣標示",
        "slug": "no-sale-zh",
    })

    resp = await auth_client.get("/api/search", params={"q": "80%"})
    assert resp.status_code == 200
    data = resp.json()
    slugs = {r["slug"] for r in data["results"]}
    assert "sale-zh" in slugs
    # If "%" were treated as a wildcard, "no-sale-zh" would also match — it must not.
    assert "no-sale-zh" not in slugs


@pytest.mark.asyncio
@pytest.mark.skipif(not _has_trigram, reason="SQLite < 3.43 — trigram not available")
async def test_search_cjk_natural_language_question(auth_client):
    """A CJK question whose keywords appear in the page (but the question
    itself is not a substring of the page) must still find that page.

    This is the regression for the AI chat bug where '志工相關的頁面在哪'
    found nothing despite a page containing '志工'.
    """
    await auth_client.post("/api/pages", json={
        "title": "志工名單",
        "content_md": "本頁列出本社所有志工的聯絡方式。",
        "slug": "volunteer-list-zh",
    })

    # Long natural-language question — the question itself is NOT a
    # substring of the page, so naïve FTS phrase matching would miss.
    resp = await auth_client.get(
        "/api/search", params={"q": "志工相關的頁面在哪"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert any(r["slug"] == "volunteer-list-zh" for r in data["results"])


@pytest.mark.asyncio
async def test_search_or_semantics_in_like_fallback(auth_client):
    """Multi-word short queries should match pages containing ANY term (OR), not all."""
    await auth_client.post("/api/pages", json={
        "title": "alpha only",
        "content_md": "ab content",  # <3 char words → LIKE fallback
        "slug": "alpha-only",
    })
    await auth_client.post("/api/pages", json={
        "title": "beta only",
        "content_md": "cd content",
        "slug": "beta-only",
    })

    resp = await auth_client.get("/api/search", params={"q": "ab cd"})
    assert resp.status_code == 200
    data = resp.json()
    slugs = {r["slug"] for r in data["results"]}
    # OR semantics: both pages should appear even though neither contains both terms.
    assert "alpha-only" in slugs
    assert "beta-only" in slugs

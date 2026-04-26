"""Unit tests for app.services.search query builders.

These keep the retrieval contract honest at the function level, independent
of the SQLite layer. The integration tests in test_search.py and test_ai.py
verify end-to-end behavior.
"""

from app.services.search import build_fts_query, build_like_words


# ── build_fts_query ────────────────────────────────────────────────────────


def test_fts_query_cjk_runs_become_overlapping_trigrams():
    # "機器學習" → trigrams 機器學, 器學習
    q = build_fts_query("機器學習")
    assert q == '"機器學" OR "器學習"'


def test_fts_query_natural_language_cjk_question():
    # "志工相關的頁面在哪" → 7 overlapping trigrams.
    # Doing it as one phrase used to require the whole string as a substring
    # of a page; trigram-OR matches any page sharing any 3-char window.
    q = build_fts_query("志工相關的頁面在哪")
    expected = (
        '"志工相" OR "工相關" OR "相關的" OR "關的頁" '
        'OR "的頁面" OR "頁面在" OR "面在哪"'
    )
    assert q == expected


def test_fts_query_short_cjk_run_returns_none():
    # "志工" is 2 chars — below trigram threshold. Returns None so the
    # router knows to skip FTS entirely and use LIKE.
    assert build_fts_query("志工") is None
    assert build_fts_query("專") is None


def test_fts_query_ascii_word_kept_as_phrase():
    assert build_fts_query("TensorFlow") == '"TensorFlow"'


def test_fts_query_ascii_short_word_dropped():
    # "ab" and "cd" are both <3 chars → no FTS terms.
    assert build_fts_query("ab cd") is None


def test_fts_query_mixed_cjk_and_ascii():
    q = build_fts_query("Python 深度學習")
    assert q is not None
    assert '"Python"' in q
    assert '"深度學"' in q
    assert '"度學習"' in q


def test_fts_query_deduplicates_repeated_trigrams():
    # "深度深度" produces trigrams 深度深, 度深度, 深度深 → dedup to 2 unique.
    q = build_fts_query("深度深度")
    assert q == '"深度深" OR "度深度"'


def test_fts_query_escapes_embedded_double_quote():
    # Phrase quoting needs the FTS5 doubling escape so user input can't
    # break out of the phrase or inject syntax.
    q = build_fts_query('say "hi" loudly')
    assert q is not None
    assert '"""' not in q  # no unescaped quote
    assert '"say"' in q
    assert '"loudly"' in q


def test_fts_query_empty_or_punctuation_only():
    assert build_fts_query("") is None
    assert build_fts_query("   ") is None
    assert build_fts_query("???") is None


# ── build_like_words ───────────────────────────────────────────────────────


def test_like_words_preserves_original_tokens_with_punctuation():
    # The router escapes % for LIKE — keeping "80%" intact lets the literal
    # match stay literal instead of becoming a wildcard.
    words = build_like_words("80% off")
    assert "80%" in words
    assert "off" in words


def test_like_words_includes_cjk_bigrams():
    # The whole point of this helper: even though FTS missed, the LIKE
    # fallback can match "志工" as a substring inside a longer page.
    words = build_like_words("志工相關的頁面在哪")
    assert "志工" in words
    assert "相關" in words
    assert "頁面" in words


def test_like_words_single_cjk_char_kept():
    assert "專" in build_like_words("專")


def test_like_words_dedupes():
    # Same token across whitespace tokens and bigrams shouldn't repeat.
    words = build_like_words("志工 志工")
    assert words.count("志工") == 1


def test_like_words_empty_input():
    assert build_like_words("") == []
    assert build_like_words("   ") == []

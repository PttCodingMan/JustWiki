"""Markdown / Obsidian / HackMD import: converter unit tests + API tests."""
import base64
import io
import itertools
import zipfile

import pytest

from app.config import settings
from app.routers.media import ALLOWED_TYPES
from app.services.md_import import (
    ASSET_TYPES,
    ImportFailed,
    ImportSource,
    convert,
)

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)


def make_zip(files: dict[str, bytes | str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in files.items():
            zf.writestr(name, data.encode() if isinstance(data, str) else data)
    return buf.getvalue()


def run(files, flavor="auto", filename="import.zip", max_asset_bytes=10 * 1024 * 1024):
    counter = itertools.count()
    content = make_zip(files) if filename.endswith(".zip") else files
    src = ImportSource.from_upload(filename, content)
    return convert(
        src, flavor,
        new_slug=lambda: f"s{next(counter):07d}",
        max_asset_bytes=max_asset_bytes,
    )


def by_title(result):
    return {p.title: p for p in result.pages}


# ── Converter: Obsidian ─────────────────────────────────────────────────────


OBSIDIAN_VAULT = {
    "My Vault/.obsidian/app.json": "{}",
    "My Vault/.trash/Old.md": "deleted note",
    "My Vault/Home.md": (
        "---\ntags: [start, docs]\naliases: [Start]\n---\n"
        "Welcome #inbox and #2024 (number-only is not a tag).\n"
        "See [[Alpha|the alpha]], [[Beta#Setup]], [[Projects/Alpha]], [[Missing Page]].\n"
        "Embed ![[diagram.png|300]] and note ![[Beta]] and file [[report.pdf]].\n"
        "Heading link [[#Local]].\n"
        "%%secret\ncomment%% visible ^block1\n"
        "`[[inline code]]` stays.\n\n"
        "```\n[[fenced]] #notatag\n```\n\n"
        "| a | b |\n|---|---|\n| [[Beta\\|B]] | x |\n"
    ),
    "My Vault/Projects/Alpha.md": "Back to [[Start]].",
    "My Vault/Notes/Beta.md": "## Setup\n> [!warning] Careful\n> line one\n> line two\n\nafter",
    "My Vault/attachments/diagram.png": PNG,
    "My Vault/report.pdf": b"%PDF-1.4\n%fake",
}


def test_obsidian_vault_autodetected_and_structure():
    r = run(OBSIDIAN_VAULT)
    assert r.flavor == "obsidian"
    pages = by_title(r)
    # Wrapper dir stripped, hidden dirs skipped, asset-only dir makes no page.
    assert set(pages) == {"Home", "Alpha", "Beta", "Projects", "Notes"}
    assert pages["Alpha"].parent_key == pages["Projects"].key
    assert pages["Home"].parent_key is None
    # Parents are emitted before children.
    order = [p.key for p in r.pages]
    assert order.index(pages["Projects"].key) < order.index(pages["Alpha"].key)


def test_obsidian_links_embeds_and_syntax():
    r = run(OBSIDIAN_VAULT)
    pages = by_title(r)
    home = pages["Home"].content_md
    alpha, beta = pages["Alpha"].slug, pages["Beta"].slug
    assert f"[[{alpha}|the alpha]]" in home
    assert f"[[{beta}|Beta > Setup]]" in home
    assert f"[[{alpha}|Projects/Alpha]]" in home
    assert "Missing Page" in home and "[[Missing Page" not in home
    assert f"![[{beta}|Beta]]" in home  # note embed → transclusion
    media = {m.original_name: m for m in r.media}
    assert set(media) == {"diagram.png", "report.pdf"}
    assert f"![diagram.png](/api/media/{media['diagram.png'].filename})" in home
    assert f"[report.pdf](/api/media/{media['report.pdf'].filename})" in home
    assert "Heading link Local." in home
    assert "secret" not in home and "^block1" not in home
    assert "`[[inline code]]`" in home
    assert "```\n[[fenced]] #notatag\n```" in home
    assert f"| [[{beta}\\|B]] | x |" in home
    # Alias resolution: [[Start]] → Home.
    assert f"[[{pages['Home'].slug}|Start]]" in pages["Alpha"].content_md
    # Tags from frontmatter + inline, not from code or number-only.
    assert pages["Home"].tags == ["start", "docs", "inbox"]
    # Only title/tags/aliases in frontmatter → nothing preserved.
    assert "```yaml" not in home


def test_obsidian_callout():
    beta = by_title(run(OBSIDIAN_VAULT))["Beta"].content_md
    # Markers are separate paragraphs (editor-compatible); Obsidian soft
    # breaks become hard breaks.
    assert beta == "## Setup\n\n:::warning\n\n**Careful**\n\nline one  \nline two\n\n:::\n\nafter\n"


def test_unresolved_links_reported():
    r = run(OBSIDIAN_VAULT)
    assert any("Missing Page" in w["message"] for w in r.warnings)


# ── Converter: generic Markdown ─────────────────────────────────────────────


def test_markdown_folder_links_and_folder_notes():
    r = run({
        "docs/README.md": "# Documentation\nStart at [guide](guide/Getting%20Started.md#install).",
        "docs/guide/index.md": "# The Guide\nSee [ref][r] and [up](../README.md).\n\n[r]: ../api/ref.md",
        "docs/guide/Getting Started.md": (
            "---\ntitle: Getting started\nauthor: someone\n---\n"
            "![shot](./img/shot.png) <img src=\"img/shot.png\" alt=\"again\" width=10>\n"
            "[[Getting Started]] [gone](nope.md) [ext](https://example.com/a.md) [top](#x)\n"
            "[![badge](img/shot.png)](../api/ref.md)\n"
            ":::note Heads up\nbody\n:::\n"
        ),
        "docs/guide/img/shot.png": PNG,
        "docs/api/ref.md": "API",
    })
    assert r.flavor == "markdown"
    pages = by_title(r)
    # Root README keeps its H1 as title; guide/index.md becomes the guide folder page.
    assert {"Documentation", "The Guide", "Getting started", "api", "ref"} <= set(pages)
    assert "guide" not in pages
    gs = pages["Getting started"]
    assert gs.parent_key == pages["The Guide"].key
    assert pages["Documentation"].content_md.startswith(f"Start at [[{gs.slug}|guide]]")
    guide = pages["The Guide"].content_md
    assert f"[r]: /page/{pages['ref'].slug}" in guide
    assert f"[[{pages['Documentation'].slug}|up]]" in guide
    body = gs.content_md
    # Unknown frontmatter keys are kept visible.
    assert body.startswith("```yaml\ntitle: Getting started\nauthor: someone\n```")
    assert len(r.media) == 1  # same file referenced twice → one media row
    url = f"/api/media/{r.media[0].filename}"
    assert f"![shot]({url}) ![again]({url})" in body
    assert f"[[{gs.slug}|Getting Started]]" in body
    assert "gone [ext](https://example.com/a.md) [top](#x)" in body
    assert f"[![badge]({url})](/page/{pages['ref'].slug})" in body
    assert ":::info\n\n**Heads up**\n\nbody\n\n:::" in body
    assert any("nope.md" in w["message"] for w in r.warnings)
    # No Obsidian-only processing in plain markdown mode.
    assert gs.tags == []


def test_inline_tags_only_for_obsidian():
    r = run({"a.md": "hello #world"}, flavor="markdown")
    assert r.pages[0].tags == []
    r = run({"a.md": "hello #world"}, flavor="obsidian")
    assert r.pages[0].tags == ["world"]


# ── Converter: HackMD ───────────────────────────────────────────────────────


def test_hackmd_single_note():
    note = (
        "# Meeting Notes\n\n"
        "###### tags: `meeting` `2026`\n\n"
        "[TOC]\n\n"
        ":::success\nDone!\n:::\n\n"
        ":::spoiler Click me\nhidden\n:::\n\n"
        "{%youtube dQw4w9WgXcQ %}\n"
        "![](https://i.imgur.com/x.png)\n"
    )
    r = run(note.encode(), flavor="hackmd", filename="note.md")
    assert len(r.pages) == 1
    p = r.pages[0]
    assert p.title == "Meeting Notes"
    assert p.tags == ["meeting", "2026"]
    c = p.content_md
    assert "# Meeting Notes" not in c and "tags:" not in c and "[TOC]" not in c
    assert ":::tip\n\nDone!\n\n:::" in c
    assert ":::info\n\n**Click me**\n\nhidden\n\n:::" in c
    assert "(https://www.youtube.com/watch?v=dQw4w9WgXcQ)" in c
    assert "![](https://i.imgur.com/x.png)" in c


# ── Converter: safety + edge cases ──────────────────────────────────────────


def test_asset_types_are_subset_of_upload_allowlist():
    assert {mime for mime, _ in ASSET_TYPES.values()} <= ALLOWED_TYPES


def test_rejected_and_unsupported_attachments():
    evil_svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    r = run({
        "a.md": "![](evil.svg) ![[clip.mp4]] ![](fake.png) ![](big.png)",
        "evil.svg": evil_svg,
        "clip.mp4": b"\x00\x00\x00\x18ftypmp42",
        "fake.png": b"%PDF-1.4 not a png",
        "big.png": PNG + b"\x00" * 200,
    }, max_asset_bytes=100)
    assert r.media == []
    assert "/api/media/" not in r.pages[0].content_md
    msgs = " ".join(w["message"] for w in r.warnings)
    assert "SVG" in msgs and "not supported" in msgs and "do not match" in msgs and "size limit" in msgs


def test_zip_path_traversal_and_hidden_entries_ignored():
    r = run({
        "../escape.md": "x",
        "/abs.md": "x",
        ".git/config.md": "x",
        "__MACOSX/a.md": "x",
        "ok.md": "fine",
    })
    assert [p.title for p in r.pages] == ["ok"]


def test_nothing_to_import():
    with pytest.raises(ImportFailed):
        run({"image.png": PNG})
    with pytest.raises(ImportFailed):
        ImportSource.from_upload("x.zip", b"not a zip")
    with pytest.raises(ImportFailed):
        ImportSource.from_upload("x.docx", b"whatever")


def test_natural_sort_order():
    r = run({"2 b.md": "", "10 c.md": "", "1 a.md": ""})
    assert [p.title for p in sorted(r.pages, key=lambda p: p.sort_order)] == ["1 a", "2 b", "10 c"]


def test_soft_line_breaks_follow_source_semantics():
    note = "line one\nline two\n\n- item\n- item 2\n\n> q1\n> q2\n\n| a |\n|---|\n| b |\n# H\ntext"
    obs = run({".obsidian/app.json": "{}", "n.md": note}).pages[0].content_md
    assert "line one  \nline two\n" in obs
    assert "- item\n- item 2" in obs  # list items are separate blocks already
    assert "> q1  \n> q2" in obs
    assert "| a |\n|---|\n| b |\n# H\ntext" in obs
    strict = run({".obsidian/app.json": '{"strictLineBreaks": true}', "n.md": note}).pages[0].content_md
    assert "line one\nline two" in strict
    plain = run({"n.md": note}, flavor="markdown").pages[0].content_md
    assert "line one\nline two" in plain
    hackmd_off = run(b"---\nbreaks: false\n---\na\nb", flavor="hackmd", filename="n.md")
    assert hackmd_off.pages[0].content_md == "a\nb\n"


def test_callout_with_code_and_container_spanning_fence():
    r = run({
        "a.md": "> [!tip] Run\n> ```sh\n> echo [[x]]\n> ```\n\n:::info\n```\n:::not a close\n```\n:::\n",
    }, flavor="obsidian")
    c = r.pages[0].content_md
    assert ":::tip\n\n**Run**\n\n```sh\necho [[x]]\n```\n\n:::" in c
    assert ":::info\n\n```\n:::not a close\n```\n\n:::\n" in c
    assert not r.warnings  # [[x]] inside code is not treated as a link


def test_markdown_titles_come_from_h1_obsidian_from_filename():
    files = {"README.en.md": "# Project\nhi", "getting-started.md": "# Getting Started\nx", "n.md": "no heading"}
    md = {p.title for p in run(files, flavor="markdown").pages}
    assert md == {"Project", "Getting Started", "n"}
    obs = {p.title for p in run(files, flavor="obsidian").pages}
    assert obs == {"Project", "getting-started", "n"}


def test_html_is_translated_to_markdown():
    readme = (
        '<p align="center">\n'
        '  <img src="docs/logo.png" alt="Logo" width="480">\n'
        '</p>\n\n'
        '<!-- markdownlint-disable -->\n'
        '# Project\n\n'
        '<p align="center"> <strong>English</strong> · <a href="README.zh.md">中文</a> · '
        '<a href="https://example.com">site</a> </p>\n\n'
        '<details>\n<summary>More</summary>\n\nhidden <em>text</em> and <kbd>Ctrl</kbd>\n</details>\n\n'
        '<table><tr><td>x</td></tr></table>\n\n'
        '```html\n<p>kept in code</p>\n```\n'
    )
    r = run({"README.md": readme, "README.zh.md": "# 專案", "docs/logo.png": PNG}, flavor="markdown")
    pages = by_title(r)
    assert set(pages) == {"Project", "專案"}  # image-only folder makes no page
    c = pages["Project"].content_md
    url = f"/api/media/{r.media[0].filename}"
    assert c.startswith(f"![Logo]({url})\n\n")  # wrapper gone, no indent → no code block
    assert "<!--" not in c and "# Project" not in c  # comment dropped; H1 after HTML became the title
    assert f"**English** · [[{pages['專案'].slug}|中文]] · [site](https://example.com)" in c
    assert "**More**" in c and "hidden *text* and `Ctrl`" in c
    assert "<details>" not in c and "<summary>" not in c
    assert "```html\n<p>kept in code</p>\n```" in c
    assert any("<table>" in w["message"] and "<td>" in w["message"] for w in r.warnings)


def test_leading_rule_is_not_frontmatter():
    r = run({"a.md": "---\nJust a rule, then text.\n---\nmore"})
    assert "Just a rule, then text." in r.pages[0].content_md


def test_footnotes_and_folder_links():
    r = run({
        "a.md": "Text[^1] see [the api](api/) and [x](api).\n\n[^1]: A footnote.",
        "api/ref.md": "x",
    })
    pages = by_title(r)
    api = pages["api"].slug
    c = pages["a"].content_md
    assert f"[[{api}|the api]]" in c and f"[[{api}|x]]" in c
    assert "[^1]: A footnote." in c
    assert r.warnings == []


def test_nfd_and_non_flagged_utf8_filenames():
    import unicodedata
    nfd = unicodedata.normalize("NFD", "한글 노트.md")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(nfd, "x")  # NFD name, as a macOS archive stores it
        info = zipfile.ZipInfo("リンク.md")
        zf.writestr(info, "[[한글 노트]] and [[ガイド]]")
        zf.writestr("ガイド.md", "guide")
    data = bytearray(buf.getvalue())
    # Clear the UTF-8 flag on every entry (local + central headers), as some
    # tools do while still writing UTF-8 names.
    for sig, off in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        i = data.find(sig)
        while i != -1:
            flags = int.from_bytes(data[i + off:i + off + 2], "little") & ~0x800
            data[i + off:i + off + 2] = flags.to_bytes(2, "little")
            i = data.find(sig, i + 4)
    src = ImportSource.from_upload("cjk.zip", bytes(data))
    counter = itertools.count()
    r = convert(src, "obsidian", new_slug=lambda: f"s{next(counter):07d}", max_asset_bytes=1024)
    pages = by_title(r)
    assert set(pages) == {"한글 노트", "リンク", "ガイド"}
    assert r.warnings == []
    c = pages["リンク"].content_md
    assert f"[[{pages['한글 노트'].slug}|한글 노트]]" in c and f"[[{pages['ガイド'].slug}|ガイド]]" in c


# ── Converter: Wiki.js ──────────────────────────────────────────────────────


def wikijs_file(title, content, *, html=False, tags="", description="", published="true"):
    """Byte-for-byte what Wiki.js 2.5 writes (server/helpers/page.js
    injectPageMetadata) for its disk / git storage targets."""
    meta = [
        ("title", title),
        ("description", description),
        ("published", published),
        ("date", "2024-03-01T10:20:30.123Z"),
        ("tags", tags),
        ("editor", "ckeditor" if html else "markdown"),
        ("dateCreated", "2023-12-24T08:00:00.000Z"),
    ]
    block = "\n".join(f"{k}: {v}" for k, v in meta)
    if html:
        return "<!--\n" + block + "\n-->\n\n" + content
    return "---\n" + block + "\n---\n\n" + content


SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
SVG_FOREIGN = b'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>x</div></foreignObject></svg>'

WIKIJS_DUMP = {
    "home.md": wikijs_file("Welcome", (
        "# Welcome\n\n"
        "Start with the [guide](/guide) or [setup](/en/guide/setup) and [docs](guide/setup).\n"
        "Tagged [stuff](/t/howto), unknown [x](/nowhere), image ![Logo](/uploads/logo.png =200x){.align-center}\n\n"
        "> Read this first\n> twice\n{.is-warning}\n\n"
        "- [Guide](/guide)\n- [中文](/zh/guide)\n{.links-list}\n\n"
        "# Tabs {.tabset}\n## One\ncontent\n\n"
        "```diagram\n" + base64.b64encode(SVG).decode() + "\n```\n\n"
        "```diagram\n" + base64.b64encode(SVG_FOREIGN).decode() + "\n```\n\n"
        "```js\nconst a = {.is-info}\n```\n"
    ), tags="getting started, intro", description="The front page"),
    "guide.md": wikijs_file("User Guide", "Child: [setup](setup). Back [home](/)."),
    "guide/setup.md": wikijs_file("Setup", "Steps.\n\n> Note\n> {.is-info}\n", published="false"),
    "guide/visual.html": wikijs_file("Visual Page", (
        '<h2>Visual</h2><p>Go to <a href="/guide/setup">setup</a> or '
        '<a href="https://example.com">site</a>.</p>'
        '<figure class="image"><img src="/uploads/logo.png" alt="Logo"></figure>'
        '<ul><li>one</li><li>two</li></ul>'
        '<blockquote class="is-success"><p>Done</p></blockquote>'
    ), html=True, tags="visual"),
    "zh/guide.md": wikijs_file("指南", "中文頁面 [首頁](/zh/home)"),
    "zh/home.md": wikijs_file("首頁", "歡迎"),
    "uploads/logo.png": PNG,
    "notes/readme.adoc": "= AsciiDoc page",
}


def test_wikijs_dump_autodetected_and_structure():
    r = run(WIKIJS_DUMP)
    assert r.flavor == "wikijs"
    pages = by_title(r)
    assert {"Welcome", "User Guide", "Setup", "Visual Page", "zh", "指南", "首頁"} <= set(pages)
    # guide.md is the page of the guide/ folder (Wiki.js parent/child paths)
    assert pages["Setup"].parent_key == pages["User Guide"].key
    assert pages["Visual Page"].parent_key == pages["User Guide"].key
    assert pages["Welcome"].tags == ["getting started", "intro"]
    assert pages["Visual Page"].tags == ["visual"]
    roots = sorted((p for p in r.pages if p.parent_key is None), key=lambda p: p.sort_order)
    assert roots[0].title == "Welcome"  # Wiki.js home first
    # Wiki.js metadata is consumed, not dumped as YAML.
    assert all("```yaml" not in p.content_md for p in r.pages)
    msgs = [(w["file"], w["message"]) for w in r.warnings]
    assert ("guide/setup.md", "Page was unpublished in Wiki.js; imported as a normal page") in msgs
    assert any(f == "notes/readme.adoc" and "Skipped" in m for f, m in msgs)


def test_wikijs_links_attrs_callouts_diagrams():
    r = run(WIKIJS_DUMP)
    pages = by_title(r)
    home = pages["Welcome"].content_md
    guide, setup = pages["User Guide"].slug, pages["Setup"].slug
    assert home.startswith("*The front page*\n\n")
    assert "# Welcome" not in home
    # absolute, locale-prefixed default-locale, and relative-to-home links
    assert f"[[{guide}|guide]] or [[{setup}|setup]] and [[{setup}|docs]]" in home
    assert f"[[{pages['指南'].slug}|中文]]" in home
    assert "Tagged stuff, unknown x" in home
    logo = next(m for m in r.media if m.original_name == "logo.png")
    assert f"![Logo](/api/media/{logo.filename})" in home  # =200x and {.align-center} gone
    assert ":::warning\n\nRead this first  \ntwice\n\n:::" not in home  # markdown: no soft→hard
    assert ":::warning\n\nRead this first\ntwice\n\n:::" in home
    assert "{.links-list}" not in home and "{.tabset}" not in home and "# Tabs\n" in home
    assert "```js\nconst a = {.is-info}\n```" in home  # code untouched
    svg = next(m for m in r.media if m.original_name == "diagram-1.svg")
    assert f"![diagram](/api/media/{svg.filename})" in home
    assert "```diagram\n" in home  # foreignObject SVG rejected → kept as code
    msgs = " ".join(w["message"] for w in r.warnings)
    assert "/t/howto" in msgs and "/nowhere" in msgs and "foreignObject" not in msgs
    # Relative link from a non-home page is a child of that page.
    assert f"Child: [[{setup}|setup]]. Back [[{pages['Welcome'].slug}|home]]." in pages["User Guide"].content_md
    # In-quote attribute form
    assert ":::info\n\nNote\n\n:::" in pages["Setup"].content_md
    assert f"[[{pages['首頁'].slug}|首頁]]" in pages["指南"].content_md


def test_wikijs_html_page_converted():
    r = run(WIKIJS_DUMP)
    pages = by_title(r)
    c = pages["Visual Page"].content_md
    logo = next(m for m in r.media if m.original_name == "logo.png")
    assert c.startswith("## Visual\n\nGo to ")
    assert f"[[{pages['Setup'].slug}|setup]] or [site](https://example.com)." in c
    assert f"![Logo](/api/media/{logo.filename})" in c
    assert "- one\n- two" in c
    assert ":::tip\n\nDone\n\n:::" in c
    assert "<" not in c


def test_wikijs_multiline_description_does_not_leak_metadata():
    r = run({"a.md": wikijs_file("A", "body", description="line one\nline two")}, flavor="wikijs")
    c = r.pages[0].content_md
    assert r.pages[0].title == "A"
    assert "dateCreated" not in c and c.startswith("*line one*\n\nbody")


def test_html_pages_skipped_outside_wikijs():
    r = run({"a.md": "x", "b.html": "<p>y</p>"}, flavor="markdown")
    assert [p.title for p in r.pages] == ["a"]
    assert any(w["file"] == "b.html" and "Skipped" in w["message"] for w in r.warnings)


# ── API ─────────────────────────────────────────────────────────────────────


@pytest.fixture
def media_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "MEDIA_DIR", str(tmp_path))
    return tmp_path


async def _upload(client, content, filename="vault.zip", **form):
    return await client.post(
        "/api/import",
        files={"file": (filename, content, "application/octet-stream")},
        data=form,
    )


async def test_import_requires_admin(auth_client, media_dir):
    resp = await _upload(auth_client, make_zip({"a.md": "x"}))
    assert resp.status_code == 403


async def test_import_vault_end_to_end(admin_client, db, media_dir):
    resp = await _upload(admin_client, make_zip(OBSIDIAN_VAULT))
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["source"] == "obsidian"
    assert data["pages_created"] == 5
    assert data["media_imported"] == 2
    assert {p["title"] for p in data["root_pages"]} == {"Home", "Projects", "Notes"}
    assert any("Missing Page" in w["message"] for w in data["warnings"])

    home_slug = next(p["slug"] for p in data["root_pages"] if p["title"] == "Home")
    page = (await admin_client.get(f"/api/pages/{home_slug}")).json()
    assert "/api/media/" in page["content_md"]

    # Hierarchy
    rows = await db.execute_fetchall(
        "SELECT c.title FROM pages c JOIN pages p ON c.parent_id = p.id WHERE p.title = 'Projects'"
    )
    assert [r["title"] for r in rows] == ["Alpha"]

    # Backlinks: Beta is linked from Home (including the escaped table link).
    backlinks = (await admin_client.get(f"/api/pages/{home_slug}/backlinks")).json()
    assert any(b["title"] == "Alpha" for b in backlinks)
    beta_slug = (await db.execute_fetchall("SELECT slug FROM pages WHERE title = 'Beta'"))[0]["slug"]
    beta_back = (await admin_client.get(f"/api/pages/{beta_slug}/backlinks")).json()
    assert [b["title"] for b in beta_back] == ["Home"]

    # Tags
    tags = (await admin_client.get(f"/api/pages/{home_slug}/tags")).json()
    assert {t["name"] for t in tags} == {"start", "docs", "inbox"}

    # Media stored, referenced and served
    rows = await db.execute_fetchall(
        "SELECT m.filename FROM media m JOIN media_references r ON r.media_id = m.id "
        "JOIN pages p ON p.id = r.page_id WHERE p.slug = ?", (home_slug,)
    )
    assert len(rows) == 2
    for r in rows:
        assert (media_dir / r["filename"]).exists()
    png = next(r["filename"] for r in rows if r["filename"].endswith(".png"))
    served = await admin_client.get(f"/api/media/{png}")
    assert served.status_code == 200 and served.content == PNG

    # Search index
    found = (await admin_client.get("/api/search", params={"q": "Careful"})).json()
    assert any(hit["slug"] == beta_slug for hit in found["results"])

    # One activity entry for the whole import
    acts = await db.execute_fetchall("SELECT metadata FROM activity_log WHERE action = 'imported'")
    assert len(acts) >= 1


async def test_import_under_parent_and_single_md(admin_client, db, media_dir):
    parent = (await admin_client.post("/api/pages", json={"title": "Imported"})).json()
    note = b"# Standup\n\n###### tags: `daily`\n\nhello"
    resp = await _upload(admin_client, note, filename="standup.md",
                         source="hackmd", parent_slug=parent["slug"])
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["pages_created"] == 1 and data["source"] == "hackmd"
    slug = data["root_pages"][0]["slug"]
    page = (await admin_client.get(f"/api/pages/{slug}")).json()
    assert page["title"] == "Standup"
    assert page["parent_id"] == parent["id"]
    assert page["content_md"].strip() == "hello"


async def test_import_bad_inputs(admin_client, media_dir):
    assert (await _upload(admin_client, b"nope")).status_code == 400
    assert (await _upload(admin_client, make_zip({"a.png": PNG}))).status_code == 400
    assert (await _upload(admin_client, make_zip({"a.md": "x"}), parent_slug="nosuch")).status_code == 400
    assert (await _upload(admin_client, make_zip({"a.md": "x"}), source="notion")).status_code == 400


async def test_import_failure_rolls_back_and_removes_media(admin_client, db, media_dir, monkeypatch):
    from app.routers import imports

    async def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(imports, "log_activity", boom)
    before = (await db.execute_fetchall("SELECT COUNT(*) AS n FROM pages"))[0]["n"]
    with pytest.raises(RuntimeError):
        await _upload(admin_client, make_zip({"rollback.md": "![](a.png)", "a.png": PNG}))
    after = (await db.execute_fetchall("SELECT COUNT(*) AS n FROM pages"))[0]["n"]
    assert after == before
    assert list(media_dir.iterdir()) == []

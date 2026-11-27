# Links & Embeds

A wiki is only as useful as the connections between its pages. JustWiki gives you three ways to connect them: wikilinks, transclusion and @mentions.

## Wikilinks

![Typing double brackets opens page search](/api/media/wikilink.png)

Type `[[` in the editor to search for a page; keep typing to filter, use ↑ ↓ to choose and Enter to insert. The result looks like:

```
[[page-slug]]
[[page-slug|custom text]]
```

For example, this link goes back to the [[en-guide|guide contents]].

Links point at the page's slug (its URL code), so renaming or moving a page never breaks them.

## Backlinks

Every save parses the page's wikilinks and records who links to whom. The **Linked from** section at the bottom of each page lists every page that links to it — scroll down to see which guide pages link here.

Backlinks also feed the [[en-browse|graph view]].

## Transclusion (embedding pages)

Put an exclamation mark in front of a wikilink to embed the other page's content in place:

```
![[page-slug]]
![[page-slug|custom title]]
```

The embed is live: when the source page changes, every page embedding it shows the new content. Common uses:

- Write shared snippets (contacts, environment lists, a shortcut table) once and embed them wherever they're needed
- Build an overview page that pulls together the key parts of several sub-pages

The shortcut table in [[en-quick-start|Quick Start]] is embedded from the [[en-shortcuts|Keyboard Shortcuts]] page. Here it is again:

![[en-shortcuts|Keyboard Shortcuts]]

## @mentions

Type `@` in a page or comment to pick a user:

- `@username` — mentions a user and links to their profile
- `@@groupname` — mentions a whole group

Mentioned users (or the group's members) get a notification — except anyone who can't read the page. Profile bios support @mentions and wikilinks too.

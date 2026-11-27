# Collaboration

## Discussion

Every page has a **Discussion** section at the bottom — for questions, reports of outdated content, or talking through changes. Comments support Markdown and @mentions (see [[en-links|Links & Embeds]]); authors can edit or delete their own.

## Watching pages and notifications

Click **Watch page** and you'll see a notification under the bell whenever someone else updates or deletes it. The page shows how many people are watching.

You are notified when:

- a page you watch is created, updated or deleted by someone else
- you're @mentioned in a page or comment
- a page you own comes due for review (see "Periodic review" below)

:::info
If a page is later restricted and you can no longer read it, you stop getting notifications for it, so its title doesn't leak.
:::

## Version history

Every save creates a new version. Click **History** on a page to:

- browse all versions and who made them
- tick any two versions to compare them (diff)
- **Revert** to an old version — the current content is saved as a new version first, so a revert can itself be undone

## Concurrent edit protection

When two people edit the same page at once, the first to save saves normally. The second doesn't silently overwrite the first; they get a conflict prompt showing the differences, so they can merge their changes onto the latest version before saving.

This is optimistic locking: every save says "I edited version N", and the server answers 409 Conflict if the page has moved on. The API works the same way — see the [[en-developer|Developer Guide]].

## Draft autosave

Your in-progress edits are saved in the browser and can be restored after closing the tab or a crash. See [[en-editor|The Editor]].

## Periodic review

The most common problem with documentation is that it goes stale and nobody notices. Periodic review gives any page an owner and a schedule:

1. Open **⋯ More actions → Review settings** on the page and turn review on
2. Choose an interval (every N days) and optionally an owner (if none, the page creator is responsible)
3. When the owner confirms the content is still right, they click **Mark as verified** and the clock restarts

The page shows "due in N days" or "overdue by N days" and the last verified date, so readers can tell at a glance whether to trust it. When a review falls due the owner is notified (and a webhook can forward it to Slack or similar).

**Reviews** in the sidebar lists every page with review turned on, most urgent first, filterable to **All** or **Owned by me**.

## Recent Changes

**Recent Changes** in the sidebar is the wiki-wide activity timeline; see [[en-browse|Search & Browse]].

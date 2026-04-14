import re

# Matches both ::drawio[123] and Milkdown-escaped ::drawio\[123\].
# Milkdown escapes the square brackets on the way out of the editor, so stored
# markdown can contain either form depending on where it was last edited.
DRAWIO_ID_RE = re.compile(r"::drawio\\?\[(\d+)\\?\]")


def extract_diagram_ids(content_md: str) -> set[int]:
    """Extract every ::drawio[id] reference from a markdown blob."""
    return {int(m.group(1)) for m in DRAWIO_ID_RE.finditer(content_md or "")}

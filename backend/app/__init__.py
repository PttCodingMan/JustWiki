from pathlib import Path


def _read_version() -> str:
    """Read the single-source-of-truth VERSION file at repo root.

    Falls back to "0.0.0" when the file is missing (e.g. the backend package
    has been vendored somewhere that doesn't ship VERSION). The file is read
    once at import time; bumping the version requires a restart, which is
    exactly when a new release ships anyway.
    """
    candidates = [
        Path(__file__).resolve().parents[2] / "VERSION",  # repo root in dev
        Path(__file__).resolve().parents[1] / "VERSION",  # copied next to backend/
    ]
    for p in candidates:
        try:
            return p.read_text(encoding="utf-8").strip() or "0.0.0"
        except (FileNotFoundError, OSError):
            continue
    return "0.0.0"


__version__ = _read_version()

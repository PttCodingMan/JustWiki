from pydantic import BaseModel
from typing import Literal
from datetime import datetime


# ── Page types ──
# Free-form TEXT in SQLite; Pydantic Literal is the source of truth for validation.
# Add new types here (plus a frontend renderer) — no migration required.
PageType = Literal["document", "mindmap"]

# Mindmap layout strategy. Author-chosen, persisted on the page row. NULL is
# treated as 'lr' by the frontend so existing rows render unchanged.
MindmapLayout = Literal["lr", "rl", "radial"]


# ── Auth ──
class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    display_name: str | None = ""
    email: str | None = ""
    created_at: str | None = None


# ── Pages ──
class PageCreate(BaseModel):
    title: str
    content_md: str = ""
    parent_id: int | None = None
    sort_order: int = 0
    template_id: int | None = None
    slug: str | None = None
    page_type: PageType = "document"
    mindmap_layout: MindmapLayout | None = None


class PageUpdate(BaseModel):
    title: str | None = None
    content_md: str | None = None
    parent_id: int | None = None
    sort_order: int | None = None
    is_public: bool | None = None
    page_type: PageType | None = None
    mindmap_layout: MindmapLayout | None = None
    base_version: int | None = None  # for optimistic locking


class PageMoveRequest(BaseModel):
    parent_id: int | None = None
    sort_order: int | None = None


class PageResponse(BaseModel):
    id: int
    slug: str
    title: str
    content_md: str
    parent_id: int | None = None
    sort_order: int = 0
    view_count: int = 0
    version: int = 1
    is_public: bool = False
    page_type: PageType = "document"
    mindmap_layout: MindmapLayout | None = None
    created_by: int | None = None
    author_name: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    effective_permission: str | None = None


class PublicPageResponse(BaseModel):
    slug: str
    title: str
    content_md: str
    page_type: PageType = "document"
    mindmap_layout: MindmapLayout | None = None
    updated_at: str | None = None
    author_name: str | None = None
    diagrams: dict[str, str] = {}


class PageListResponse(BaseModel):
    pages: list[PageResponse]
    total: int
    page: int
    per_page: int


# ── Templates ──
class TemplateCreate(BaseModel):
    name: str
    description: str = ""
    content_md: str


class TemplateUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    content_md: str | None = None


class TemplateResponse(BaseModel):
    id: int
    name: str
    description: str
    content_md: str
    created_by: int | None = None
    created_at: str | None = None


# ── Media ──
class MediaResponse(BaseModel):
    id: int
    filename: str
    original_name: str
    filepath: str
    mime_type: str
    size_bytes: int | None = None
    uploaded_by: int | None = None
    uploaded_at: str | None = None
    url: str = ""


class MediaReferencedPage(BaseModel):
    id: int
    slug: str
    title: str


class MediaListItem(BaseModel):
    id: int
    filename: str
    original_name: str
    mime_type: str
    size_bytes: int | None = None
    uploaded_by: int | None = None
    uploaded_by_name: str | None = None
    uploaded_at: str | None = None
    url: str = ""
    reference_count: int = 0
    referenced_pages: list[MediaReferencedPage] = []


# ── Diagrams ──
class DiagramCreate(BaseModel):
    name: str
    xml_data: str
    page_id: int | None = None


class DiagramUpdate(BaseModel):
    name: str | None = None
    xml_data: str | None = None
    svg_cache: str | None = None
    page_id: int | None = None


class DiagramResponse(BaseModel):
    id: int
    page_id: int | None = None
    name: str
    xml_data: str
    svg_cache: str | None = None
    created_by: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class DiagramReferencedPage(BaseModel):
    id: int
    slug: str
    title: str
    deleted: bool = False


class DiagramListItem(BaseModel):
    id: int
    name: str
    page_id: int | None = None
    has_svg: bool = False
    created_by: int | None = None
    created_by_name: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    reference_count: int = 0
    referenced_pages: list[DiagramReferencedPage] = []

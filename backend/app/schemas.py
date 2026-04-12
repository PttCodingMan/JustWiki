from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# ── Auth ──
class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    display_name: Optional[str] = ""
    email: Optional[str] = ""
    created_at: Optional[str] = None


# ── Pages ──
class PageCreate(BaseModel):
    title: str
    content_md: str = ""
    parent_id: Optional[int] = None
    sort_order: int = 0
    template_id: Optional[int] = None
    slug: Optional[str] = None


class PageUpdate(BaseModel):
    title: Optional[str] = None
    content_md: Optional[str] = None
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None
    is_public: Optional[bool] = None
    base_version: Optional[int] = None  # for optimistic locking


class PageMoveRequest(BaseModel):
    parent_id: Optional[int] = None
    sort_order: Optional[int] = None


class PageResponse(BaseModel):
    id: int
    slug: str
    title: str
    content_md: str
    parent_id: Optional[int] = None
    sort_order: int = 0
    view_count: int = 0
    version: int = 1
    is_public: bool = False
    created_by: Optional[int] = None
    author_name: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PublicPageResponse(BaseModel):
    slug: str
    title: str
    content_md: str
    updated_at: Optional[str] = None
    author_name: Optional[str] = None
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
    name: Optional[str] = None
    description: Optional[str] = None
    content_md: Optional[str] = None


class TemplateResponse(BaseModel):
    id: int
    name: str
    description: str
    content_md: str
    created_by: Optional[int] = None
    created_at: Optional[str] = None


# ── Media ──
class MediaResponse(BaseModel):
    id: int
    filename: str
    original_name: str
    filepath: str
    mime_type: str
    size_bytes: Optional[int] = None
    uploaded_by: Optional[int] = None
    uploaded_at: Optional[str] = None
    url: str = ""


# ── Diagrams ──
class DiagramCreate(BaseModel):
    name: str
    xml_data: str
    page_id: Optional[int] = None


class DiagramUpdate(BaseModel):
    name: Optional[str] = None
    xml_data: Optional[str] = None
    svg_cache: Optional[str] = None
    page_id: Optional[int] = None


class DiagramResponse(BaseModel):
    id: int
    page_id: Optional[int] = None
    name: str
    xml_data: str
    svg_cache: Optional[str] = None
    created_by: Optional[int] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

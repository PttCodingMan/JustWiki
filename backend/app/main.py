from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db, close_db
from app.auth import ensure_admin_exists
from app.routers import auth_router, pages, media, templates, search, tags, activity, bookmarks


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_admin_exists()
    yield
    await close_db()


app = FastAPI(title="JustWiki", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(pages.router)
app.include_router(media.router)
app.include_router(templates.router)
app.include_router(search.router)
app.include_router(tags.router)
app.include_router(activity.router)
app.include_router(bookmarks.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}

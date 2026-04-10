from fastapi import APIRouter, HTTPException, Response, Depends
from app.schemas import LoginRequest, UserResponse
from app.auth import verify_password, create_token, get_current_user
from app.database import get_db

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
async def login(body: LoginRequest, response: Response):
    db = await get_db()
    rows = await db.execute_fetchall(
        "SELECT id, username, password_hash, role FROM users WHERE username = ?",
        (body.username,),
    )
    if not rows or not verify_password(body.password, rows[0]["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = dict(rows[0])
    token = create_token(user["id"], user["username"], user["role"])
    response.set_cookie(
        key="token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400,
    )
    return {
        "token": token,
        "user": {"id": user["id"], "username": user["username"], "role": user["role"]},
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("token")
    return {"ok": True}


@router.get("/me", response_model=UserResponse)
async def me(user=Depends(get_current_user)):
    return user

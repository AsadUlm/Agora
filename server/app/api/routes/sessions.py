"""Session management routes — create draft sessions for document uploads."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.db.session import get_db
from app.models.chat_session import ChatSession
from app.models.user import User

router = APIRouter()


class SessionCreateResponse(BaseModel):
    id: uuid.UUID
    title: str
    created_at: datetime


@router.post("", response_model=SessionCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SessionCreateResponse:
    """Create a draft session for document uploads before starting a debate."""
    session = ChatSession(
        user_id=current_user.id,
        title="Draft",
    )
    db.add(session)
    await db.flush()
    await db.commit()
    return SessionCreateResponse(
        id=session.id,
        title=session.title or "",
        created_at=session.created_at,
    )

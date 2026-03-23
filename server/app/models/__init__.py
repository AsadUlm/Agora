# Import all models here so Alembic autogenerate detects every table.
from app.models.agent import Agent
from app.models.debate import Debate
from app.models.round import Round
from app.models.user import User

__all__ = ["User", "Debate", "Agent", "Round"]

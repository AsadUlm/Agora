"""Tests for authentication: signup, login, refresh, protected routes, settings."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.security import create_access_token, create_refresh_token


# ── Helpers ───────────────────────────────────────────────────────────────

SIGNUP_URL = "/auth/signup"
LOGIN_URL = "/auth/login"
REFRESH_URL = "/auth/refresh"
ME_URL = "/users/me"
SETTINGS_URL = "/users/me/settings"

VALID_USER = {
    "email": "alice@example.com",
    "password": "Secret123",
    "display_name": "Alice",
}


async def _signup(client: AsyncClient, **overrides) -> dict:
    payload = {**VALID_USER, **overrides}
    resp = await client.post(SIGNUP_URL, json=payload)
    return resp


async def _login(client: AsyncClient, email: str, password: str) -> dict:
    resp = await client.post(LOGIN_URL, json={"email": email, "password": password})
    return resp


def _auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Signup tests ──────────────────────────────────────────────────────────

class TestSignup:
    async def test_signup_success(self, client: AsyncClient):
        resp = await _signup(client)
        assert resp.status_code == 201
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == VALID_USER["email"]
        assert data["user"]["display_name"] == "Alice"

    async def test_signup_duplicate_email(self, client: AsyncClient):
        await _signup(client)
        resp = await _signup(client)
        assert resp.status_code == 409
        assert "already registered" in resp.json()["detail"].lower()

    async def test_signup_invalid_email(self, client: AsyncClient):
        resp = await _signup(client, email="not-an-email")
        assert resp.status_code == 422

    async def test_signup_password_too_short(self, client: AsyncClient):
        resp = await _signup(client, password="Ab1")
        assert resp.status_code == 422

    async def test_signup_password_no_digit(self, client: AsyncClient):
        resp = await _signup(client, password="NoDigitsHere")
        assert resp.status_code == 422

    async def test_signup_password_no_letter(self, client: AsyncClient):
        resp = await _signup(client, password="12345678")
        assert resp.status_code == 422


# ── Login tests ───────────────────────────────────────────────────────────

class TestLogin:
    async def test_login_success(self, client: AsyncClient):
        await _signup(client)
        resp = await _login(client, VALID_USER["email"], VALID_USER["password"])
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert data["user"]["email"] == VALID_USER["email"]

    async def test_login_wrong_password(self, client: AsyncClient):
        await _signup(client)
        resp = await _login(client, VALID_USER["email"], "WrongPass1")
        assert resp.status_code == 401
        # Must not leak whether email exists
        assert "invalid email or password" in resp.json()["detail"].lower()

    async def test_login_nonexistent_user(self, client: AsyncClient):
        resp = await _login(client, "nobody@example.com", "Whatever1")
        assert resp.status_code == 401


# ── Refresh token tests ──────────────────────────────────────────────────

class TestRefresh:
    async def test_refresh_success(self, client: AsyncClient):
        signup_resp = await _signup(client)
        refresh_token = signup_resp.json()["refresh_token"]
        resp = await client.post(REFRESH_URL, json={"refresh_token": refresh_token})
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert "refresh_token" in data

    async def test_refresh_with_access_token_fails(self, client: AsyncClient):
        signup_resp = await _signup(client)
        access_token = signup_resp.json()["access_token"]
        resp = await client.post(REFRESH_URL, json={"refresh_token": access_token})
        assert resp.status_code == 401

    async def test_refresh_invalid_token(self, client: AsyncClient):
        resp = await client.post(REFRESH_URL, json={"refresh_token": "garbage"})
        assert resp.status_code == 401


# ── Protected route tests ────────────────────────────────────────────────

class TestProtectedRoutes:
    async def test_me_without_token(self, client: AsyncClient):
        resp = await client.get(ME_URL)
        assert resp.status_code in (401, 403)

    async def test_me_with_invalid_token(self, client: AsyncClient):
        resp = await client.get(ME_URL, headers=_auth_header("not.a.real.token"))
        assert resp.status_code == 401

    async def test_me_with_expired_token(self, client: AsyncClient):
        """Manually craft an expired token to test expiration handling."""
        from datetime import datetime, timedelta, timezone
        from jose import jwt
        from app.core.config import settings

        expired_payload = {
            "sub": "00000000-0000-0000-0000-000000000000",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
            "type": "access",
        }
        expired_token = jwt.encode(
            expired_payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM
        )
        resp = await client.get(ME_URL, headers=_auth_header(expired_token))
        assert resp.status_code == 401

    async def test_me_success(self, client: AsyncClient):
        signup_resp = await _signup(client)
        token = signup_resp.json()["access_token"]
        resp = await client.get(ME_URL, headers=_auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == VALID_USER["email"]
        assert data["auth_provider"] == "email"
        assert "settings" in data


# ── Settings tests ────────────────────────────────────────────────────────

class TestSettings:
    async def test_update_settings(self, client: AsyncClient):
        signup_resp = await _signup(client)
        token = signup_resp.json()["access_token"]
        headers = _auth_header(token)

        resp = await client.patch(
            SETTINGS_URL,
            json={"theme": "dark", "language": "ru"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["theme"] == "dark"
        assert data["language"] == "ru"
        assert data["notifications_enabled"] is True  # unchanged default

    async def test_update_settings_partial(self, client: AsyncClient):
        signup_resp = await _signup(client)
        token = signup_resp.json()["access_token"]
        headers = _auth_header(token)

        resp = await client.patch(
            SETTINGS_URL,
            json={"notifications_enabled": False},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["notifications_enabled"] is False
        assert data["theme"] == "system"  # default preserved

    async def test_settings_requires_auth(self, client: AsyncClient):
        resp = await client.patch(SETTINGS_URL, json={"theme": "dark"})
        assert resp.status_code in (401, 403)

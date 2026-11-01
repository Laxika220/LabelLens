import cv2
import pytest
from fastapi.testclient import TestClient

from app import main
from eval import synth


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(main, "TOKEN", "secret")
    main._hits.clear()
    return TestClient(main.app)


def jpeg_bytes():
    img = synth.make({"text": "INGREDIENTS: Sugar, Salt, Wheat Flour. CONTAINS WHEAT."}, "clean", seed=2)
    return cv2.imencode(".jpg", img)[1].tobytes()


def test_rejects_missing_token(client):
    r = client.post("/assess", files={"image": ("a.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 401


def test_rejects_non_images(client):
    r = client.post("/assess", headers={"x-service-token": "secret"}, files={"image": ("a.txt", b"hello", "text/plain")})
    assert r.status_code == 415
    r = client.post("/assess", headers={"x-service-token": "secret"}, files={"image": ("a.jpg", b"not really a jpeg", "image/jpeg")})
    assert r.status_code == 422


def test_assess_returns_report(client):
    r = client.post("/assess", headers={"x-service-token": "secret"}, files={"image": ("a.jpg", jpeg_bytes(), "image/jpeg")})
    assert r.status_code == 200
    body = r.json()
    assert body["verdict"] == "good"
    assert body["regions"] and "box" in body["regions"][0]


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(main, "RATE_LIMIT", 2)
    for _ in range(2):
        client.get("/health")
        client.post("/assess", headers={"x-service-token": "secret"}, files={"image": ("a.txt", b"x", "text/plain")})
    r = client.post("/assess", headers={"x-service-token": "secret"}, files={"image": ("a.txt", b"x", "text/plain")})
    assert r.status_code == 429

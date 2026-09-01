"""The server must NOT silently fall back to the mock agent when a real VLM fails.

A model failure -> VLMUnavailable -> HTTP 503 -> the client stops and offers a
retry. `mock` remains valid only as an explicit VLM_MODE.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

import pytest

import vlm
from schema import Skeleton, SkeletonNode, StepRequest
from vlm import VLMUnavailable, run_step


def _req():
    node = SkeletonNode(id="el-1", tag="input", type="text", label="Full name",
                        state="empty", hasFill=True, fillToken="local:full name",
                        piiCategory="full name", bbox={"x": 0, "y": 0, "w": 100, "h": 20})
    skel = Skeleton(viewport={"w": 1280, "h": 720}, nodes=[node])
    return StepRequest(taskGoal="Fill this form from my local profile.", step=1, skeleton=skel)


def _boom(_req):
    raise RuntimeError("gemini 503: model overloaded")


def test_explicit_mock_mode_still_works(monkeypatch):
    monkeypatch.setenv("VLM_MODE", "mock")
    resp = run_step(_req())
    assert resp.model == "mock"
    assert resp.actions or resp.done


def test_real_model_failure_raises_not_falls_back(monkeypatch):
    monkeypatch.setenv("VLM_MODE", "gemini")
    monkeypatch.setitem(vlm._ADAPTERS, "gemini", _boom)
    with pytest.raises(VLMUnavailable):
        run_step(_req())


def test_unknown_mode_raises(monkeypatch):
    monkeypatch.setenv("VLM_MODE", "totally-not-a-model")
    with pytest.raises(VLMUnavailable):
        run_step(_req())


def test_endpoint_returns_503_on_failure(monkeypatch):
    monkeypatch.setenv("VLM_MODE", "gemini")
    monkeypatch.setitem(vlm._ADAPTERS, "gemini", _boom)
    from fastapi.testclient import TestClient
    import main

    client = TestClient(main.app, raise_server_exceptions=False)
    r = client.post("/agent/step", json=_req().model_dump())
    assert r.status_code == 503
    assert "unavailable" in r.text.lower()


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))

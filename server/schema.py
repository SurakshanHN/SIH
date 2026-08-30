"""Request/response contracts for the agent endpoint.

The server only ever sees sanitized data:
  - screenshot: a data: URL of the *redacted* image
  - skeleton:   the accessibility tree, field values reduced to empty/filled/readonly
  - token_map:  token -> PII category (never a value)
  - available_tokens: category -> token the client is able to fill locally
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

ActionName = Literal["click", "type", "select", "scroll", "submit", "wait", "done"]


class SkeletonNode(BaseModel):
    id: str
    tag: str
    type: Optional[str] = None
    role: Optional[str] = None
    label: str = ""
    name: Optional[str] = None
    required: bool = False
    state: str = "n/a"
    piiCategory: Optional[str] = None
    visible: bool = True
    bbox: dict[str, float]
    bboxDevice: Optional[dict[str, float]] = None
    options: Optional[list[dict[str, str]]] = None
    text: Optional[str] = None
    isSubmit: Optional[bool] = None
    fillToken: Optional[str] = None


class Skeleton(BaseModel):
    url: str = ""
    title: str = ""
    viewport: dict[str, float]
    scroll: dict[str, float] = Field(default_factory=dict)
    nodes: list[SkeletonNode]


class VisionDetection(BaseModel):
    category: str
    confidence: float
    sources: list[str]
    bbox: dict[str, float]
    fieldId: Optional[str] = None


class HistoryItem(BaseModel):
    step: int
    action: Optional[dict[str, Any]] = None
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class StepRequest(BaseModel):
    taskGoal: str
    step: int = 1
    skeleton: Skeleton
    tokenMap: dict[str, str] = Field(default_factory=dict)
    availableTokens: dict[str, str] = Field(default_factory=dict)
    visionDetections: list[VisionDetection] = Field(default_factory=list)
    screenshot: Optional[str] = None  # redacted data: URL
    history: list[HistoryItem] = Field(default_factory=list)


class Action(BaseModel):
    action: ActionName
    targetId: Optional[str] = None
    valueToken: Optional[str] = None
    literalValue: Optional[str] = None
    reason: Optional[str] = None


class StepResponse(BaseModel):
    actions: list[Action]
    rationale: str = ""
    done: bool = False
    latency_ms: Optional[int] = None
    model: str = ""

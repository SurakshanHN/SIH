"""VLM adapters.

Modes (env VLM_MODE):
  mock   - deterministic agent, no network. Reads the sanitized skeleton and
           fills PII fields with their fillToken. Lets the whole pipeline run
           offline and is the default.
  openai - any OpenAI-compatible chat/vision endpoint. Point VLM_BASE_URL at a
           vLLM / Ollama / OpenRouter server hosting an open-weight VLM
           (Qwen2.5-VL, Llama-3.2-Vision, InternVL2, ...).

The redacted screenshot is passed to `openai` mode as an image_url so the model
genuinely uses visual context; `mock` mode ignores it.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

from schema import Action, StepRequest, StepResponse

SYSTEM_PROMPT = (Path(__file__).parent / "prompts" / "system.md").read_text()

_SUBMIT_WORDS = re.compile(r"\b(submit|send the form|complete and submit)\b", re.I)
_NO_SUBMIT_WORDS = re.compile(r"\b(don'?t submit|do not submit|stop before submit|without submitting)\b", re.I)


# --------------------------------------------------------------------------
# mock agent
# --------------------------------------------------------------------------
def _mock(req: StepRequest) -> StepResponse:
    actions: list[Action] = []
    handled = {
        h.action.get("targetId")
        for h in req.history
        if h.action and h.action.get("result", {}) is not None
    }
    for node in req.skeleton.nodes:
        if len(actions) >= 4:
            break
        if not node.visible or node.state in ("filled", "readonly", "disabled"):
            continue
        if node.id in handled:
            continue

        token = node.fillToken or (req.availableTokens.get(node.piiCategory or "") if node.piiCategory else None)

        if node.tag in ("input", "textarea") and token:
            actions.append(Action(action="type", targetId=node.id, valueToken=token,
                                  reason=f"fill {node.piiCategory} from local vault"))
        elif node.tag == "select" and node.options:
            # only auto-pick clearly non-personal dropdowns (e.g. country)
            lbl = (node.label or node.name or "").lower()
            if "country" in lbl:
                opt = next((o for o in node.options if o["label"].strip().lower() in ("india", "in")), None)
                if opt:
                    actions.append(Action(action="select", targetId=node.id, literalValue=opt["value"],
                                          reason="country = India"))
        elif node.type == "checkbox" and ("agree" in (node.label or "").lower() or "terms" in (node.label or "").lower()):
            actions.append(Action(action="click", targetId=node.id, reason="accept terms"))

    goal = req.taskGoal or ""
    wants_submit = bool(_SUBMIT_WORDS.search(goal)) and not _NO_SUBMIT_WORDS.search(goal)

    if not actions:
        if wants_submit:
            btn = next((n for n in req.skeleton.nodes
                        if (n.isSubmit or (n.tag == "button") or n.role == "button")
                        and re.search(r"submit|apply|continue|pay|save", (n.text or ""), re.I)), None)
            if btn:
                return StepResponse(actions=[Action(action="submit", targetId=btn.id, reason="all fields filled")],
                                    rationale="All visible fields handled; submitting.", model="mock")
        return StepResponse(actions=[Action(action="done")], rationale="Nothing left to fill.",
                            done=True, model="mock")

    return StepResponse(actions=actions, rationale=f"Filling {len(actions)} field(s) from the local vault.",
                        model="mock")


# --------------------------------------------------------------------------
# OpenAI-compatible VLM
# --------------------------------------------------------------------------
def _openai(req: StepRequest) -> StepResponse:
    from openai import OpenAI

    client = OpenAI(
        base_url=os.environ.get("VLM_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=os.environ.get("VLM_API_KEY", "not-set"),
    )
    model = os.environ.get("VLM_MODEL", "qwen/qwen-2.5-vl-7b-instruct")

    user_content: list[dict] = [{
        "type": "text",
        "text": json.dumps({
            "taskGoal": req.taskGoal,
            "step": req.step,
            "skeleton": req.skeleton.model_dump(exclude_none=True),
            "tokenMap": req.tokenMap,
            "availableTokens": req.availableTokens,
            "visionDetections": [d.model_dump() for d in req.visionDetections],
            "history": [h.model_dump(exclude_none=True) for h in req.history],
        }),
    }]
    if req.screenshot and req.screenshot.startswith("data:image"):
        user_content.append({"type": "image_url", "image_url": {"url": req.screenshot}})

    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0,
        max_tokens=800,
    )
    raw = resp.choices[0].message.content or "{}"
    raw = re.sub(r"^```(?:json)?|```$", "", raw.strip(), flags=re.M).strip()
    data = json.loads(raw)
    return StepResponse(
        actions=[Action(**a) for a in data.get("actions", [])],
        rationale=data.get("rationale", ""),
        done=bool(data.get("done", False)),
        model=model,
    )


def run_step(req: StepRequest) -> StepResponse:
    mode = os.environ.get("VLM_MODE", "mock").lower()
    t0 = time.time()
    try:
        resp = _openai(req) if mode == "openai" else _mock(req)
    except Exception as exc:  # noqa: BLE001 - fall back so the demo never hard-stops
        resp = _mock(req)
        resp.rationale = f"[fell back to mock: {exc}] " + resp.rationale
    resp.latency_ms = int((time.time() - t0) * 1000)
    return resp

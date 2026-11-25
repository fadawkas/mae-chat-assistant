"""Run JavaScript with no host bindings; return only JSON data to Mae."""

import json

import quickjs
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class CodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32_000)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/execute")
def execute(request: CodeRequest):
    context = quickjs.Context()
    context.set_memory_limit(16 * 1024 * 1024)
    context.set_max_stack_size(512 * 1024)
    context.set_time_limit(0.25)
    # Cap effects in the runner for fast feedback, and revalidate the entire
    # response in Mae. No Python callbacks, subprocesses or file handles exist here.
    try:
        encoded = context.eval(
            """(() => {
                "use strict";
                const files = [];
                const add = file => {
                    if (files.length >= 8) throw Error("At most 8 files per execution");
                    files.push(file);
                };
                const mae = Object.freeze({
                    writeFile: (name, text) => add({ kind: "text", name, text }),
                    document: (name, title, sections, {summary, max_pages, slide_theme, cover_image} = {}) =>
                        add({ kind: "document", name, title, sections, summary, max_pages, slide_theme, cover_image }),
                    spreadsheet: (name, rows, options) => add({ kind: "spreadsheet", name, rows, options }),
                });
                const result = (() => {
            """
            + request.code
            + """
                })();
                if (result && typeof result.then === "function") throw Error("Use synchronous code");
                return JSON.stringify({ result: result ?? null, files });
            })()
            """
        )
    except quickjs.JSException as exc:
        detail = str(exc).splitlines() or ["JavaScript failed"]
        raise HTTPException(422, detail[0][:240]) from None
    if not isinstance(encoded, str) or len(encoded.encode("utf-8")) > 256 * 1024:
        raise HTTPException(422, "Code output exceeds the allowed size")
    try:
        return json.loads(encoded)
    except (ValueError, RecursionError):
        raise HTTPException(422, "Code must return JSON-compatible values") from None

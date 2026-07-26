import json

import httpx

from app.core.config import settings


class OpenRouterClient:
    """Shared httpx client for OpenRouter chat completions.

    Usage:
        client = OpenRouterClient()  # created once, stored in app.state
        async for token in client.stream(model, messages):
            ...
        text = await client.complete(model, messages)
    """

    def __init__(self, api_key: str) -> None:
        if not api_key.strip():
            raise ValueError("An explicit OpenRouter API key is required")
        self._client: httpx.AsyncClient | None = None
        self._api_key = api_key

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=settings.openrouter_base_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "HTTP-Referer": "http://localhost:8080",
                    "X-Title": "Mae",
                },
                timeout=httpx.Timeout(120.0, connect=10.0),
            )
        return self._client

    async def close(self) -> None:
        """Close the underlying httpx client if it was created."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def stream(
        self, model: str, messages: list[dict]
    ):
        """Stream tokens from an OpenRouter chat completion.

        Yields decoded text tokens as strings.  Skips keepalive comment
        lines (``: OPENROUTER PROCESSING``) and handles the final
        ``[DONE]`` sentinel and mid-stream chunks where ``delta.content``
        is ``None``.
        """
        async with self.client.stream(
            "POST",
            "/chat/completions",
            json={
                "model": model,
                "messages": messages,
                "stream": True,
            },
        ) as response:
            # Check for upstream errors immediately (bad key, bad model)
            if not response.is_success:
                body = await response.aread()
                raise httpx.HTTPStatusError(
                    f"OpenRouter returned {response.status_code}: {body.decode(errors='replace')}",
                    request=response.request,
                    response=response,
                )

            async for line in response.aiter_lines():
                # Skip keepalive / comment lines.
                # OpenRouter sends ": OPENROUTER PROCESSING" lines.
                if not line.startswith("data: "):
                    continue

                raw = line[6:]  # strip "data: " prefix
                if raw == "[DONE]":
                    return

                try:
                    chunk = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content")
                if content:
                    yield content

    async def complete(
        self, model: str, messages: list[dict]
    ) -> str:
        """Non-streaming chat completion.

        Sends a single POST, waits for the full response, and returns the
        content text.  Raises ``httpx.HTTPStatusError`` on non-2xx status,
        or ``KeyError`` if the response structure is unexpected.
        """
        response = await self.client.post(
            "/chat/completions",
            json={
                "model": model,
                "messages": messages,
                "stream": False,
            },
        )
        if not response.is_success:
            raise httpx.HTTPStatusError(
                f"OpenRouter returned {response.status_code}: {response.text}",
                request=response.request,
                response=response,
            )
        body = response.json()
        return body["choices"][0]["message"]["content"]

    async def models(self) -> list[dict]:
        response = await self.client.get("/models")
        if not response.is_success:
            raise httpx.HTTPStatusError("Unable to list OpenRouter models", request=response.request, response=response)
        return [
            {"id": item["id"], "name": item.get("name", item["id"]), "context_length": item.get("context_length")}
            for item in response.json().get("data", [])
        ]

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("quickjs", reason="Install the code runner image's QuickJS dependency to test it")
from codemode.runner import app

client = TestClient(app)


def test_code_can_compose_multiple_file_effects_without_host_apis():
    response = client.post("/execute", json={"code": """
        const numbers = [2, 3, 5];
        const total = numbers.reduce((sum, value) => sum + value, 0);
        mae.writeFile("total.txt", String(total));
        mae.spreadsheet("values.xlsx", numbers.map(value => [value]));
        return { total, fetch: typeof fetch, require: typeof require };
    """})
    assert response.status_code == 200
    result = response.json()
    assert result["result"] == {"total": 10, "fetch": "undefined", "require": "undefined"}
    assert result["files"] == [
        {"kind": "text", "name": "total.txt", "text": "10"},
        {"kind": "spreadsheet", "name": "values.xlsx", "rows": [[2], [3], [5]]},
    ]


@pytest.mark.parametrize("code", ["while (true) {}", 'return "x".repeat(300000);', "return Promise.resolve(1);"])
def test_runtime_limits(code):
    assert client.post("/execute", json={"code": code}).status_code == 422
    assert client.post("/execute", json={"code": "return 3 * 7;"}).json()["result"] == 21

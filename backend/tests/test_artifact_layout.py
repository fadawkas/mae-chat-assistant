import io

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from pypdf import PdfReader

from app.services.agent import CodeOutput
from app.services.artifacts import DocumentFile, Section, render_checked

BUDGET_CODE = """
const items = [["Hotel", 240], ["Train tickets", 86], ["Meals", 125], ["Activities", 74]];
const total = items.reduce((sum, [, cost]) => sum + cost, 0);
const headers = ["Expense", "Cost (USD)", "Share of total"];
mae.spreadsheet("Weekend Trip Budget.xlsx", [
    headers, ...items.map(([name, cost]) => [name, cost, cost / total]), ["Total", total, 1],
], {formats: ["general", "usd", "percent"], total_row: true});
mae.document("Weekend Trip Summary.pdf", "Weekend trip budget", [
    {heading: "Expense breakdown", text: "", table: {
        headers, rows: items.map(([name, cost]) => [name, "$" + cost, (cost / total * 100).toFixed(1) + "%"]),
    }},
], {summary: "Total estimated cost: $" + total + ". Hotel is the largest expense.", max_pages: 1});
return {total};
"""


def budget_files():
    pytest.importorskip("quickjs")
    from codemode.runner import app

    response = TestClient(app).post("/execute", json={"code": BUDGET_CODE})
    response.raise_for_status()
    output = CodeOutput.model_validate_json(response.content)
    assert output.result == {"total": 525}
    return [render_checked(file) for file in output.files]


def test_code_mode_creates_matching_styled_budget():
    (xlsx, _), (pdf, checks) = budget_files()
    sheet = load_workbook(io.BytesIO(xlsx)).active
    assert sheet["B6"].value == 525 and sheet["B6"].data_type == "n"
    assert sheet["B2"].number_format == '"$"#,##0.00'
    assert sheet["C2"].number_format == "0.0%"
    assert sheet["C2"].value == pytest.approx(240 / 525)
    assert sheet["A1"].font.bold and sheet["A6"].font.bold
    assert sheet.column_dimensions["A"].width >= 14
    document = PdfReader(io.BytesIO(pdf))
    assert checks == {"page_count": 1}
    assert len(document.pages) == 1
    text = document.pages[0].extract_text()
    assert "$525" in text and "Expense breakdown" in text and "Train tickets" in text


def test_pdf_rejects_overflow_before_saving():
    brief = DocumentFile(
        kind="document", name="brief.pdf", title="Long brief", max_pages=1,
        sections=[Section(heading=f"Section {index}", text="A line of text.\n" * 55) for index in range(5)],
    )
    with pytest.raises(ValueError, match="shorten it to one page"):
        render_checked(brief)

# Features

## Workspace

Ask Mae a question, request a calculation, or describe a file to create in
chat. Mae uses DeepSeek V4.1 Flash 1017 and automatically adjusts reasoning effort
for the task with Liquid d1-ultra. Mae can run JavaScript, inspect the result,
and retry or compose several file operations
before answering. Conversations and answers are persisted in Postgres.

For example: “Calculate the total for three items priced at 12, 18, and 25.
Save a spreadsheet with the line items and total, plus a short PDF summary.”

## Artifacts

Generated outputs from conversations, routines, and advanced document jobs
appear in one account-wide library. Code mode can create TXT, Markdown, CSV,
JSON, DOCX, PPTX, PDF, and XLSX files. PowerPoint decks use editable widescreen
layouts and topic-based palettes. Layouts include comparisons, key figures,
process flows, and takeaways. Ask Mae to use generated images from the same
chat on a cover or in a side-by-side or wide-banner layout. PDF and Word
support summaries and tables.
PDF generation checks the rendered page count and can enforce a one-page limit.
Excel supports styled headers and totals, with numeric currency and percentage
formatting. Totals are computed before export; formula strings remain plain text.
Use **Advanced document tools** for uploads, editing, or splitting and merging
PDFs. Files in the library are independent of the conversation history. Use **Preview**
for a read-only PDF view in browsers with a built-in PDF viewer. When the
optional Office service is enabled, use **Edit** to open DOCX, XLSX, and PPTX.
After making changes, click **Save** in the Office toolbar, then **Close editor**
and wait for an “(edited)” copy to appear in Artifacts. Mae keeps the original.
Files over 20 MB cannot be opened in the editor.

## Routines

Save a prompt for later or enable a schedule with a five-field cron expression
and an IANA timezone. **Run now** executes it immediately in the background,
even if scheduled execution is off. The routine uses the same agent and tools
as chat, but starts with only its saved prompt, not your chat history.
Open **View last run** for the result or **Artifacts** for its files. Existing
research, council, and document schedules remain available as legacy routines.

## Jobs

Long-running council, research, document, and routine operations return a
job ID. The application can list jobs, retrieve status, stream progress, and
delete jobs. Redis pub/sub carries live progress while Postgres stores durable
job state.

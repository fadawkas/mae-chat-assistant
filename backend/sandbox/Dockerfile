FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libpango-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir fastapi uvicorn python-docx python-pptx openpyxl weasyprint
WORKDIR /runner
COPY runner.py .
CMD ["uvicorn", "runner:app", "--host", "0.0.0.0", "--port", "9000"]

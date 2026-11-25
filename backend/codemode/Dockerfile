FROM python:3.12-slim
WORKDIR /runner
RUN pip install --no-cache-dir fastapi uvicorn quickjs-ng==0.18.0.2
COPY runner.py .
USER 65534:65534
CMD ["uvicorn", "runner:app", "--host", "0.0.0.0", "--port", "9200", "--limit-concurrency", "8"]

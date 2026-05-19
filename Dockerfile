FROM python:3.11

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

ENV PYTHONUNBUFFERED=1

EXPOSE 7860

CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:7860"]

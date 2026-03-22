# AI Voice Chatbot

A full-stack AI chatbot with realistic voice chat, deployable on **Vercel**.

## Features
- Text chat powered by free GPT API (g4f)
- Realistic AI voice using Microsoft Edge neural TTS (English & Hindi voices)
- Voice input via browser Web Speech API
- Supports English, Hindi, and Hinglish
- ChatGPT-like dark UI

## Deploy on Vercel

1. Fork/clone this repo
2. Go to [vercel.com](https://vercel.com) → New Project → Import this repo
3. Vercel will auto-detect the config from `vercel.json`
4. Click **Deploy** — that's it!

## Local Development

**Backend:**
```bash
cd backend
poetry install
poetry run fastapi dev app/main.py
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

The frontend dev server proxies `/api` requests to `localhost:8000` automatically.

## Tech Stack
- **Backend**: FastAPI + g4f + edge-tts (Python serverless on Vercel)
- **Frontend**: React + TypeScript + Tailwind CSS + Vite

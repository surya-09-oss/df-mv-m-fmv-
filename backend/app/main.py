import base64
import io
import uuid
import asyncio
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

import edge_tts

app = FastAPI(title="AI Voice Chatbot API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory conversation storage
conversations: dict[str, list[dict]] = {}

# Edge TTS voice mapping for realistic neural voices
VOICE_MAP = {
    "en-female": "en-US-JennyNeural",
    "en-male": "en-US-GuyNeural",
    "hi-female": "hi-IN-SwaraNeural",
    "hi-male": "hi-IN-MadhurNeural",
}

DEFAULT_SYSTEM_PROMPT = """You are a friendly, warm, and highly intelligent AI assistant.
You speak naturally like a real person - using casual language, expressions, and emotions.
You can speak in English, Hindi, and Hinglish (a mix of Hindi and English) fluently.
When the user speaks in Hindi or Hinglish, respond in the same language naturally.
When speaking Hindi/Hinglish, use Roman script (not Devanagari) so it can be spoken naturally.
Be conversational, empathetic, and engaging. Use filler words occasionally like "hmm", "well", "you know" to sound natural.
Keep responses concise for voice conversations - aim for 2-3 sentences unless the user asks for detailed explanations.
Never mention that you are an AI unless directly asked. Just be helpful and conversational."""

# Models to try in order of preference (free via g4f)
MODELS_TO_TRY = [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4",
    "gpt-3.5-turbo",
]


async def _try_generate(messages: list[dict]) -> str:
    """Try multiple models/providers via g4f until one succeeds."""
    from g4f.client import AsyncClient

    last_error = None
    for model in MODELS_TO_TRY:
        try:
            client = AsyncClient()
            response = await asyncio.wait_for(
                client.chat.completions.create(
                    model=model,
                    messages=messages,
                ),
                timeout=12,
            )
            content = response.choices[0].message.content
            if content and content.strip():
                return content
        except Exception as e:
            last_error = e
            continue

    raise HTTPException(
        status_code=503,
        detail=f"All AI providers are currently unavailable. Last error: {str(last_error)}"
    )


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    language: str = "en"


class ChatResponse(BaseModel):
    reply: str
    conversation_id: str


class TTSRequest(BaseModel):
    text: str
    voice: str = "en-female"
    rate: str = "+0%"
    pitch: str = "+0Hz"


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.get("/api/voices")
async def get_voices():
    return {
        "voices": [
            {"id": "en-female", "name": "Jenny (English Female)", "language": "English"},
            {"id": "en-male", "name": "Guy (English Male)", "language": "English"},
            {"id": "hi-female", "name": "Swara (Hindi Female)", "language": "Hindi"},
            {"id": "hi-male", "name": "Madhur (Hindi Male)", "language": "Hindi"},
        ]
    }


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    conv_id = req.conversation_id or str(uuid.uuid4())

    if conv_id not in conversations:
        conversations[conv_id] = [
            {"role": "system", "content": DEFAULT_SYSTEM_PROMPT}
        ]

    conversations[conv_id].append({"role": "user", "content": req.message})

    # Keep conversation history manageable (last 20 messages + system prompt)
    if len(conversations[conv_id]) > 21:
        conversations[conv_id] = [conversations[conv_id][0]] + conversations[conv_id][-20:]

    reply = await _try_generate(conversations[conv_id])

    conversations[conv_id].append({"role": "assistant", "content": reply})

    return ChatResponse(reply=reply, conversation_id=conv_id)


@app.post("/api/tts")
async def text_to_speech(req: TTSRequest):
    voice = VOICE_MAP.get(req.voice, VOICE_MAP["en-female"])

    try:
        communicate = edge_tts.Communicate(
            text=req.text,
            voice=voice,
            rate=req.rate,
            pitch=req.pitch,
        )

        audio_data = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.write(chunk["data"])

        audio_data.seek(0)

        return StreamingResponse(
            audio_data,
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=speech.mp3"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {str(e)}")


@app.post("/api/chat-and-speak")
async def chat_and_speak(req: ChatRequest):
    """Combined endpoint: get AI response and convert to speech in one call."""
    chat_response = await chat(req)

    voice_key = f"{req.language}-female"
    if voice_key not in VOICE_MAP:
        voice_key = "en-female"

    voice = VOICE_MAP[voice_key]

    try:
        communicate = edge_tts.Communicate(
            text=chat_response.reply,
            voice=voice,
            rate="+5%",
        )

        audio_data = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.write(chunk["data"])

        audio_data.seek(0)
        audio_b64 = base64.b64encode(audio_data.read()).decode("utf-8")

        return JSONResponse({
            "reply": chat_response.reply,
            "conversation_id": chat_response.conversation_id,
            "audio_base64": audio_b64,
            "audio_mime": "audio/mpeg",
        })
    except Exception:
        return JSONResponse({
            "reply": chat_response.reply,
            "conversation_id": chat_response.conversation_id,
            "audio_base64": None,
            "audio_mime": None,
            "tts_error": "Voice synthesis temporarily unavailable",
        })


@app.delete("/api/conversation/{conversation_id}")
async def delete_conversation(conversation_id: str):
    if conversation_id in conversations:
        del conversations[conversation_id]
    return {"status": "ok"}

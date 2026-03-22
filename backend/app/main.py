import base64
import io
import uuid
import asyncio
import logging
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

import edge_tts

logger = logging.getLogger(__name__)

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

# Expanded, high-quality Edge TTS neural voices for realistic speech
VOICE_MAP = {
    "en-female": "en-US-JennyNeural",
    "en-male": "en-US-GuyNeural",
    "en-female-aria": "en-US-AriaNeural",
    "en-female-sara": "en-US-SaraNeural",
    "en-male-davis": "en-US-DavisNeural",
    "en-male-tony": "en-US-TonyNeural",
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

# Verified working no-auth providers (tested live).
# Split into tiers: tier 1 is tried in parallel for speed,
# tier 2 is tried sequentially as fallback.
TIER1_PROVIDERS = [
    {"provider": "PollinationsAI", "model": "openai"},
    {"provider": "DeepInfra", "model": "MiniMaxAI/MiniMax-M2.5"},
    {"provider": "Yqcloud", "model": "gpt-4"},
]

TIER2_PROVIDERS = [
    {"provider": "OperaAria", "model": "aria"},
    {"provider": "Qwen_Qwen_3", "model": "qwen-3-235b"},
    # Auto-select fallback
    {"provider": None, "model": "gpt-4o-mini"},
    {"provider": None, "model": "gpt-3.5-turbo"},
]


async def _call_provider(messages: list[dict], config: dict, timeout: int = 10) -> str:
    """Call a single provider and return the response text, or raise on failure."""
    from g4f.client import AsyncClient
    import g4f.Provider as Provider

    prov_name = config["provider"]
    prov = getattr(Provider, prov_name) if prov_name else None
    client = AsyncClient(provider=prov) if prov else AsyncClient()
    response = await asyncio.wait_for(
        client.chat.completions.create(messages=messages, model=config["model"]),
        timeout=timeout,
    )
    content = response.choices[0].message.content
    if not content or not content.strip():
        raise ValueError(f"Provider {prov_name or 'auto'} returned empty content")
    return content.strip()


async def _try_generate(messages: list[dict]) -> str:
    """Try providers via g4f: tier 1 in parallel (first wins), then tier 2 sequentially."""

    # Tier 1: race top providers in parallel — first successful response wins
    tasks = [
        asyncio.create_task(_call_provider(messages, cfg, timeout=12))
        for cfg in TIER1_PROVIDERS
    ]
    done: set[asyncio.Task[str]] = set()
    pending = set(tasks)
    last_error: Exception | None = None

    while pending:
        finished, pending = await asyncio.wait(
            pending, return_when=asyncio.FIRST_COMPLETED
        )
        success_result = None
        for task in finished:
            done.add(task)
            exc = task.exception()
            if exc is None:
                if success_result is None:
                    success_result = task.result()
            else:
                last_error = exc
                logger.warning("Tier1 provider failed: %s", exc)
        if success_result is not None:
            for p in pending:
                p.cancel()
            return success_result

    # Tier 2: sequential fallback
    for config in TIER2_PROVIDERS:
        try:
            return await _call_provider(messages, config, timeout=12)
        except Exception as e:
            last_error = e
            logger.warning(
                "Tier2 provider %s failed: %s", config.get("provider", "auto"), e
            )
            continue

    raise HTTPException(
        status_code=503,
        detail=f"All AI providers are currently unavailable. Last error: {last_error}",
    )


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    language: str = "en"
    voice: str = "en-female"


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
            {"id": "en-female-aria", "name": "Aria (English Female)", "language": "English"},
            {"id": "en-female-sara", "name": "Sara (English Female)", "language": "English"},
            {"id": "en-male-davis", "name": "Davis (English Male)", "language": "English"},
            {"id": "en-male-tony", "name": "Tony (English Male)", "language": "English"},
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
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")


@app.post("/api/chat-and-speak")
async def chat_and_speak(req: ChatRequest):
    """Combined endpoint: get AI response and convert to speech in one call."""
    chat_response = await chat(req)

    # Use the voice from the request, falling back to language-based default
    voice_key = req.voice
    if voice_key not in VOICE_MAP:
        voice_key = f"{req.language}-female"
    if voice_key not in VOICE_MAP:
        voice_key = "en-female"

    voice = VOICE_MAP[voice_key]

    try:
        communicate = edge_tts.Communicate(
            text=chat_response.reply,
            voice=voice,
            rate="+5%",
            pitch="+0Hz",
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

import json
import mimetypes
import os
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field

load_dotenv(".env.local")
load_dotenv()

GEMINI_MODEL = "gemini-2.5-flash"
MAX_AUDIO_BYTES = 4 * 1024 * 1024  # 4 MB limit (Vercel payload safety margin)
MAX_HISTORY_TURNS = 6
ALLOWED_LEVELS = {"A1", "A2", "B1", "B2", "C1"}

SUPPORTED_AUDIO_MIME_TYPES = {
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    "audio/mpeg",
    "audio/aac",
    "audio/flac",
}

MIME_ALIASES = {
    "audio/x-m4a": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/mp4a-latm": "audio/mp4",
    "audio/aacp": "audio/aac",
    "video/mp4": "audio/mp4",
    "video/webm": "audio/webm",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/mp3": "audio/mpeg",
}

EXTENSION_MIME_FALLBACK = {
    ".webm": "audio/webm",
    ".mp4": "audio/mp4",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
}

SYSTEM_PROMPT_TEMPLATE = """You are a friendly, natural, native English conversation tutor helping a Spanish-speaking student practice speaking.

STUDENT LEVEL: {level} (CEFR standard).
Adapt your vocabulary, grammar complexity, and expressions strictly to this level:
- A1/A2: Use simple, everyday vocabulary and short, clear sentences.
- B1/B2: Use natural conversational English, common phrasal verbs, and moderate complexity.
- C1: Use idiomatic expressions, nuanced vocabulary, and natural native phrasing.

RULES:
1. Listen carefully to the user's audio (both grammar and pronunciation).
2. Transcribe accurately what the user actually said in `user_transcript` (do not silently fix their mistakes in the transcript).
3. Respond naturally to the conversation in `reply_en`. Keep it concise (1 to 3 short sentences) and encourage the conversation to continue with a natural follow-up question.
4. Only set `has_error` to true if there is a clear grammatical, vocabulary, or pronunciation mistake. Do not nitpick minor filler words.
5. If `has_error` is true, explain the correction clearly, briefly, and encouragingly in Spanish in `correction_es`, showing the corrected phrase. Otherwise, return null.
6. Only fill `pronunciation_tip` (in Spanish) if you actually hear a noticeable pronunciation issue in the audio. Otherwise, return null.
7. Never mix Spanish into `reply_en`. Never mix long English paragraphs into `correction_es`.
"""


class TutorResponse(BaseModel):
    user_transcript: str = Field(
        description="Faithful transcription of what the user said in the audio."
    )
    reply_en: str = Field(
        description="Natural conversational reply in English (1 to 3 short sentences ending with a follow-up question)."
    )
    has_error: bool = Field(
        description="True if there was a clear grammatical, vocabulary, or pronunciation mistake; otherwise false."
    )
    correction_es: Optional[str] = Field(
        default=None,
        description="Brief, encouraging correction in Spanish if has_error is true; otherwise null.",
    )
    pronunciation_tip: Optional[str] = Field(
        default=None,
        description="Specific pronunciation tip in Spanish only if a noticeable pronunciation issue was heard; otherwise null.",
    )


class HistoryTurn(BaseModel):
    role: Literal["user", "model"]
    text: str


app = FastAPI(title="NatIA API")


def detect_mime_from_bytes(audio_bytes: bytes) -> Optional[str]:
    """Fallback magic-byte inspection for mobile browsers that omit or mislabel content-type."""
    if audio_bytes.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    if len(audio_bytes) >= 12 and audio_bytes[4:8] == b"ftyp":
        return "audio/mp4"
    if audio_bytes.startswith(b"OggS"):
        return "audio/ogg"
    if audio_bytes.startswith(b"RIFF") and audio_bytes[8:12] == b"WAVE":
        return "audio/wav"
    if audio_bytes.startswith(b"fLaC"):
        return "audio/flac"
    if audio_bytes.startswith((b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")):
        return "audio/mpeg"
    return None


def resolve_audio_mime_type(upload: UploadFile, audio_bytes: bytes) -> str:
    """Normalize the uploaded audio MIME type across desktop, Android, and iOS browsers."""
    raw_content_type = (upload.content_type or "").split(";", 1)[0].strip().lower()
    if raw_content_type and raw_content_type != "application/octet-stream":
        normalized = MIME_ALIASES.get(raw_content_type, raw_content_type)
        if normalized in SUPPORTED_AUDIO_MIME_TYPES:
            return normalized

    sniffed = detect_mime_from_bytes(audio_bytes)
    if sniffed:
        return sniffed

    filename = (upload.filename or "").lower()
    _, ext = os.path.splitext(filename)
    if ext in EXTENSION_MIME_FALLBACK:
        return EXTENSION_MIME_FALLBACK[ext]

    guessed_type, _ = mimetypes.guess_type(filename)
    if guessed_type:
        normalized_guess = MIME_ALIASES.get(guessed_type.lower(), guessed_type.lower())
        if normalized_guess in SUPPORTED_AUDIO_MIME_TYPES:
            return normalized_guess

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            f"Formato de audio no soportado ('{upload.content_type or 'desconocido'}'). "
            "Formatos válidos: webm, mp4/m4a, ogg, wav, mp3, aac, flac."
        ),
    )


def parse_history(raw_history: str) -> list[HistoryTurn]:
    """Parse and validate recent conversation history JSON (capped to last 6 turns)."""
    try:
        decoded = json.loads(raw_history)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El campo 'history' no contiene un JSON válido.",
        ) from exc

    if not isinstance(decoded, list):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El campo 'history' debe ser una lista JSON de turnos.",
        )

    turns: list[HistoryTurn] = []
    for item in decoded[-MAX_HISTORY_TURNS:]:
        try:
            turn = HistoryTurn.model_validate(item)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cada turno del historial debe incluir 'role' ('user' o 'model') y 'text'.",
            ) from exc
        if turn.text.strip():
            turns.append(turn)

    return turns


@app.get("/api/health")
@app.get("/health")
def health_check() -> dict[str, object]:
    """Return basic service health status and whether GEMINI_API_KEY is configured."""
    has_key = bool((os.environ.get("GEMINI_API_KEY") or "").strip().strip("\"'"))
    return {
        "status": "ok",
        "app": "NatIA",
        "model": GEMINI_MODEL,
        "api_key_configured": has_key,
    }


@app.post("/api/chat", response_model=TutorResponse)
@app.post("/chat", response_model=TutorResponse)
async def chat_with_tutor(
    audio: UploadFile = File(...),
    level: str = Form("B1"),
    history: str = Form("[]"),
) -> TutorResponse:
    """Process user audio, apply CEFR level and conversation history, and return structured tutor feedback."""
    normalized_level = level.strip().upper()
    if normalized_level not in ALLOWED_LEVELS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Nivel MCER inválido '{level}'. Valores permitidos: A1, A2, B1, B2, C1.",
        )

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="El archivo de audio llegó vacío. Intenta grabar de nuevo.",
        )

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail="El archivo de audio supera el límite de 4 MB.",
        )

    mime_type = resolve_audio_mime_type(audio, audio_bytes)
    recent_turns = parse_history(history)

    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip().strip("\"'")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Falta configurar la variable de entorno GEMINI_API_KEY en el servidor (Vercel).",
        )

    contents: list[types.Content] = [
        types.Content(
            role=turn.role,
            parts=[types.Part.from_text(text=turn.text)],
        )
        for turn in recent_turns
    ]
    contents.append(
        types.Content(
            role="user",
            parts=[types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)],
        )
    )

    system_instruction = SYSTEM_PROMPT_TEMPLATE.format(level=normalized_level)

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_schema=TutorResponse,
            ),
        )
    except genai_errors.APIError as exc:
        if exc.code == 429:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Se alcanzó el límite de cuota de Gemini API. Espera unos segundos e inténtalo de nuevo.",
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error de Gemini API ({exc.code}): {exc.message or 'Error inesperado del modelo.'}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al comunicarse con Gemini ({type(exc).__name__}): {exc}",
        ) from exc

    if isinstance(response.parsed, TutorResponse):
        return response.parsed

    if response.text:
        try:
            return TutorResponse.model_validate_json(response.text)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Gemini devolvió una respuesta con formato inesperado.",
            ) from exc

    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Gemini devolvió una respuesta vacía.",
    )

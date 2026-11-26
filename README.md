# NatIA — English Conversation Tutor PWA

Aplicación Web Progresiva (PWA) para practicar conversación en inglés con una tutora nativa impulsada por **Google Gemini (`gemini-3.8-flash` / `gemini-3.8-flash-lite`)**. Combina interacción de voz estilo *Walkie-Talkie* en inglés con retroalimentación gramatical y de pronunciación en español.

> **Fuente de verdad técnica:** [reglas.md](./reglas.md)

---

## Estado Actual del Proyecto

### Sprint 1 — MVP Funcional (Completado)
- **Interfaz Mobile-First en Modo Oscuro (`#090D16`):**
  - **Orbe central interactivo (`NatiaOrb.tsx`):** Animación fluida en Canvas 2D con 5 anillos concéntricos reactivos al estado (`idle`, `listening`, `thinking`, `speaking`) y al nivel real de audio del micrófono (`AudioContext` + `AnalyserNode`). Funciona como botón principal *Walkie-Talkie*.
  - **Selector de nivel MCER (`LevelSelector.tsx`):** Cambio dinámico entre `A1`, `A2`, `B1`, `B2` y `C1`.
  - **Historial y tarjetas de corrección (`MessageList.tsx`):** Muestra la transcripción de lo que dijo el usuario (`user_transcript`), la respuesta en inglés de NatIA (`reply_en`) con botón para repetir el audio, y tarjetas en tono ámbar suave para correcciones en español (`correction_es`) y consejos de pronunciación (`pronunciation_tip`).
- **Captura de Audio Multiplataforma (`useAudioRecorder.ts`):**
  - Detección dinámica de MIME type (`audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`) compatible con Chrome, Android, Edge y Safari en iOS/macOS.
  - Límite automático de seguridad de **60 segundos** por turno y bitrate optimizado (`64 kbps`) para cumplir con el límite de payload de Vercel.
- **Síntesis de Voz (`useSpeech.ts`):**
  - Reproducción automática de `reply_en` mediante `Web Speech API` (`speechSynthesis`), seleccionando la mejor voz en inglés disponible (`en-US` / `en-GB`).
  - Desbloqueo silencioso en la primera interacción del usuario para compatibilidad con iOS Safari y pulsos por palabra (`onboundary`) sincronizados con el orbe.
- **Backend Serverless con FastAPI y Gemini (`api/index.py`):**
  - Endpoint `GET /api/health` de verificación de estado.
  - Endpoint `POST /api/chat` (`multipart/form-data`) que procesa los bytes de audio junto con el nivel MCER y los últimos **6 turnos** de historial.
  - Integración con el SDK oficial `google-genai`, cadena automática de modelos de respaldo (`gemini-3.8-flash` → `gemini-3.8-flash-lite`) ante picos de demanda (`503`) o límites de cuota (`429`), y **Structured Outputs** validados con Pydantic (`TutorResponse`).
- **PWA Instalable (`vite-plugin-pwa`):**
  - Generación automática de `manifest.json`, *Service Worker* (`sw.js`) e iconos en `public/`.

### Sprint 2 — Backlog (Pendiente)
- Test de nivelación adaptativo local en JSON (sin consumo de tokens).
- Persistencia de sesiones y errores frecuentes (`IndexedDB` o base de datos en la nube).
- Voces neuronales en el backend (`edge-tts`).
- Selector de escenarios de conversación (entrevista, viaje, charla casual).

---

## Stack Tecnológico

| Capa | Tecnología | Detalles |
| :--- | :--- | :--- |
| **Frontend** | React 19 + Vite 6 + TypeScript | Tipado estricto (`strict: true`). |
| **Estilos** | Tailwind CSS v4 (`@tailwindcss/vite`) | Modo oscuro por defecto (`#090D16`), diseño *mobile-first*. |
| **PWA** | `vite-plugin-pwa` | `manifest.json` + Service Worker (`generateSW`). |
| **Audio Entrada** | `MediaRecorder API` + `Web Audio API` | Detección dinámica de formato + análisis RMS en tiempo real. |
| **Audio Salida** | `Web Speech API` (`speechSynthesis`) | Selección automática de voz `en-US` / `en-GB` + warm-up iOS. |
| **Backend** | Python + FastAPI | Función Serverless en `/api/index.py`. |
| **IA** | `google-genai` (`gemini-3.8-flash` / `gemini-3.8-flash-lite`) | Audio multimodal + `response_schema=TutorResponse` (Pydantic v2). |
| **Despliegue** | Vercel | Frontend estático + FastAPI Serverless en el mismo repositorio. |

---

## Estructura del Repositorio

```text
NatIA/
├── api/
│   └── index.py                   # App FastAPI (GET /api/health y POST /api/chat)
├── public/
│   ├── pwa-192x192.png            # Icono PWA 192x192
│   └── pwa-512x512.png            # Icono PWA 512x512
├── src/
│   ├── components/
│   │   ├── LevelSelector.tsx      # Selector de nivel MCER (A1 - C1)
│   │   ├── MessageList.tsx        # Historial de conversación + tarjetas ámbar de corrección
│   │   └── NatiaOrb.tsx           # Orbe animado en Canvas 2D y botón Walkie-Talkie
│   ├── hooks/
│   │   ├── useAudioRecorder.ts    # Grabación de micrófono, nivel RMS y límite de 60s
│   │   └── useSpeech.ts           # Web Speech API (TTS), desbloqueo iOS y pulsos de voz
│   ├── services/
│   │   └── api.ts                 # Cliente HTTP para POST /api/chat y manejo de errores
│   ├── types/
│   │   └── chat.ts                # Tipos e interfaces (Level, OrbState, TutorResponse, etc.)
│   ├── App.tsx                    # Interfaz principal y flujo de sesión
│   ├── index.css                  # Configuración de Tailwind CSS y animaciones base
│   ├── main.tsx                   # Punto de entrada de React
│   └── vite-env.d.ts              # Tipos de cliente Vite
├── .env.example                   # Plantilla de variables de entorno (GEMINI_API_KEY=)
├── .gitignore                     # Archivos ignorados por Git
├── index.html                     # HTML base en modo oscuro con viewport-fit=cover
├── package.json                   # Scripts y dependencias del frontend
├── reglas.md                      # Especificación técnica y fuente de verdad del proyecto
├── requirements.txt               # Dependencias livianas de Python para Sprint 1
├── tsconfig.json                  # Configuración raíz de TypeScript
├── vercel.json                    # Rewrites de Vercel (/api/* -> FastAPI, resto -> SPA)
└── vite.config.ts                 # Configuración de Vite, proxy local /api y PWA
```

---

## Contrato de la API

### `GET /api/health`
Verifica que el backend esté activo y que la variable `GEMINI_API_KEY` esté configurada en el entorno (útil para diagnosticar despliegues en Vercel desde el navegador).
- **Respuesta `200 OK`:**
  ```json
  {
    "status": "ok",
    "app": "NatIA",
    "model": "gemini-3.8-flash",
    "fallback_models": ["gemini-3.8-flash", "gemini-3.8-flash-lite"],
    "api_key_configured": true
  }
  ```

### `POST /api/chat`
Recibe `multipart/form-data` con:
- `audio` (`File`, obligatorio): Audio grabado (`webm`, `mp4`/`m4a`, `ogg`, `wav`, `mp3`, `aac`, `flac`), máximo **4 MB**.
- `level` (`string`, por defecto `"B1"`): Nivel MCER (`"A1"`, `"A2"`, `"B1"`, `"B2"`, `"C1"`).
- `history` (`string`, por defecto `"[]"`): JSON string con los últimos turnos (`role`: `"user" | "model"`, `text`: `string`). El backend toma como máximo los últimos **6 turnos**.

- **Respuesta `200 OK` (`TutorResponse`):**
  ```json
  {
    "user_transcript": "Yesterday I go to the supermarket with my brother.",
    "reply_en": "Nice! What did you end up buying at the supermarket?",
    "has_error": true,
    "correction_es": "Dijiste 'I go', pero como hablas de ayer (pasado), debes usar 'I went': 'Yesterday I went to the supermarket...'.",
    "pronunciation_tip": "En 'supermarket', recuerda marcar el acento en la primera sílaba: SU-per-mar-ket."
  }
  ```

---

## Configuración y Ejecución en Local

### 1. Variables de entorno
Crea un archivo `.env.local` (o `.env`) en la raíz del proyecto a partir de `.env.example`:

```env
GEMINI_API_KEY=tu_api_key_de_google_ai_studio
```

*(Nunca expongas la clave con prefijo `VITE_`; solo el backend en Python lee `GEMINI_API_KEY`).*

### 2. Instalar dependencias

**Frontend (Node.js):**
```powershell
npm install
```

**Backend (Python 3.11+):**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. Levantar entorno de desarrollo

**Terminal 1 — Backend FastAPI (`http://127.0.0.1:8000`):**
```powershell
.\venv\Scripts\Activate.ps1
uvicorn api.index:app --reload --port 8000
```
- Documentación interactiva Swagger UI: `http://127.0.0.1:8000/docs`

**Terminal 2 — Frontend Vite (`http://localhost:5173`):**
```powershell
npm run dev
```
- Vite redirige automáticamente todas las peticiones a `/api` hacia `http://127.0.0.1:8000`.

### 4. Compilación de producción
```powershell
npm run build
```

---

## Despliegue en Vercel

1. Conecta el repositorio en Vercel.
2. En **Project Settings → Environment Variables**, agrega `GEMINI_API_KEY` (para Production, Preview y Development) y realiza un **Redeploy**.
   - *(Importante: los archivos `.env` y `.env.local` están en `.gitignore` y no se suben a Vercel; si falta la variable en el panel de Vercel, `/api/chat` devolverá HTTP 500).*
3. Verifica en tu navegador móvil `https://<tu-dominio>.vercel.app/api/health`: debe responder `{"status":"ok","app":"NatIA","model":"gemini-3.8-flash","fallback_models":["gemini-3.8-flash","gemini-3.8-flash-lite"],"api_key_configured":true}`.
4. Vercel usará automáticamente `vercel.json` para servir `/api/(.*)` mediante la función serverless `api/index.py` (que acepta tanto `/api/chat` como `/chat`) y el resto de rutas con el build estático de React (`dist/`).

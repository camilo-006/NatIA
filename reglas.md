# Especificación Técnica y Reglas del Proyecto (English Tutor PWA)

Este documento es la **fuente única de verdad** para el desarrollo del proyecto. Define la arquitectura, el contrato de la API, el comportamiento de la IA y las convenciones que deben seguir todos los desarrolladores y agentes (incluido Antigravity).

---

## 1. Visión y Alcance

Aplicación web progresiva (PWA) diseñada para practicar conversación en inglés con un tutor nativo impulsado por IA (Gemini), combinando respuestas habladas en inglés con correcciones precisas en español.

### Sprint 1: MVP Funcional (Alcance Actual)
* **Modo Walkie-Talkie:** Grabar audio desde el micrófono (móvil o escritorio), enviarlo al backend y recibir respuesta hablada + escrita.
* **Nivelación manual temporal:** Selector rápido de nivel MCER (`A1`, `A2`, `B1`, `B2`, `C1`) antes o durante la sesión.
* **Contexto en memoria:** Mantener el hilo de la conversación durante la sesión activa (sin base de datos).
* **Salida de voz (TTS):** Reproducción automática de la respuesta en inglés usando `Web Speech API` (`speechSynthesis`), con botón para repetir el audio.
* **PWA instalable:** Configuración completa de `manifest.json`, iconos y *Service Worker* para instalar en pantalla de inicio (Android / iOS) desplegado bajo HTTPS en Vercel.

### Sprint 2: Backlog (Fuera de alcance en Sprint 1)
* Test de nivelación adaptativo (lógica determinista local en JSON, sin consumo de tokens).
* Persistencia de sesiones y errores frecuentes (`IndexedDB` o base de datos en la nube).
* Mejora de salida de voz a voces neuronales en el backend (`edge-tts`).
* Selector de escenarios de conversación (entrevista, viaje, charla casual).

---

## 2. Stack Tecnológico

| Capa | Tecnología | Notas Clave |
| :--- | :--- | :--- |
| **Frontend** | React + Vite + TypeScript | Tipado estricto (`strict: true`). |
| **Estilos** | Tailwind CSS | Diseño *mobile-first*, minimalista, modo oscuro por defecto. |
| **PWA** | `vite-plugin-pwa` | Generación automática de `manifest.json` y *Service Worker*. |
| **Backend** | Python + FastAPI | Desplegado como Vercel Serverless Function en `/api`. |
| **SDK IA** | `google-genai` (SDK oficial) | Modelo obligatorio: `gemini-2.5-flash` (baja latencia). |
| **Validación** | Pydantic v2 | Usado para *Structured Outputs* nativos con Gemini. |
| **Audio Entrada** | `MediaRecorder API` | Detección dinámica de MIME type (`audio/webm` o `audio/mp4`). |
| **Audio Salida** | `Web Speech API` | Solo lee el campo `reply_en` con voz en inglés (`en-US`). |
| **Hosting** | Vercel (Free Tier) | Frontend estático + Backend Serverless en el mismo repositorio. |

---

## 3. Estructura del Repositorio

```text
english-tutor-pwa/
├── api/
│   └── index.py               # Aplicación FastAPI (rutas /api/health y /api/chat)
├── public/
│   ├── pwa-192x192.png        # Icono PWA 192x192
│   └── pwa-512x512.png        # Icono PWA 512x512
├── src/
│   ├── components/
│   │   ├── LevelSelector.tsx  # Selector de nivel A1-C1
│   │   ├── MessageList.tsx    # Historial de conversación + tarjetas de corrección
│   │   └── RecordButton.tsx   # Botón Walkie-Talkie con estados visuales
│   ├── hooks/
│   │   ├── useRecorder.ts     # Lógica de micrófono, permisos y límite de 60s
│   │   └── useSpeech.ts       # Lógica de Web Speech API y desbloqueo en iOS
│   ├── services/
│   │   └── api.ts             # Cliente HTTP para POST /api/chat
│   ├── types/
│   │   └── chat.ts            # Interfaces compartidas (Contrato API)
│   ├── App.tsx
│   └── main.tsx
├── .env.local                 # GEMINI_API_KEY (ignorado por Git)
├── .env.example               # Plantilla de variables de entorno
├── requirements.txt           # fastapi, google-genai, python-multipart, pydantic
├── vercel.json                # Reglas de enrutamiento para Vercel
├── vite.config.ts             # Vite + proxy local + vite-plugin-pwa
├── package.json
└── SPEC.md                    # Este documento
```

---

## 4. Contrato de la API

El frontend **nunca** se comunica directamente con la API de Google. Todas las peticiones pasan por FastAPI.

### `GET /api/health`
Endpoint de verificación para comprobar que la función serverless está activa.
* **Respuesta `200 OK`:**
  ```json
  { "status": "ok", "model": "gemini-2.5-flash" }
  ```

### `POST /api/chat`
Recibe el audio del usuario junto con el nivel y el historial reciente.

* **Content-Type:** `multipart/form-data`
* **Campos del Request:**
  * `audio` (`File`, obligatorio): Archivo de audio grabado (`audio/webm`, `audio/mp4`, `audio/ogg` o `audio/wav`). Peso máximo recomendado: `< 4 MB`.
  * `level` (`string`, obligatorio): Nivel MCER del usuario. Valores permitidos: `"A1"`, `"A2"`, `"B1"`, `"B2"`, `"C1"`.
  * `history` (`string`, opcional): Cadena JSON representando los últimos turnos de la conversación (máximo últimos **6 turnos** para controlar tokens y latencia).
    ```json
    [
      { "role": "user", "text": "Hello, I want to practice my English." },
      { "role": "model", "text": "Hi there! I'd love to help. What did you do today?" }
    ]
    ```

* **Respuesta `200 OK` (`application/json`):**
  Este esquema **debe coincidir exactamente** entre el modelo `TutorResponse` de Pydantic (Backend) y la interfaz `TutorResponse` de TypeScript (Frontend):
  ```json
  {
    "user_transcript": "Yesterday I go to the supermarket with my brother.",
    "reply_en": "Nice! What did you end up buying at the supermarket?",
    "has_error": true,
    "correction_es": "Dijiste 'I go', pero como hablas de ayer (pasado), debes usar 'I went': 'Yesterday I went to the supermarket...'.",
    "pronunciation_tip": "En 'supermarket', recuerda marcar el acento en la primera sílaba: SU-per-mar-ket."
  }
  ```

* **Definición de campos:**
  * `user_transcript` (`string`): Transcripción fiel de lo que dijo el usuario en el audio.
  * `reply_en` (`string`): Respuesta natural y conversacional en inglés (1 a 3 frases máximo, siempre terminando con una pregunta o gancho para mantener viva la charla).
  * `has_error` (`boolean`): `true` si hubo algún error gramatical, de vocabulario o pronunciación relevante; `false` si la frase fue correcta y natural.
  * `correction_es` (`string | null`): Explicación breve, clara y amigable en español. Debe ser `null` si `has_error` es `false`.
  * `pronunciation_tip` (`string | null`): Consejo puntual de pronunciación en español solo si se detectó un fallo claro en el audio; de lo contrario `null`.

* **Errores esperados:**
  * `400 Bad Request`: Audio vacío, formato no soportado o nivel inválido.
  * `413 Payload Too Large`: Archivo excede el límite permitido.
  * `500 Internal Server Error`: Error de comunicación con Gemini o falta de `GEMINI_API_KEY`.

---

## 5. System Prompt y Comportamiento de la IA

El backend debe construir el `system_instruction` inyectando dinámicamente el `{level}` recibido y forzar la salida con `response_mime_type="application/json"` y `response_schema=TutorResponse`.

### Plantilla del System Prompt
```text
You are a friendly, natural, native English conversation tutor helping a Spanish-speaking student practice speaking.

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
```

---

## 6. Reglas de Infraestructura, Entorno y Restricciones

### Restricciones de Vercel (Free Tier)
1. **Timeout de 10 segundos:** Toda la petición `/api/chat` debe completarse rápido. Por eso es obligatorio usar `gemini-2.5-flash`, limitar el historial a los últimos 6 turnos y mantener `reply_en` conciso.
2. **Límite de payload de 4.5 MB:** El frontend debe limitar las grabaciones a un máximo de **60 segundos** por turno y usar compresión nativa del navegador (`MediaRecorder` con bitrate por defecto o `audioBitsPerSecond: 64000`).
3. **Dependencias livianas:** Mantener `requirements.txt` mínimo para reducir el *cold start* de Python en Vercel.

### Configuración de Entorno Local y Producción
* **Variables de entorno:**
  * Backend lee `GEMINI_API_KEY` mediante `os.environ.get("GEMINI_API_KEY")`.
  * **Prohibido** crear variables `VITE_GEMINI_API_KEY` o exponer la clave en el cliente.
* **Proxy en desarrollo local (`vite.config.ts`):**
  * Configurar `server.proxy` para redirigir `/api` hacia `http://127.0.0.1:8000` (donde corre `uvicorn api.index:app --reload`). Así el frontend siempre hace `fetch('/api/chat')` sin cambiar URLs entre local y producción y sin problemas de CORS.
* **Enrutamiento en producción (`vercel.json`):**
  * Todas las rutas `/api/(.*)` van a `/api/index.py`.
  * Todas las demás rutas van al `index.html` de la SPA (React).

### Compatibilidad Móvil (Android + iOS Safari)
1. **Detección de formato de audio (`useRecorder.ts`):**
   * Comprobar en orden con `MediaRecorder.isTypeSupported(...)`:
     1. `audio/webm;codecs=opus` (Chrome / Android / Edge)
     2. `audio/webm`
     3. `audio/mp4` (Safari / iOS)
   * Enviar el `mimeType` real al backend para que Gemini lo procese correctamente.
2. **Desbloqueo de audio en iOS (`useSpeech.ts`):**
   * iOS Safari bloquea `speechSynthesis.speak()` si no se inicia tras una interacción del usuario. Al presionar el botón de grabar o un botón inicial, ejecutar un *warm-up* silencioso de `speechSynthesis` y seleccionar preferiblemente una voz en inglés (`en-US` o `en-GB`).
3. **Permisos de micrófono:**
   * Manejar explícitamente el rechazo de permisos (`NotAllowedError`) mostrando un mensaje claro al usuario en pantalla.

---

## 7. Convenciones de Código y UI/UX

* **Idioma del código:** Nombres de archivos, variables, funciones, interfaces, endpoints y comentarios técnicos en **inglés**.
* **Idioma de la interfaz (UI):** Etiquetas, botones, mensajes de error y correcciones en **español**; las burbujas de conversación del tutor y transcripción del usuario en **inglés**.
* **Diseño UI (Sprint 1):**
  * Enfoque *mobile-first* (pensado para usarse con una sola mano en el celular).
  * Modo oscuro limpio y minimalista.
  * Botón Walkie-Talkie grande y centrado en la parte inferior con estados visuales claros: `Inactivo` -> `Grabando (con temporizador)` -> `Pensando (loader)` -> `Hablando (indicador de voz + botón detener/repetir)`.
  * Tarjeta de corrección en español visualmente diferenciada debajo de la respuesta en inglés (solo se renderiza si `has_error === true` o `pronunciation_tip !== null`).
* **Calidad:** No dejar `console.log` de depuración en producción, manejar siempre estados de carga (`isLoading`) y errores de red con mensajes amigables en la UI.
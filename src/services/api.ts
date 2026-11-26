import type { HistoryTurn, Level, TutorResponse } from '../types/chat';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function messageForStatus(status: number, serverDetail?: string): string {
  if (serverDetail) {
    return serverDetail;
  }
  switch (status) {
    case 400:
      return 'No pude procesar tu audio. Intenta grabar de nuevo.';
    case 404:
    case 405:
      return `El endpoint /api/chat no respondió en el servidor (HTTP ${status}). Verifica el despliegue de FastAPI en Vercel.`;
    case 413:
      return 'La grabación es demasiado larga. Intenta con un mensaje más corto.';
    case 429:
      return 'Se alcanzó el límite de uso de la IA. Espera unos segundos e inténtalo otra vez.';
    case 503:
      return 'Los servidores de Gemini están saturados en este momento. Intenta en unos segundos.';
    case 504:
      return 'La respuesta tardó demasiado (timeout de 10s en Vercel). Intenta con un audio más corto.';
    default:
      return `NatIA tuvo un problema al responder (HTTP ${status}). Inténtalo de nuevo en un momento.`;
  }
}

export function extensionForMime(mimeType: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'mp4';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

export async function sendChat(
  audio: Blob,
  mimeType: string,
  level: Level,
  history: HistoryTurn[],
  signal?: AbortSignal,
): Promise<TutorResponse> {
  const baseMime = mimeType.split(';')[0].trim() || 'audio/webm';
  const form = new FormData();
  form.append(
    'audio',
    new File([audio], `recording.${extensionForMime(baseMime)}`, { type: baseMime }),
  );
  form.append('level', level);
  form.append('history', JSON.stringify(history.slice(-6)));

  let response: Response;
  try {
    response = await fetch('/api/chat', { method: 'POST', body: form, signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'No hay conexión con el servidor. Revisa tu internet e inténtalo otra vez.',
      0,
    );
  }

  if (!response.ok) {
    let serverDetail: string | undefined;
    try {
      const errBody = (await response.json()) as { detail?: unknown };
      if (typeof errBody?.detail === 'string' && errBody.detail.trim()) {
        serverDetail = errBody.detail.trim();
      }
    } catch {
      // Response body was not JSON (e.g. Vercel HTML gateway error)
    }
    throw new ApiError(messageForStatus(response.status, serverDetail), response.status);
  }

  try {
    return (await response.json()) as TutorResponse;
  } catch {
    throw new ApiError('La respuesta del servidor no es válida.', response.status);
  }
}

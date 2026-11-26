import type { HistoryTurn, Level, TutorResponse } from '../types/chat';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'No pude procesar tu audio. Intenta grabar de nuevo.';
    case 413:
      return 'La grabación es demasiado larga. Intenta con un mensaje más corto.';
    case 429:
      return 'Se alcanzó el límite de uso de la IA. Espera unos segundos e inténtalo otra vez.';
    default:
      return 'NatIA tuvo un problema al responder. Inténtalo de nuevo en un momento.';
  }
}

export function extensionForMime(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4';
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
  const baseMime = mimeType.split(';')[0] || 'audio/webm';
  const form = new FormData();
  form.append(
    'audio',
    new File([audio], `recording.${extensionForMime(baseMime)}`, { type: mimeType }),
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
    throw new ApiError(messageForStatus(response.status), response.status);
  }

  try {
    return (await response.json()) as TutorResponse;
  } catch {
    throw new ApiError('La respuesta del servidor no es válida.', response.status);
  }
}

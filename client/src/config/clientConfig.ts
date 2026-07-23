export const CLIENT_CONFIG = {
  DEBUG_LATENCY_MS: Number(import.meta.env.VITE_DEBUG_LATENCY_MS) || 0,
  DEBUG_JITTER_MS: Number(import.meta.env.VITE_DEBUG_JITTER_MS) || 0,
  DEBUG_PACKET_LOSS: Number(import.meta.env.VITE_DEBUG_PACKET_LOSS) || 0,
} as const;

const STORAGE_KEY = 'ai_settings_v1';

export type AIModelTier = 'fast' | 'balanced' | 'quality';

export interface AISettings {
  providerPriority: string[];
  specsModelTier: AIModelTier;
  dealSearchModelTier: AIModelTier;
  preferGroqForSpecs: boolean;
}

const DEFAULTS: AISettings = {
  providerPriority: ['groq', 'gemini', 'together', 'mistral', 'ollama'],
  specsModelTier: 'fast',
  dealSearchModelTier: 'balanced',
  preferGroqForSpecs: true,
};

export function loadAISettings(): AISettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAISettings(settings: AISettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/** Map tier to model hints for specs (#93). */
export function specsModelForTier(tier: AIModelTier): string {
  switch (tier) {
    case 'fast':
      return 'llama-3.3-70b-versatile';
    case 'quality':
      return 'gemini-2.0-flash';
    default:
      return 'llama-3.1-8b-instant';
  }
}

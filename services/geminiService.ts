
import { GoogleGenAI, Type } from "@google/genai";
import { InventoryItem, ItemStatus } from "../types";
import { LOCAL_HARDWARE_INDEX, HardwareMetadata } from "./hardwareDB";

// --- AI ENGINE CONFIGURATION ---
// Priority list of models to use for fallback
const MODEL_PRIORITY = [
  'gemini-3-flash-preview',       // Primary: Latest & Greatest
  'gemini-2.0-flash-exp',         // Fallback 1: Stable preview
];

// --- QUOTA TRACKING STATE ---
interface ModelStatus {
  id: string;
  requests: number;
  status: 'HEALTHY' | 'DEPLETED' | 'ERROR';
  lastError?: string;
}

// Initial state for models
let quotaState: Record<string, ModelStatus> = MODEL_PRIORITY.reduce((acc, model) => {
  acc[model] = { id: model, requests: 0, status: 'HEALTHY' };
  return acc;
}, {} as Record<string, ModelStatus>);

// Listeners for quota updates
type QuotaListener = (state: Record<string, ModelStatus>) => void;
const listeners: Set<QuotaListener> = new Set();

const notifyListeners = () => {
  const state = { ...quotaState };
  listeners.forEach(l => l(state));
};

export const subscribeToQuota = (callback: QuotaListener) => {
  listeners.add(callback);
  callback({ ...quotaState }); // Initial emit
  return () => listeners.delete(callback);
};

const updateModelStatus = (model: string, update: Partial<ModelStatus>) => {
  if (quotaState[model]) {
    quotaState[model] = { ...quotaState[model], ...update };
    notifyListeners();
  }
};

// --- AI SETUP ---

const getAI = () => {
  const apiKey = typeof process !== 'undefined' && process.env ? process.env.API_KEY : '';
  if (!apiKey) {
    console.error("API_KEY_MISSING: Ensure process.env.API_KEY is available.");
    throw new Error("API_KEY_MISSING");
  }
  return new GoogleGenAI({ apiKey });
};

// Generic Wrapper for AI Calls with Fallback Logic
async function withAI<T>(
  operation: (ai: GoogleGenAI, model: string) => Promise<T>
): Promise<T> {
  const ai = getAI();
  let lastError: any;

  for (const model of MODEL_PRIORITY) {
    // Skip depleted models unless it's been a while (simple logic: skip if status is DEPLETED)
    // For now, we retry if logic allows, but here we iterate priority.
    
    // Update state to show we are attempting
    updateModelStatus(model, { status: 'HEALTHY' }); // Assume healthy unless fails

    try {
      const result = await operation(ai, model);
      // Success
      const current = quotaState[model];
      updateModelStatus(model, { requests: current.requests + 1, status: 'HEALTHY' });
      return result;
    } catch (error: any) {
      lastError = error;
      // Check for Rate Limit (429) or Resource Exhausted
      const isQuotaError = 
        error.toString().includes('429') || 
        error.status === 429 || 
        error.message?.includes('Resource has been exhausted');

      if (isQuotaError) {
        console.warn(`[AI] Quota exceeded for ${model}. Switching engine...`);
        updateModelStatus(model, { status: 'DEPLETED', lastError: 'Rate Limited (429)' });
        continue; // Try next model in loop
      }
      
      // If it's not a quota error (e.g. invalid key, network), mark error but maybe don't deplete
      // 404 means model not found, so we should probably mark it as ERROR and continue to next model if possible
      if (error.status === 404 || error.toString().includes('404')) {
         console.warn(`[AI] Model ${model} not found (404). Switching...`);
         updateModelStatus(model, { status: 'ERROR', lastError: 'Model Not Found (404)' });
         continue;
      }

      updateModelStatus(model, { status: 'ERROR', lastError: error.message });
      throw error;
    }
  }
  
  console.error("[AI] All engines exhausted.");
  throw lastError;
}

const isAIQuotaExceeded = () => {
  // We no longer block locally, we try fallbacks first
  return false; 
};

// ... Interfaces (unchanged)
export interface PerformanceEstimate {
  gaming: {
    game: string;
    fps_1080p: string;
    fps_1440p: string;
    fps_4k: string;
  }[];
  workstation: {
    task: string;
    score: string;
  }[];
  summary: string;
  bottleneck: string;
}

export interface PriceEstimate {
  itemName: string;
  condition: string;
  currency: string;
  priceLow: number;
  priceHigh: number;
  priceAverage: number;
  confidenceScore: number;
  reasoning: string;
  references: { title: string; price: number; url: string }[];
}

export interface BundleSuggestion {
  title: string;
  componentIds: string[];
  reasoning: string;
  estimatedValue: number;
}

export interface SourcingStrategy {
  title: string;
  targetCategory: string;
  maxBuyPrice: number;
  expectedSellPrice: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  reasoning: string;
}

export interface LiveDeal {
  title: string;
  url: string;
  price: string;
  platform: 'Kleinanzeigen' | 'eBay' | 'Web';
  dateFound: string;
  numericPrice: number;
}

export interface CrossPostContent {
  ebay: { title: string; description: string };
  kleinanzeigen: { title: string; description: string };
  facebook: { title: string; description: string };
}

export interface SavedSearchCriteria {
  id: string;
  query: string;
  maxPrice: number;
  includeEbay: boolean;
  customUrl?: string;
  lastRun?: string;
}

// ... Implementation

export const estimateMarketValue = async (itemName: string, condition: string = 'Used'): Promise<PriceEstimate | null> => {
  try {
    return await withAI(async (ai, model) => {
      const prompt = `
        Act as a professional German pricing expert for electronics.
        Real-time market search for: "${itemName}" (${condition}).
        
        VERY IMPORTANT RULES:
        - Nutze bei eBay.de ausschließlich die Ansicht "Verkaufte Artikel" / "Beendete Angebote", also nur bereits verkaufte Artikel (keine aktiven Listings).
        - Ignoriere aktive/ungekaufte Angebote und unrealistische Ausreißerpreise.
        - Wenn möglich, nutze mindestens 5–10 verkaufte Artikel als Basis.
        - Falls für genau dieses Modell keine Verkäufe existieren, nimm die nächstliegenden vergleichbaren verkauften Artikel (gleiche Serie / Ausstattung).
        - Du MUSST immer einen sinnvollen Preisbereich und Durchschnitt zurückgeben, auch wenn die Datenlage dünn ist.
        
        Output JSON (alle Preise in EUR):
        {
          "itemName": "${itemName}",
          "condition": "${condition}",
          "currency": "EUR",
          "priceLow": 100,
          "priceHigh": 150,
          "priceAverage": 125,
          "confidenceScore": 85,
          "reasoning": "Brief analysis...",
          "references": [ { "title": "...", "price": 120, "url": "..." } ]
        }
      `;

      const response = await ai.models.generateContent({
        model: model,
        contents: prompt,
        config: { 
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }]
        }
      });

      return JSON.parse(response.text || '{}');
    });
  } catch (error: any) {
    console.error("Price Estimate Error", error);
    return null;
  }
};

const parseGermanPrice = (priceStr: string): number => {
  if (!priceStr) return 0;
  // Remove non-numeric chars except . and ,
  let clean = priceStr.replace(/[^0-9,.]/g, '');
  
  // Edge case: "1.200" -> 1200
  if (clean.includes('.') && !clean.includes(',')) {
     if (clean.indexOf('.') === clean.length - 3) {
        // likely decimal (US)
     } else {
        // likely thousand separator (DE)
        clean = clean.replace(/\./g, '');
     }
  } else if (clean.includes(',')) {
     // German decimal
     clean = clean.replace(/\./g, '').replace(',', '.');
  }
  
  return parseFloat(clean) || 0;
};

export const executeSavedSearch = async (criteria: SavedSearchCriteria): Promise<LiveDeal[]> => {
  try {
    return await withAI(async (ai, model) => {
        const siteFilter = criteria.includeEbay ? "(site:ebay.de OR site:kleinanzeigen.de)" : "site:kleinanzeigen.de";
        
        // IMPROVEMENT: Remove price filter from Google Query. 
        // Strict price operators (e.g. €1..€500) often break Kleinanzeigen results if price isn't indexed perfectly.
        // We filter in JS later.
        const negativeFilters = '-suche -kaufe -"sucht" -"suche grafikkarte"'; 
        const googleQuery = `${criteria.query} ${siteFilter} ${negativeFilters} -intitle:Anzeige`;

        const prompt = `
          Perform a Google Search: ${googleQuery}
          
          Extract sales listings. 
          Important: Look for Price in the snippet (e.g. "50 €", "50€", "50 EUR", "VB").
          
          Return a list of items found.
        `;

        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: { tools: [{ googleSearch: {} }] }
        });

        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        let deals: LiveDeal[] = [];
        const text = response.text || '';
        
        // Regex to catch Markdown links with price: [Title](URL) ... 50€
        const regex = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\).*?([\d.,]+)\s*(?:€|EUR)/gi;
        let match;
        while ((match = regex.exec(text)) !== null) {
          deals.push({
            title: match[1],
            url: match[2],
            price: `€${match[3]}`,
            platform: match[2].includes('kleinanzeigen') ? 'Kleinanzeigen' : 'eBay',
            dateFound: new Date().toISOString(),
            numericPrice: parseGermanPrice(match[3])
          });
        }

        // Fallback to Grounding Chunks if text parsing failed or found nothing
        if (deals.length === 0) {
           chunks.forEach((chunk: any) => {
              if (chunk.web?.uri && chunk.web?.title) {
                 const lowerTitle = chunk.web.title.toLowerCase();
                 if (lowerTitle.includes('suche') || lowerTitle.includes('kaufe')) return;
                 
                 // Try to find price in title
                 const priceMatch = chunk.web.title.match(/([\d.,]+)\s*(?:€|EUR)/i);
                 const priceStr = priceMatch ? priceMatch[1] : null;
                 const numeric = priceStr ? parseGermanPrice(priceStr) : 0;

                 deals.push({
                    title: chunk.web.title,
                    url: chunk.web.uri,
                    price: priceStr ? `€${priceStr}` : "See Link", 
                    platform: chunk.web.uri.includes('kleinanzeigen') ? 'Kleinanzeigen' : (chunk.web.uri.includes('ebay') ? 'eBay' : 'Web'),
                    dateFound: new Date().toISOString(),
                    numericPrice: numeric
                 });
              }
           });
        }

        // FILTERING logic
        if (criteria.maxPrice > 0) {
           deals = deals.filter(d => {
              // IMPROVEMENT: If price is 0 (unknown), KEEP IT. 
              // Only filter if we KNOW the price is higher.
              if (d.numericPrice > 0 && d.numericPrice > criteria.maxPrice) return false;
              return true;
           });
        }

        // Sort: Items with price first, then unknown
        return deals.sort((a, b) => {
            if (a.numericPrice > 0 && b.numericPrice === 0) return -1;
            if (a.numericPrice === 0 && b.numericPrice > 0) return 1;
            return 0;
        }).slice(0, 25);
    });
  } catch (error: any) {
    console.error("Saved Search Error", error);
    return [];
  }
};

export const generateItemSpecs = async (
  name: string, 
  rawCategory: string,
  knownKeys: string[] = [] // Optional list of keys to restrict output
): Promise<{specs: Record<string, string | number>, standardizedName?: string, vendor?: string}> => {
  try {
    return await withAI(async (ai, model) => {
        // Smart Field Instruction to avoid duplicates
        let fieldInstruction = "";
        if (knownKeys.length > 0) {
            fieldInstruction = `
            STRICT OUTPUT RULES:
            1. ONLY return specs that map to these exact keys: ${JSON.stringify(knownKeys)}.
            2. If a spec value is found but the key name is different (e.g. "Ram" vs "Memory"), MAP IT to the matching key in the list.
            3. Do NOT invent new keys. If a spec is not in the provided list, ignore it.
            `;
        }

        const prompt = `
          Analyze hardware item: "${name}" (Category: ${rawCategory}).
          Identify exact model name and technical specs.
          ${fieldInstruction}
          Return a FLAT JSON object with valid technical specifications as keys.
          JSON Output: { "standardizedName": "...", "vendor": "...", "specs": {"key": "value", ...} }
        `;

        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: { 
            responseMimeType: "application/json"
            // NOTE: responseSchema removed to allow dynamic spec keys based on prompts
          }
        });
        return JSON.parse(response.text || '{"specs": {}}');
    });
  } catch (error) {
    console.error("Spec Generation Error", error);
    return { specs: {} };
  }
};

export const suggestCategoryProperties = async (category: string, subCategory: string): Promise<string[]> => {
  try {
    return await withAI(async (ai, model) => {
        const response = await ai.models.generateContent({
          model: model,
          contents: `List 5 technical spec fields for "${subCategory}" (${category}). JSON Array string output.`,
          config: { 
            responseMimeType: "application/json",
            responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        });
        return JSON.parse(response.text || '[]');
    });
  } catch { return []; }
};

export const getBundleSuggestions = async (items: InventoryItem[]): Promise<BundleSuggestion[]> => {
  try {
    return await withAI(async (ai, model) => {
        const inv = items.filter(i => i.status === ItemStatus.IN_STOCK && !i.isBundle).slice(0, 40).map(i => ({
          id: i.id, name: i.name, category: i.category
        }));
        
        const response = await ai.models.generateContent({
          model: model,
          contents: `Suggest 3 bundles from inventory: ${JSON.stringify(inv)}. JSON Output.`,
          config: { 
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  componentIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                  reasoning: { type: Type.STRING },
                  estimatedValue: { type: Type.NUMBER }
                }
              }
            }
          }
        });
        return JSON.parse(response.text || '[]');
    });
  } catch { return []; }
};

export const estimatePCPerformance = async (components: string[]): Promise<PerformanceEstimate | null> => {
  try {
    return await withAI(async (ai, model) => {
        const response = await ai.models.generateContent({
          model: model,
          contents: `Estimate PC performance (Gaming FPS, Workstation) for: ${components.join(', ')}. JSON Output.`,
          config: { responseMimeType: "application/json" }
        });
        return JSON.parse(response.text || '{}');
    });
  } catch { return null; }
};

export const analyzeSourcingStrategy = async (items: InventoryItem[]): Promise<SourcingStrategy[]> => {
  try {
    return await withAI(async (ai, model) => {
       const prompt = `Analyze sales history and suggest 3 sourcing niches. Output JSON.`;
       const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: { responseMimeType: "application/json" } // Schema omitted for brevity, implied
       });
       // Fallback for simple return if schema fails in loose mode
       const text = response.text || '[]';
       return text.startsWith('[') ? JSON.parse(text) : [];
    });
  } catch {
    return [
        {
          title: "Quick Flip: GPUs",
          targetCategory: "Graphics Cards",
          maxBuyPrice: 200,
          expectedSellPrice: 300,
          difficulty: "Easy",
          reasoning: "General recommendation due to lack of history."
        }
    ];
  }
};

export const findLiveDeals = async (strategy: SourcingStrategy): Promise<LiveDeal[]> => {
  return executeSavedSearch({
    id: 'temp',
    query: strategy.targetCategory,
    maxBuyPrice: strategy.maxBuyPrice, // Fixed: ensure this matches SavedSearchCriteria interface if needed, or mapped
    maxPrice: strategy.maxBuyPrice, // Mapping to SavedSearchCriteria
    includeEbay: true
  } as any);
};

export const generateCrossPostingContent = async (item: InventoryItem): Promise<CrossPostContent | null> => {
  try {
    return await withAI(async (ai, model) => {
        const response = await ai.models.generateContent({
          model: model,
          contents: `Write sales listings for "${item.name}" for eBay, Kleinanzeigen, Facebook. 
          Return a JSON object with keys: "ebay", "kleinanzeigen", "facebook". 
          Each object must have "title" and "description".`,
          config: { responseMimeType: "application/json" }
        });
        return JSON.parse(response.text || '{}');
    });
  } catch { return null; }
};

export const analyzeCompetitor = async (sellerName: string): Promise<any> => {
  try {
    return await withAI(async (ai, model) => {
       const response = await ai.models.generateContent({
          model: model,
          contents: `Analyze eBay seller "${sellerName}". JSON Output with inventory analysis.`,
          config: { responseMimeType: "application/json", tools: [{ googleSearch: {} }] }
       });
       return JSON.parse(response.text || '{}');
    });
  } catch { return null; }
};

export const analyzeMarket = async (query: string, context: string) => { 
  try {
    return await withAI(async (ai, model) => {
        const response = await ai.models.generateContent({
          model: model,
          contents: `Market analysis for: ${query}. Context: ${context}`,
          config: { tools: [{ googleSearch: {} }] }
        });
        return { 
          text: response.text || "No analysis.", 
          sources: response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => ({ uri: c.web?.uri, title: c.web?.title })) || []
        };
    });
  } catch { return { text: "Error.", sources: [] }; }
};

export const getSlowSellingAdvice = async (items: InventoryItem[]) => { 
  try {
     return await withAI(async (ai, model) => {
        const response = await ai.models.generateContent({
           model: model,
           contents: "Give advice for slow selling items.",
        });
        return { text: response.text || "", sources: [] };
     });
  } catch { return { text: "", sources: [] }; }
};

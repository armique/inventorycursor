
export interface GitHubConfig {
  token: string;
  gistId?: string;
}

export interface GitHubUser {
  login: string;
  avatar_url: string;
  name: string;
}

export interface SyncPayload {
  inventory: any[];
  trash: any[];
  expenses: any[];
  savedSearches?: any[]; // New field
  settings?: any;
  goals?: any;
  categories?: Record<string, string[]>;
  categoryFields?: Record<string, string[]>;
  updatedAt?: string;
}

const getHeaders = (token: string) => {
  return {
    'Authorization': `Bearer ${token.trim()}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };
};

export const validateToken = async (token: string): Promise<GitHubUser> => {
  try {
    const res = await fetch(`https://api.github.com/user?t=${Date.now()}`, {
      headers: getHeaders(token)
    });
    if (!res.ok) throw new Error("Invalid Token");
    return await res.json();
  } catch (e: any) {
    throw new Error("Network Error");
  }
};

export const getGistMetadata = async (config: GitHubConfig) => {
  if (!config.token || !config.gistId) return null;
  try {
    const res = await fetch(`https://api.github.com/gists/${config.gistId}?timestamp=${Date.now()}`, {
      headers: getHeaders(config.token)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      updated_at: data.updated_at,
      description: data.description
    };
  } catch (e) {
    return null;
  }
};

export const syncToGitHub = async (config: GitHubConfig, payload: SyncPayload) => {
  if (!config.token || !config.gistId) return null;

  try {
    console.log("Pushing to GitHub...");
    const res = await fetch(`https://api.github.com/gists/${config.gistId}`, {
      method: 'PATCH',
      headers: getHeaders(config.token),
      body: JSON.stringify({
        description: `DeInventory Pro Backup - Last Sync: ${new Date().toLocaleString()}`,
        files: {
          'inventory.json': {
            content: JSON.stringify(payload.inventory)
          },
          'trash.json': {
            content: JSON.stringify(payload.trash)
          },
          'expenses.json': {
            content: JSON.stringify(payload.expenses || [])
          },
          'searches.json': { // New File
            content: JSON.stringify(payload.savedSearches || [])
          },
          'categories.json': {
            content: JSON.stringify(payload.categories || {})
          },
          'categoryFields.json': {
            content: JSON.stringify(payload.categoryFields || {})
          },
          'settings.json': {
            content: JSON.stringify({
              business: payload.settings || {},
              goals: payload.goals || {}
            })
          }
        }
      })
    });
    
    if (!res.ok) {
      if (res.status === 404) throw new Error("Gist ID not found");
      throw new Error("Sync Failed");
    }
    const data = await res.json();
    return data.updated_at; 
  } catch (e: any) {
    console.error("GitHub Sync Error:", e);
    throw e;
  }
};

export const createInitialGist = async (token: string, inventory: any[], trash: any[] = [], expenses: any[] = []) => {
  try {
    const res = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: getHeaders(token),
      body: JSON.stringify({
        description: 'DeInventory Pro Backup (Private)',
        public: false,
        files: {
          'inventory.json': { content: JSON.stringify(inventory || []) },
          'trash.json': { content: JSON.stringify(trash || []) },
          'expenses.json': { content: JSON.stringify(expenses || []) },
          'searches.json': { content: JSON.stringify([]) },
          'categories.json': { content: JSON.stringify({}) },
          'categoryFields.json': { content: JSON.stringify({}) },
          'settings.json': { content: JSON.stringify({ business: {}, goals: {} }) }
        }
      })
    });
    
    if (!res.ok) throw new Error("Gist creation failed.");
    const result = await res.json();
    return result.id;
  } catch (e: any) {
    throw e;
  }
};

export const loadFromGitHub = async (config: GitHubConfig): Promise<SyncPayload | null> => {
  if (!config.token || !config.gistId) {
    throw new Error("Credentials missing.");
  }
  
  try {
    // Add cache buster to URL
    const res = await fetch(`https://api.github.com/gists/${config.gistId}?ts=${Date.now()}`, {
      headers: getHeaders(config.token)
    });
    
    if (!res.ok) {
      if (res.status === 404) throw new Error("Gist ID not found");
      if (res.status === 401) throw new Error("Invalid GitHub Token");
      throw new Error(`Cloud Pull Error: ${res.status}`);
    }
    
    const gist = await res.json();
    
    // CRITICAL CHECK: If inventory.json doesn't exist, this Gist is likely fresh/empty.
    // Return null so we don't wipe local data with empty arrays.
    if (!gist.files || !gist.files['inventory.json']) {
        console.warn("Gist found, but no inventory.json. Treating as uninitialized.");
        return null;
    }
    
    // Robust raw url fetch for truncated files
    const fetchRaw = async (filename: string) => {
       const file = gist.files[filename];
       if (!file) return null;
       if (!file.truncated) return JSON.parse(file.content);
       
       const rawRes = await fetch(file.raw_url);
       return await rawRes.json();
    }

    const inventory = (await fetchRaw('inventory.json')) || [];
    const trash = (await fetchRaw('trash.json')) || [];
    const expenses = (await fetchRaw('expenses.json')) || [];
    const savedSearches = (await fetchRaw('searches.json')) || [];
    const categories = (await fetchRaw('categories.json')) || null;
    const categoryFields = (await fetchRaw('categoryFields.json')) || null;
    const settingsData = (await fetchRaw('settings.json')) || { business: {}, goals: {} };

    return { 
      inventory, 
      trash, 
      expenses, 
      savedSearches,
      categories: categories || undefined,
      categoryFields: categoryFields || undefined,
      settings: settingsData.business || {}, 
      goals: settingsData.goals || {}, 
      updatedAt: gist.updated_at 
    };
  } catch (e: any) {
    console.error("Load Error:", e);
    throw e;
  }
};

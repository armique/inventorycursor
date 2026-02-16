
import { InventoryItem, BusinessSettings } from "../types";

const API_BASE = '/api'; // Relative path, works if served by the Node server

export const api = {
  async fetchItems(): Promise<InventoryItem[]> {
    const res = await fetch(`${API_BASE}/items`);
    if (!res.ok) throw new Error("Failed to fetch items");
    return res.json();
  },

  async syncItems(items: InventoryItem[]): Promise<void> {
    // Only send items that changed? For now send batch to keep it simple
    if (items.length === 0) return;
    const res = await fetch(`${API_BASE}/items/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items)
    });
    if (!res.ok) throw new Error("Sync failed");
  },

  async deleteItems(ids: string[]): Promise<void> {
    await fetch(`${API_BASE}/items/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
  },

  async fetchSettings(): Promise<any> {
    const res = await fetch(`${API_BASE}/settings`);
    if (!res.ok) return {};
    return res.json();
  },

  async saveSettings(settings: any): Promise<void> {
    await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
  }
};

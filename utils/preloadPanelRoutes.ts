let inventoryPreloaded = false;

/** Warm the inventory route chunk so the first nav click is not blocked on download/parse. */
export function preloadInventoryList(): void {
  if (inventoryPreloaded) return;
  inventoryPreloaded = true;
  void import('../components/InventoryList');
}

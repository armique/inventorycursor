/**
 * Specs AI returns an optional standardizedName. That must NEVER be applied to an
 * existing inventory item name unless the user clicked the explicit "AI title" control.
 * Specs / vendor updates are fine from Parse specs.
 */

export type SpecsAiNameVendorResult = {
  standardizedName?: string;
  vendor?: string;
};

export type ApplySpecsAiNameOptions = {
  /** True only for the dedicated "AI title" / generate-item-name button. */
  applyStandardizedName?: boolean;
};

export function pickSpecsAiNameVendorUpdates(
  result: SpecsAiNameVendorResult,
  options: ApplySpecsAiNameOptions = {}
): Partial<{ name: string; vendor: string }> {
  const updates: Partial<{ name: string; vendor: string }> = {};
  if (options.applyStandardizedName) {
    const name = result.standardizedName?.trim();
    if (name) updates.name = name;
  }
  const vendor = result.vendor?.trim();
  if (vendor) updates.vendor = vendor;
  return updates;
}

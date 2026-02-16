
import { InventoryItem, BusinessSettings } from '../types';

/**
 * Generates an eBay File Exchange compatible CSV string.
 * This format allows users to upload inventory in bulk via eBay Seller Hub -> Reports -> Uploads.
 */
export const generateEbayCSV = (items: InventoryItem[], settings: BusinessSettings): string => {
  const headers = [
    '*Action(SiteID=Germany|Country=DE|Currency=EUR|Version=745)', 
    '*Category', 
    '*Title', 
    'Description', 
    '*ConditionID', 
    '*C:Brand', 
    '*Format', 
    '*Duration', 
    'StartPrice', 
    'Quantity', 
    'PayPalAccepted', 
    'PayPalEmailAddress', 
    'DispatchTimeMax', 
    'ReturnsAcceptedOption', 
    'Location'
  ];

  const rows = items.map(item => {
    // Basic Sanitation
    const title = item.name.substring(0, 80).replace(/"/g, '""');
    
    // Description: Use generated description or simple fallback
    const description = (item.comment2 || item.comment1 || item.name).replace(/"/g, '""').replace(/\n/g, '<br>');
    
    // Default Category ID - 175673 is generic "Computer Components", users should map better but this works as a placeholder
    const categoryId = '175673'; 

    // Pricing: Default to 15% margin over buy price if no sell price set
    const price = (item.sellPrice || (item.buyPrice * 1.15)).toFixed(2);

    return [
      'Add', // Action
      categoryId, // Category
      `"${title}"`, // Title
      `"${description}"`, // Description
      '3000', // ConditionID (3000 = Used)
      `"${item.vendor || 'Unbranded'}"`, // Brand
      'FixedPrice', // Format
      'GTC', // Duration (Good Till Cancelled)
      price, // StartPrice
      '1', // Quantity
      '1', // PayPalAccepted
      settings.ebayPaypalEmail || '', // PayPalEmailAddress
      settings.ebayDispatchTime || '2', // DispatchTimeMax
      settings.ebayReturnPolicy || 'ReturnsNotAccepted', // ReturnsAcceptedOption
      settings.ebayPostalCode || '10115' // Location
    ].join(';'); // Use semicolon for German Excel compatibility usually, or comma. eBay supports both but ; is safer for DE.
  });

  return [headers.join(';'), ...rows].join('\n');
};

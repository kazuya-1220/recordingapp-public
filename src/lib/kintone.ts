import { KintoneSettings } from '../types';

/**
 * Migrate a saved settings blob in-place for known legacy defaults that we
 * shipped with the wrong value. Currently:
 *   - lookupFieldCode: '顧客番号'  →  '顧客DBより' (writing to 顧客番号 doesn't
 *     trigger Kintone's server-side lookup copy; the actual lookup source
 *     field on the recording app is 顧客DBより).
 */
function migrateSaved(saved: Partial<KintoneSettings>): Partial<KintoneSettings> {
  if (saved.lookupFieldCode === '顧客番号') {
    return { ...saved, lookupFieldCode: '顧客DBより' };
  }
  return saved;
}

export async function getKintoneSettings(): Promise<KintoneSettings> {
  const savedStr = localStorage.getItem('kintone_settings');
  let saved: Partial<KintoneSettings> = {};

  if (savedStr) {
    try {
      saved = migrateSaved(JSON.parse(savedStr));
    } catch (e) {
      console.error('Failed to parse saved kintone settings', e);
    }
  }

  // If we already have the essential settings saved locally, return them
  if (saved.domain && saved.appId && saved.apiToken) {
    // Persist the migrated blob so subsequent reads have the corrected value.
    localStorage.setItem('kintone_settings', JSON.stringify(saved));
    return saved as KintoneSettings;
  }

  // Otherwise, fetch defaults from the server
  try {
    const res = await fetch('/api/kintone/default-settings');
    if (res.ok) {
      const defaults = await res.json() as KintoneSettings;

      // Merge: localStorage values take precedence over defaults
      const merged: KintoneSettings = {
        domain: saved.domain || defaults.domain || '',
        appId: saved.appId || defaults.appId || '',
        apiToken: saved.apiToken || defaults.apiToken || '',
        customerAppId: saved.customerAppId || defaults.customerAppId || '',
        customerApiToken: saved.customerApiToken || defaults.customerApiToken || '',
        customerNameField: saved.customerNameField || defaults.customerNameField || '顧客名',
        customerNumberField: saved.customerNumberField || defaults.customerNumberField || '顧客番号',
        customerSubmitField: saved.customerSubmitField || defaults.customerSubmitField || 'submit_No',
        lookupFieldCode: saved.lookupFieldCode || defaults.lookupFieldCode || '顧客DBより',
        staffFieldCode: saved.staffFieldCode || defaults.staffFieldCode || ''
      };

      // Save to localStorage so future reads are fast and local changes can override
      if (merged.domain && merged.appId && merged.apiToken) {
        localStorage.setItem('kintone_settings', JSON.stringify(merged));
      }
      return merged;
    }
  } catch (err) {
    console.error('Failed to fetch default kintone settings from server', err);
  }

  return {
    domain: saved.domain || '',
    appId: saved.appId || '',
    apiToken: saved.apiToken || '',
    customerAppId: saved.customerAppId || '',
    customerApiToken: saved.customerApiToken || '',
    customerNameField: saved.customerNameField || '顧客名',
    customerNumberField: saved.customerNumberField || '顧客番号'
  };
}

/**
 * Rosensweig Family Tree — Google Apps Script Backend
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * The web app POSTs a JSON payload with the new member's data.
 * This script inserts a row at the correct position based on placement code.
 */

const SPREADSHEET_ID = '1ACLX4txK8fj_KTWEkWI1OyzqtRUAdds1E-NPljAVRUo';

function parsePlacement(p) {
  // "1.3.5+" → [1, 3, 5, 0.5]  (spouse sorts after the person)
  // "1.3.5.2" → [1, 3, 5, 2]
  // "1a" → [1, 0]  (root couple: 1a before 1b)
  if (!p) return [Infinity];
  const clean = p.replace(/\+$/, '');
  const isSpouse = p.endsWith('+');
  const parts = clean.replace(/[ab]$/, '').split('.').map(Number);
  if (isSpouse) parts.push(0.5);
  return parts;
}

function placementBefore(a, b) {
  const pa = parsePlacement(a);
  const pb = parsePlacement(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] === undefined ? 0 : pa[i];
    const vb = pb[i] === undefined ? 0 : pb[i];
    if (va < vb) return true;
    if (va > vb) return false;
  }
  return false; // equal
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets()[0];

    const newRow = [
      data.placement || '',
      data.lastName || '',
      data.maidenName || '',
      data.firstName || '',
      data.middleName || '',
      data.hebrewName || '',
      data.nickname || '',
      data.hebrewBirthDate || '',
      data.englishBirthDate || '',
      data.hebrewYartzeit || '',
      data.englishYartzeit || '',
      data.address || '',
      data.email || ''
    ];

    const newPlacement = data.placement || '';

    // Read all existing placement codes from column A (skip header row 1)
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      sheet.appendRow(newRow);
    } else {
      const placements = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

      // Find the last row whose placement sorts before the new one
      let insertAfterRow = 1; // insert after header by default
      for (let i = 0; i < placements.length; i++) {
        const existing = (placements[i][0] || '').toString().trim();
        if (placementBefore(existing, newPlacement)) {
          insertAfterRow = i + 2; // +2: 1-indexed + skip header
        }
      }

      // Insert the row
      sheet.insertRowAfter(insertAfterRow);
      sheet.getRange(insertAfterRow + 1, 1, 1, newRow.length).setValues([newRow]);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', message: 'Row inserted at correct position.' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Rosensweig Family Tree backend is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

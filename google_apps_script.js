/**
 * Rosensweig Family Tree — Google Apps Script Backend
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * The web app POSTs a JSON payload with the new member's data.
 * This script appends a row to the spreadsheet.
 */

const SPREADSHEET_ID = '1ACLX4txK8fj_KTWEkWI1OyzqtRUAdds1E-NPljAVRUo';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheets()[0]; // first sheet

    // Build the row matching the spreadsheet columns:
    // A: Family placement, B: Last name, C: Maiden name, D: First name,
    // E: Middle name, F: Hebrew name, G: Nickname, H: Hebrew birth date,
    // I: English birth date, J: Hebrew Yartzeit, K: English Yartzeit,
    // L: Address, M: Email
    const row = [
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

    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok', message: 'Row appended.' }))
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

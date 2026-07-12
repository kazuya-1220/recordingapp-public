/**
 * Kintone customizations for the "Recording" app.
 *
 * Two roles:
 *   1. Manual creation via the Kintone UI:
 *      - When the user opens the create form, if the linked customer field
 *        (顧客DBより) is set, trigger the standard lookup so 顧客DB fields
 *        (submit_No / 顧客名 / …) are auto-copied.
 *   2. API-created records (from the Recording web app):
 *      - Kintone's JavaScript events do NOT fire when records are created by
 *        REST API, so the app already POSTs with the lookup field value and
 *        immediately follows up with a PUT to re-trigger the server-side
 *        lookup copy. This client-side script is a safety net for when a
 *        user opens the record afterward — if the lookup source is set but
 *        the copied fields are empty, retry the lookup once.
 *
 * Field codes referenced (edit if your app renames them):
 *   顧客DBより            – lookup field pointing at the customer DB (app 170)
 *   submit_No             – identifier copied from the customer DB
 *   Recordingアプリ_リンク – URL back to this record in the web app history
 *
 * Deploy: Kintone → recording app → App Settings → JavaScript/CSS Customization
 *         → upload this file to the JavaScript for PC.
 */
(function () {
  'use strict';

  var LOOKUP_FIELD = '顧客DBより';

  // Trigger the lookup on the create form as soon as it opens (mirrors the
  // pre-existing behavior — no change here). Kintone requires setting
  // `lookup = true` on a lookup field to re-run the copy.
  kintone.events.on(['app.record.create.show'], function (event) {
    var record = event.record;
    var look = record[LOOKUP_FIELD];
    if (!look || look.value === undefined || look.value === null || look.value === '') {
      return event;
    }
    look.lookup = true;
    return event;
  });

  // Safety net for records created via API. If the user opens an existing
  // record whose lookup source is set but the copy has not been executed
  // (e.g. because the API-side PUT retry failed), give the lookup one more
  // chance on the edit form so their next save flushes the copied fields.
  kintone.events.on(['app.record.edit.show'], function (event) {
    var record = event.record;
    var look = record[LOOKUP_FIELD];
    if (!look || !look.value) return event;
    // Only retry if the lookup value exists but no copy has happened yet
    // (heuristic: submit_No is empty). Adjust the guard if the criteria are
    // different in your app.
    var submit = record['submit_No'];
    if (submit && submit.value) return event;
    look.lookup = true;
    return event;
  });
})();

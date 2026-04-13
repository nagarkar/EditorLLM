import 'google-apps-script';

export function test(b: GoogleAppsScript.Document.Bookmark) {
  b.remove(); // see if type checking fails
}

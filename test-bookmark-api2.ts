import 'google-apps-script';

export function test(doc: GoogleAppsScript.Document.Document) {
  const b = doc.getBookmark("id");
  if (b) b.remove();
}

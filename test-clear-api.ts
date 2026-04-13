import 'google-apps-script';

export function test(doc: GoogleAppsScript.Document.Document) {
  const body = doc.getBody();
  body.clear();
  const p = body.getChild(0) as GoogleAppsScript.Document.Paragraph;
  p.clear(); // might throw? 
}

// Generates a sample AcroForm PDF (real interactive fields) for testing
// QuickPDF's form detection/filling. Run: node scripts/gen-sample-form.mjs
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync } from "node:fs";

const OUT = "C:/Users/djrob/Downloads/sample-form.pdf";

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const form = doc.getForm();
const font = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);

const label = (text, x, y, size = 10, f = font) =>
  page.drawText(text, { x, y, size, font: f, color: rgb(0.1, 0.1, 0.15) });

let y = 740;
label("QuickPDF — Sample Registration Form", 50, y, 18, bold);
y -= 18;
label("All fields below are real interactive AcroForm fields.", 50, y, 9, font);
y -= 34;

// --- Text fields ---
const textField = (name, labelText, { width = 250, height = 20, multiline = false } = {}) => {
  label(labelText, 50, y + 4, 10, bold);
  const tf = form.createTextField(name);
  if (multiline) tf.enableMultiline();
  tf.addToPage(page, { x: 200, y: y - 2, width, height, borderWidth: 1 });
  y -= height + 18;
};

textField("full_name", "Full Name");
textField("email", "Email");
textField("phone", "Phone");
textField("date", "Date");
textField("address", "Address", { width: 320 });
textField("comments", "Comments", { width: 320, height: 60, multiline: true });

// --- Radio group ---
label("Membership", 50, y + 4, 10, bold);
const radio = form.createRadioGroup("membership");
let rx = 200;
for (const opt of ["Basic", "Pro", "Enterprise"]) {
  radio.addOptionToPage(opt, page, { x: rx, y: y - 1, width: 14, height: 14 });
  label(opt, rx + 20, y + 2, 10);
  rx += 110;
}
y -= 34;

// --- Checkboxes ---
label("Interests", 50, y + 4, 10, bold);
let cx = 200;
for (const [name, text] of [
  ["opt_newsletter", "Newsletter"],
  ["opt_updates", "Updates"],
  ["opt_offers", "Offers"],
]) {
  const cb = form.createCheckBox(name);
  cb.addToPage(page, { x: cx, y: y - 1, width: 14, height: 14 });
  label(text, cx + 20, y + 2, 10);
  cx += 110;
}
y -= 34;

// --- Dropdown ---
label("Country", 50, y + 4, 10, bold);
const dd = form.createDropdown("country");
dd.addOptions(["United States", "Canada", "Brazil", "United Kingdom", "Other"]);
dd.addToPage(page, { x: 200, y: y - 2, width: 200, height: 20, borderWidth: 1 });
y -= 40;

// --- Agreement + signature line ---
const agree = form.createCheckBox("agree_terms");
agree.addToPage(page, { x: 50, y: y - 1, width: 14, height: 14 });
label("I agree to the terms and conditions", 72, y + 2, 10);
y -= 34;

textField("signature", "Signature");

const bytes = await doc.save();
writeFileSync(OUT, bytes);
console.log("Wrote", OUT, "(" + bytes.length + " bytes)");
console.log("Fields:", form.getFields().map((f) => `${f.getName()} [${f.constructor.name}]`).join(", "));

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDelimiter, parseCSV, mapColumns, findTable, parseAmount, parseDate, readStatement, guessKind, cleanDesc } from "../docs/js/bankcsv.js";

// Made-up statements. No real account data.
const SWISS = [
  "Account number:;0000 00000000.00X;",
  "IBAN:;CH00 0000 0000 0000 0000 0;",
  "From:;01.10.2026;",
  "Until:;31.10.2026;",
  "",
  "Trade date;Trade time;Booking date;Value date;Currency;Debit;Credit;Individual amount;Balance;Transaction no.;Description1;Description2;Description3;Footnotes",
  "13.10.2026;14:02:11;14.10.2026;14.10.2026;CHF;-23.40;;;1'976.60;9930000000001;Pastelaria Exemplo;Lisboa;Card payment;",
  "13.10.2026;19:40:00;14.10.2026;14.10.2026;CHF;-1'204.50;;;772.10;9930000000002;Hotel Exemplo Lisboa;;Card payment;",
  "14.10.2026;09:00:00;15.10.2026;15.10.2026;CHF;;500.00;;1'272.10;9930000000003;Transfer in;;;",
  "15.10.2026;08:15:00;16.10.2026;16.10.2026;CHF;-6.80;;;1'265.30;9930000000004;UBER *TRIP;Lisboa;Card payment;",
  ";;;;;;;;;;Total;;;",
].join("\r\n");

const SIGNED = 'Date,Description,Amount,Currency\n2026-10-13,"Cafe ""Central"", Vienna",-4.50,EUR\n2026-10-14,Refund,12.00,EUR\n2026-10-15,Museum ticket,-18.00,EUR\n';

test("detects the delimiter", () => {
  assert.equal(detectDelimiter(SWISS), ";");
  assert.equal(detectDelimiter(SIGNED), ",");
});

test("parses quoted cells with embedded quotes and delimiters", () => {
  const rows = parseCSV(SIGNED, ",");
  assert.equal(rows[1][1], 'Cafe "Central", Vienna');
});

test("reads Swiss and European number formats", () => {
  assert.equal(parseAmount("1'204.50"), 1204.5);
  assert.equal(parseAmount("-1’204.50"), -1204.5);
  assert.equal(parseAmount("1.204,50"), 1204.5);
  assert.equal(parseAmount("1,204.50"), 1204.5);
  assert.equal(parseAmount("12.30-"), -12.3);
  assert.equal(parseAmount("(12.30)"), -12.3);
  assert.equal(parseAmount("CHF 9.90"), 9.9);
  assert.ok(Number.isNaN(parseAmount("")));
  assert.ok(Number.isNaN(parseAmount("Total")));
});

test("reads common date formats", () => {
  assert.equal(parseDate("13.10.2026"), "2026-10-13");
  assert.equal(parseDate("13.10.26"), "2026-10-13");
  assert.equal(parseDate("13/10/2026"), "2026-10-13");
  assert.equal(parseDate("2026-10-13 14:02"), "2026-10-13");
  assert.equal(parseDate("Total"), "");
});

test("finds the table below the account details and maps its columns, preferring the trade date", () => {
  const t = findTable(parseCSV(SWISS, ";"));
  assert.equal(t.headerIndex, 5);
  assert.equal(t.headers[t.map.date], "Trade date");
  assert.equal(t.headers[t.map.debit], "Debit");
  assert.equal(t.headers[t.map.credit], "Credit");
  assert.equal(t.headers[t.map.currency], "Currency");
  assert.deepEqual(t.map.desc.map(i => t.headers[i]), ["Description1", "Description2", "Description3"]);
});

test("extracts only money going out, skipping credits and totals", () => {
  const r = readStatement(SWISS, "CHF");
  assert.equal(r.ok, true);
  assert.deepEqual(r.tx.map(x => [x.date, x.amount, x.cur]), [
    ["2026-10-13", 23.4, "CHF"], ["2026-10-13", 1204.5, "CHF"], ["2026-10-15", 6.8, "CHF"]]);
  assert.equal(r.tx[0].desc, "Pastelaria Exemplo · Lisboa · Card payment");
  assert.equal(r.tx[0].ref, "9930000000001");
});

test("with a signed amount column, negatives are payments", () => {
  const r = readStatement(SIGNED, "CHF");
  assert.deepEqual(r.tx.map(x => [x.date, x.amount, x.cur]), [["2026-10-13", 4.5, "EUR"], ["2026-10-15", 18, "EUR"]]);
});

test("German headers work too", () => {
  const de = "Buchungsdatum;Buchungstext;Belastung;Gutschrift;Saldo\n13.10.2026;Migros Zürich;45.20;;1000.00\n14.10.2026;Lohn;;5000.00;6000.00\n";
  const r = readStatement(de, "CHF");
  assert.deepEqual(r.tx.map(x => [x.amount, x.desc]), [[45.2, "Migros Zürich"]]);
});

test("reports when it can't find a table", () => {
  assert.equal(readStatement("hello\nworld\n", "CHF").ok, false);
});

test("guesses a category kind from the merchant", () => {
  assert.equal(guessKind("UBER *TRIP Lisboa"), "train");
  assert.equal(guessKind("Hotel Exemplo Lisboa"), "bed");
  assert.equal(guessKind("Pastelaria Exemplo"), "food");
  assert.equal(guessKind("Museu Nacional"), "star");
  assert.equal(guessKind("Galp station 123"), "car");
  assert.equal(guessKind("Unknown merchant"), null);
});

// Same layout as a UBS "report" export: quoted, comma-separated, one signed amount column. Values are made up.
const UBS_REPORT = [
  '"Transaction date","Account or card number","Description","Income or expense","Amount","Currency","Category"',
  '"12.10.2026","CH00 00XX 0XXX XXXX 0XXX C","Coop-1234 City SM 4000XXXXXXXX0000 03/28","Expense","-37.60","CHF","Groceries"',
  '"13.10.2026","CH00 00XX 0XXX XXXX 0XXX C","Salary","Income","5000.00","CHF","Income"',
  '"14.10.2026","CH00 00XX 0XXX XXXX 0XXX C","SBB CFF FFS 4000XXXXXXXX0000 03/28","Expense","-12.40","CHF","Public transport"',
  '"15.10.2026","CH00 00XX 0XXX XXXX 0XXX C","Some Shop 4000XXXXXXXX0000 03/28","Expense","-20.00","EUR","Leisure"',
].join("\n") + "\n";

test("reads the UBS report layout: signed amounts, income left out, bank category kept", () => {
  const r = readStatement(UBS_REPORT, "CHF");
  assert.equal(r.ok, true);
  assert.equal(r.headers[r.map.date], "Transaction date");
  assert.equal(r.headers[r.map.amount], "Amount");
  assert.deepEqual(r.map.desc.map(i => r.headers[i]), ["Description"]);
  assert.deepEqual(r.tx.map(x => [x.date, x.amount, x.cur, x.bankCat]), [
    ["2026-10-12", 37.6, "CHF", "Groceries"], ["2026-10-14", 12.4, "CHF", "Public transport"], ["2026-10-15", 20, "EUR", "Leisure"]]);
});

test("cleans masked card numbers and expiry dates out of descriptions", () => {
  assert.equal(cleanDesc("Coop-1234 City SM 4000XXXXXXXX0000 03/28"), "Coop-1234 City SM");
  assert.equal(cleanDesc("Pastelaria Exemplo · Lisboa · Card payment"), "Pastelaria Exemplo · Lisboa");
});

test("falls back to the bank's own category when the merchant is unknown", () => {
  assert.equal(guessKind("Coop-1234 City SM", "Groceries"), "food");
  assert.equal(guessKind("Some Place", "Leisure"), "star");
  assert.equal(guessKind("XYZ 123", "Public transport"), "train");
});

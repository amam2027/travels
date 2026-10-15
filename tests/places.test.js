import { test } from "node:test";
import assert from "node:assert/strict";
import { guessCurrency } from "../docs/js/places.js";

test("guesses the local currency from a destination", () => {
  assert.equal(guessCurrency("Lisbon"), "EUR");
  assert.equal(guessCurrency("Kyoto, Japan"), "JPY");
  assert.equal(guessCurrency("New York"), "USD");
  assert.equal(guessCurrency("Hong Kong"), "HKD");
  assert.equal(guessCurrency("Zermatt"), "CHF");
});

test("returns nothing when it doesn't know the place", () => {
  assert.equal(guessCurrency("Nowhere"), null);
  assert.equal(guessCurrency("ab"), null);
});

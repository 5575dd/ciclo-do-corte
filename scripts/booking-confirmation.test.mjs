import assert from "node:assert/strict";
import test from "node:test";
import { hasOfficialBooking } from "./booking-confirmation.mjs";

const wrap = (content) => `<div class="list-group-item mb-2">${content}</div>`;

test("recognizes an exact Corte booking with nested markup and HTML entities", () => {
  const html = wrap('<strong>Corte</strong><br>05/12/2026 &agrave;s&nbsp;13:30<br>Profissional: Igor Freitas');
  assert.equal(hasOfficialBooking(html, { date: "2026-12-05", time: "13:30" }), true);
});

test("recognizes Corte + Barba as a haircut booking", () => {
  const html = wrap('<strong>Corte + Barba</strong><br>05/12/2026 às 13:30<br>Profissional: Igor Freitas');
  assert.equal(hasOfficialBooking(html, { date: "2026-12-05", time: "13:30" }), true);
});

test("does not mistake a Barba appointment for a Corte booking", () => {
  const html = wrap('<strong>Barba</strong><br>05/12/2026 às 13:30<br>Profissional: Igor Freitas');
  assert.equal(hasOfficialBooking(html, { date: "2026-12-05", time: "13:30" }), false);
  assert.equal(hasOfficialBooking(html, { date: "2026-12-05", anyTime: true, anyService: true }), true);
});

test("does not match a different time or a different professional", () => {
  const html = wrap('<strong>Corte</strong><br>05/12/2026 às 16:30<br>Profissional: Outra Pessoa');
  assert.equal(hasOfficialBooking(html, { date: "2026-12-05", time: "13:30" }), false);
});

test("does not combine details from adjacent appointment cards", () => {
  const html = wrap('<strong>Barba</strong><br>05/12/2026 às 13:30<br>Profissional: Igor Freitas')
    + wrap('<strong>Corte</strong><br>06/12/2026 às 16:30<br>Profissional: Igor Freitas');
  assert.equal(hasOfficialBooking(html, { date: "2026-12-05", time: "13:30" }), false);
});

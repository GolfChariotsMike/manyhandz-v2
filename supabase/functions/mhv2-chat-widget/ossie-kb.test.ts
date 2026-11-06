import assert from "node:assert/strict";
import { ossieKbToChat, isOssieChatCustomer, OSSIE_CHAT_CUSTOMER_ID } from "./ossie-kb.ts";

Deno.test("ossieKbToChat maps key/value to faqs and about", () => {
  const kb = ossieKbToChat({
    knowledge_base: [
      { key: "Location", value: "43 Collingwood Street" },
      { key: "Juniors", value: "Saturday during school term" },
    ],
    system_prompt: "Be concise.",
    business_hours: { timezone: "Australia/Perth" },
  });
  assert.match(String(kb.about), /43 Collingwood/);
  const faqs = kb.faqs as { q: string; a: string }[];
  assert.equal(faqs.length, 2);
  assert.equal(faqs[1].q, "Juniors");
  assert.deepEqual(kb.custom_instructions, ["Be concise."]);
  assert.equal((kb.hours as { timezone: string }).timezone, "Australia/Perth");
});

Deno.test("isOssieChatCustomer gates only Ossie chat id", () => {
  assert.equal(isOssieChatCustomer(OSSIE_CHAT_CUSTOMER_ID), true);
  assert.equal(isOssieChatCustomer("a77816d9-3b5f-4635-a77d-095e767a532e"), false);
});

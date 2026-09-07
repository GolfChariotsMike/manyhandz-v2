import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyOutreachCall,
  normAuPhone,
  phoneFromElConversation,
  queueRowPatchFromTwilio,
  queueStatusFromTwilio,
  skipReason,
} from "./outreach-outcome.ts";

describe("normAuPhone", () => {
  it("accepts mobiles and 02/03/07/08 landlines including AR Locksmith", () => {
    assert.equal(normAuPhone("0433121933"), "+61433121933");
    assert.equal(normAuPhone("0291606442"), "+61291606442");
    assert.equal(normAuPhone("+61291606442"), "+61291606442");
    assert.equal(normAuPhone("0390882096"), "+61390882096");
    assert.equal(normAuPhone("0892223333"), "+61892223333");
  });

  it("skips 13/1300/1800 only", () => {
    assert.equal(skipReason("0292328839"), null);
    assert.equal(skipReason("+611300247247"), "skipped special/1300/1800 number");
    assert.equal(skipReason("1800348378"), "skipped special/1300/1800 number");
  });
});

describe("classifyOutreachCall", () => {
  it("does not invent a business name", () => {
    const out = classifyOutreachCall({ durationSeconds: 42, transcriptSummary: "Asked about pricing." });
    assert.equal(out.summary.includes("Asked about pricing."), true);
    assert.equal(out.notInterested, false);
  });

  it("marks early hangup with no caller turns as not interested", () => {
    const out = classifyOutreachCall({
      business: "CBD LOCKSMITHS",
      durationSeconds: 8,
      transcript: [{ role: "agent", message: "Hi" }],
    });
    assert.equal(out.notInterested, true);
    assert.equal(out.reason, "early hangup");
    assert.match(out.line1, /CBD LOCKSMITHS/);
    assert.match(out.outcomeLabel, /hung up early/);
    assert.match(out.summary, /hung up early/);
  });

  it("does not mark Twilio no-answer as not interested", () => {
    const out = classifyOutreachCall({
      business: "Allen locksmith Sydney",
      durationSeconds: 0,
      status: "no_answer",
    });
    assert.equal(out.notInterested, false);
    assert.match(out.outcomeLabel, /no answer/);
  });

  it("puts who and outcome on line 1 and a real EL sentence on line 2", () => {
    const out = classifyOutreachCall({
      business: "AR Locksmith Sydney",
      durationSeconds: 22,
      callSummaryTitle: "Locksmith Business Help",
      transcriptSummary: "The conversation began with the user stating A locksmith. Sam offered help.",
    });
    assert.equal(out.notInterested, false);
    assert.match(out.line1, /AR Locksmith Sydney — answered \(22s\)/);
    assert.match(out.line2, /The conversation began with the user stating A locksmith/);
    assert.equal(out.line2.includes("Sam offered"), false);
  });

  it("marks negative analysis as not interested", () => {
    const out = classifyOutreachCall({
      business: "Shop",
      durationSeconds: 40,
      analysis: { transcript_summary: "They said they are not interested." },
    });
    assert.equal(out.notInterested, true);
    assert.equal(out.reason, "negative sentiment");
  });
});

describe("queueStatusFromTwilio", () => {
  it("does not treat a SID / ringing as done", () => {
    assert.equal(queueStatusFromTwilio("initiated").finalize, false);
    assert.equal(queueStatusFromTwilio("ringing").status, "calling");
    assert.equal(queueStatusFromTwilio("no-answer", 0).status, "no_answer");
    assert.equal(queueStatusFromTwilio("busy", 0).status, "busy");
    assert.equal(queueStatusFromTwilio("failed", 0).status, "failed");
    assert.equal(queueStatusFromTwilio("completed", 22).status, "done");
    assert.equal(queueStatusFromTwilio("completed", 22).answered, true);
    assert.equal(queueStatusFromTwilio("completed", 0).status, "no_answer");
    const patch = queueRowPatchFromTwilio({
      callStatus: "no-answer",
      duration: 0,
      sid: "CAnoanswer000000000000000000000001",
    });
    assert.equal(patch.answered, false);
    assert.match(patch.patch.notes, /sid=CAnoanswer000000000000000000000001/);
  });
});

describe("phoneFromElConversation", () => {
  it("reads ConvAI phone_call.external_number", () => {
    assert.equal(
      phoneFromElConversation({ metadata: { phone_call: { external_number: "0291606442" } } }),
      "+61291606442",
    );
  });
});

/**
 * Re-export production handler from main while the full new-address patch
 * is applied via booking-honesty + a follow-up commit of handler.ts.
 * Overlay: site-pick acceptance lives in booking-honesty on this branch;
 * attachLookup / spoken overwrite need the full handler body (next commit).
 */
export * from "https://raw.githubusercontent.com/GolfChariotsMike/manyhandz-v2/a2d927f54eb5de249ae7fa034ec460361f179adb/supabase/functions/mhv2-chat-widget/handler.ts";

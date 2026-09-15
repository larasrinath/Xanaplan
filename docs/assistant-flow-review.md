# Assistant flow review and discussion plan

Reviewed against the 0.7.0 implementation and synthetic API/DOM acceptance tests on 2026-09-12; updated after live feedback on 2026-09-13. Version 0.7.3 implements the first module-evidence path in item 1 and the decorative-source fix in item 2. Version 0.8.2 adds view-member fallback for captured selections and verifies fixed hidden line-item defaults after a live chat unnecessarily asked for a customer already selected on the page. Updated for 0.9.3: explicit cross-context continuation, saved-selection recovery, navigation-safe answers, automatic app matching and the compact page menu are implemented. Remaining recommendations below require live validation or a separate product decision.

## End-to-end assessment

The core sequence is coherent: connect AI and Anaplan in Admin → choose tenant/app → verify model membership → save business context → select the app in Assistant → identify or choose a page → confirm the page and visible selection values → ask → inspect sources. The user does not map modules manually. Chat-only page changes and query overrides preserve the browser's position.

The local checks exercise that path through production helper routes, then exercise the actual panel controller with a synthetic DOM. Revision checks and page tickets prevent stale app/model use. Context changes preserve running answers and their original snapshots; explicit Stop cancels them. Those checks establish local control flow; they do not establish live schema compatibility, visual quality or numerical accuracy.

The main weakness is conflating exact card reproduction with the ability to answer from its underlying modules. Current MCP reads expose saved/default views and page-dimension selections. Many real cards use custom queries, runtime filters, row/column selection, or multiple selected items. Blocking an unverified claim about the displayed card is appropriate; blocking all module data investigation because a card is custom is too restrictive for the approved module-first assistant.

Live example: the assistant identified three modules on “2000 - Store Placeholder Creation,” but refused “how many existing stores in store size medium?” solely because “Existing Stores” uses a custom view. Module discovery succeeded. The initial adapter dropped the remaining query metadata, skipped custom-source selectors and prohibited module-view reads. Version 0.7.3 retains bounded query metadata and selections, exposes verified module names, and adds an explicitly labeled module-evidence read. Local regressions cover the corrected path; the live count still needs comparison with Anaplan.

## Strong recommendations to discuss

### 1. Use verified modules to investigate custom-card questions

Separate two capabilities: reading the exact card view, and gathering evidence from its verified underlying modules. A custom card can lack the first while supporting the second. Preserve bounded custom-query metadata and source-specific selections so the assistant can investigate the business scope rather than stopping at the card type. Retain verified module names for the assistant to investigate custom cards.

For the reported question, the intended path is:

1. Inspect the verified module's line items, dimensions and available views through MCP; find Store Size and the actual rule, subset or filter that defines existing stores. Do not infer membership solely from the card title.
2. Retain the active page/card selections, including Canada when selected. Determine whether each condition maps to a page dimension, a row/column member, or a line-item predicate. Follow formula references when that mapping requires another module.
3. Read a suitable verified module or saved view as explicitly labeled module evidence. Apply supported selectors through MCP and evaluate remaining predicates only when the returned data establishes their meaning and covers all relevant records. Do not present this read as an exact copy of the custom card.
4. Count distinct matching stores only after verifying existing-store membership, Store Size = Medium, applicable context, hierarchy level and complete coverage. Row-limited or truncated results cannot establish the total. Prefer a verified aggregate or a narrower supported read when necessary.
5. Ask a focused business clarification only if a necessary predicate or selection remains unresolved after metadata investigation. The custom-view type alone is not a reason to refuse or require the user to create a saved view.

Acceptance fixtures should include medium-size placeholders that must be excluded, medium-size stores outside Canada, duplicate/summary rows, a formula-backed existing-store rule, and truncated data. Test that custom-card questions attempt relevant metadata/data reads, while unrelated modules and unsupported exact-card claims remain blocked. Compare the final count with the live Existing Stores card before declaring this example fixed.

Extend the MCP with structured, read-only view ownership and cell-coordinate/query support where these investigations reveal an actual API gap. Return dimension axes, member IDs, supported predicates and coverage limits as typed JSON. This improves scope verification without making pixel-for-pixel card reproduction a prerequisite for every business answer.

### 2. Keep recovery in the Assistant

The current app/page/model selection sequence is understandable, but failures can leave users reading status text without a clear next action. Add one contextual recovery action: refresh page, choose model, clarify selection, or reopen the relevant Admin connection. Distinguish “page recognized, some cards unsupported” from “page unavailable” before the first question.

Version 0.8.1 removes technical context diagnostics from the Assistant after business-user feedback. Keep partial-page readiness internal; explain an unresolved business selection only when it affects the question. Do not reintroduce per-card warnings or module availability disclosures on the start page. Answers must still avoid implying that page totals are complete when evidence is missing. Also classify static text/action sources correctly: the live page currently shows invalid-model-object-ID errors for TEXT and ACTION entries. Preserve genuinely data-bound text/images, but do not treat decorative or action identifiers as module/view IDs.

### 3. Validate the implemented continuation choices

Version 0.9.3 preserves the original context of a running answer while pages or selectors change. It keeps the completed answer visible and offers **Continue on this page** and **Use saved page & selections**. Both choices retain earlier sources; new questions use fresh verification and a context-change marker when appropriate. Saved unknown selectors stay unknown. Failed restoration leaves the current context usable.

Idle context changes still select a thread by the full app/model/page/filter/AI fingerprint. Whether they should automatically carry the current conversation into another context remains a separate product decision. Validate the existing explicit choices with users before changing that default. See [saved chat behavior](chat-history.md).

### 4. Measure page-loading latency after the implemented optimizations

The tracker reuses a recent published definition for selector-only changes while re-verifying selections. Explicit Refresh fetches a new definition. Saved-view discovery first uses a model-wide view catalog and verifies ownership in the reported module, with bounded module scans as a fallback. Actual loading stages and elapsed time are visible, with cancellation and a total deadline.

Measure first-page, repeat-page and first-answer latency in the live app. Use those measurements to decide whether additional model-level metadata caching is useful. Keep selection verification fresh and do not persist observed business values to accelerate discovery.

## Suggested order after live testing

1. Record schema differences and fix adapter mismatches found on one known board and worksheet.
2. Prioritize module evidence and scope resolution for the reported Existing Stores question; extend the MCP only for demonstrated read/filter gaps, with the acceptance cases above.
3. Add targeted readiness/recovery UI once real failure modes are known.
4. Validate the continuation choices and decide any further caching or idle-thread behavior from measured experience.

Keep the current local, read-only deployment model for this discussion. Shared administration and hosting remain in their existing future plan.

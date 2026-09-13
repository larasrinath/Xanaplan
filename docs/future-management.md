# Xanaplan: future shared administration (deferred)

Status: archived design for a later shared deployment. It is not the current implementation contract. The user chose a local, single-person Admin/Assistant setup first. See product-design.md for the implemented scope. Organizations, hosting, roles, and shared configuration below are deferred.

## Product intent

Business users ask factual, analytical, and decision-oriented questions while working in Anaplan. Xanaplan uses the enabled model's data and business context to answer, explain its evidence, and offer recommendations with stated assumptions.

Examples: What is revenue versus budget? Why are we missing the sales target? Where could we reduce inventory while protecting service levels?

## Agreed requirements

- An administrator enables a model and maintains its business context once.
- No required configuration of individual modules, cards, or UX pages.
- The extension provides the assistant alongside the user's Anaplan screen.
- Questions can span relevant modules within the enabled model, irrespective of the page being viewed.
- Use a selected subset of tools from `larasrinath/anaplan-mcp`, governed by the features enabled for the user.
- Business questions are the primary interaction. Module names, formulas, and tool parameters are implementation details unless useful as supporting evidence.
- Existing Anaplan user permissions remain the authority for access to model data.
- An admin can also use the business assistant. Admins see two views, **Assistant** and **Admin**, in the extension; ordinary users see Assistant.
- The Admin view lists previously enabled models and offers **Add model**.
- Adding a model uses a workspace dropdown followed by a model dropdown, a context file upload, an editable context text field, and **Save**.
- Version 1 only reads Anaplan information and answers business questions, including analytical answers and recommendations. It does not change Anaplan data or run business processes.
- Context and enabled-model configuration are shared through a hosted Xanaplan service. An admin's local extension storage is not the shared source of truth.

## Core design: curated meaning plus discovered structure

Maintain two complementary sources of context:

1. **Admin-owned business context:** what the organization means, wants, assumes, and permits.
2. **Automatically discovered model catalog:** the accessible modules, line items, dimensions, formulas, views, and relationships needed to locate and interpret information.

The catalog is produced from the permitted MCP metadata tools. It is not a form an admin must populate. Changes to discovered structure must not overwrite the admin's business definitions.

The assistant connects business terms to candidate data sources using both context and catalog. It verifies candidates against metadata and data before answering. Ambiguous meanings produce a focused business question, such as “Do you mean the approved budget or the latest forecast?” They do not produce a demand to configure a UX page.

## Administrator experience

### 1. Sign in and connect Anaplan

The same person can administer the assistant and ask business questions. Organization membership and the Xanaplan administrator role determine which views are available; Anaplan authorization determines which live models and data that person can access.

The first administrator is assigned during organization provisioning. Being signed in to an Anaplan webpage does not by itself assign the Xanaplan administrator role or create an authorized MCP connection. Present **Connect Anaplan** when needed and preserve a valid connection through supported authorization handling. The existing MCP repository uses a device authorization flow, which the extension can present as a guided connection step.

Once an administrator is signed in and connected, unlock Admin model management. If their connection expires, keep their saved enabled-model list and unsaved edits available while prompting them to reconnect before discovery or validation.

### 2. View enabled models

The Admin home contains an **Add model** button and a list with model name, workspace, status, context last updated, and editor. Each row offers **Edit context** and **Disable**. Disabling removes the model from new assistant use while retaining its saved context for later re-enabling.

An empty list explains that the admin can enable their first model with Add model. Existing records remain associated with stable organization, workspace, and model identifiers, even if display names change.

### 3. Add a model

Open a form within the Admin view:

1. **Workspace** dropdown: workspaces available through the admin's Anaplan connection.
2. **Model** dropdown: accessible models in the selected workspace. Changing the workspace clears the prior model selection. Already-enabled models link to their existing record rather than creating a duplicate.
3. **Upload context file**: optional input to the context editor. Exact supported file types remain pending clarification.
4. **Model context**: a large, directly editable text field.
5. **Save**: validate the selection and context, persist the configuration, enable the model, and start metadata discovery.

Show connection/loading errors beside the dropdowns. The admin can see which model and workspace will be enabled before saving. Changing a selected model with unsaved context must not silently attach those notes to the new model.

The initial record shows **Setting up** while discovery runs and **Ready** when it is usable. If discovery is incomplete or fails, preserve the saved context and explain the issue with a retry action. Activation of a model does not grant users additional Anaplan permissions.

### 4. Establish business context

Use file upload and an editable text field, as requested. The admin can type context directly without uploading a file. A supported upload is parsed into a preview that the admin can insert into or use to replace the editor contents; it must not silently overwrite existing edits. Extraction failures retain the existing text. The saved editor contents are the authoritative business context, while the original attachment is retained privately as its source.

The following are writing guidance or an optional starter template inside the editor, not a mandatory multi-step questionnaire:

| Area | Information to capture |
| --- | --- |
| Purpose and audience | Planning process, business scope, intended users, decisions supported |
| Vocabulary | Business terms, abbreviations, synonyms, and distinctions |
| Measures | KPI definitions, units, currencies, calculation meaning, and aggregation rules |
| Planning basis | Fiscal calendar, planning horizon, versions/scenarios, comparison conventions, and levels of detail |
| Objectives | Targets, priorities, and the meaning of success |
| Decision constraints | Service levels, capacity, lead times, policy limits, and acceptable tradeoffs |
| Assumptions | Planning assumptions, exceptions, exclusions, and known data limitations |
| Data interpretation | Refresh cadence, expected delays, ownership, and source-of-truth conventions |
| Response expectations | Terminology, level of detail, and how to present recommendations |

Not every field is mandatory. Readiness should depend on the questions the model is intended to support. Admins should not need to enter identifiers for every module or bind every KPI to a UX card.

### 5. Save and maintain context

**Save is the action that makes the edited context available.** There is no additional publish step in the first version. The interface explains that saved context is shared with authorized assistant users of this model.

Every successful Save creates a context version with its author and timestamp and atomically makes it current. Users' next questions use that version without reinstalling or refreshing the extension. An in-flight answer finishes against the version it started with and records that version; existing answers are not silently rewritten. A subsequent question after an update can indicate that the context has changed.

The admin can return to Edit context, type changes or import a replacement source, and Save again. Retain earlier versions for restoration. Detect concurrent edits and present the newer saved version rather than silently overwriting another admin's work. Keep the editor contents intact if saving fails.

Metadata discovery is separate from business-context editing. Refresh the catalog in the background and when source validation detects a change, and provide an explicit refresh action when needed. Flag changes that invalidate resolved sources. Ask admins to clarify business meaning when necessary, without introducing module-by-module setup as a maintenance task.

## Business-user experience

1. Open Anaplan and open the Xanaplan side panel. Sign in and connect Anaplan when required.
2. The panel displays the active enabled model. Where the extension can reliably detect the page's model and selections, use them as suggested context. Otherwise offer a model selector; no page registration is required.
3. Select from models enabled for the user's organization that the user can access through their own Anaplan connection. Ask a business question or continue a conversation.
4. Show the interpreted scope when material: period, scenario, business unit, currency, and filters. Let the user correct it in ordinary language.
5. Retrieve the relevant evidence and answer in business terms. Follow-up questions reuse the conversation scope unless the user changes it.

The current page is a useful starting point, not the boundary of the assistant's knowledge. A user can ask a model-wide question from any page. Explicit instructions in a question take precedence over inherited page selections; uncertain selections should be clarified rather than silently applied. Regular users do not upload context, configure modules, or provide MCP tool names. Admins can switch back to Assistant and use the same conversation experience.

Changing models must visibly update the active context and invalidate incompatible pending answers. Each browser tab and conversation must retain its own model and selection scope.

## Answer behavior

| Intent | Expected behavior |
| --- | --- |
| Factual | Retrieve the relevant figures, calculate required comparisons, and identify the period, units, and evidence |
| Analytical | Quantify contributors, distinguish observed changes from possible causes, and explain relevant relationships |
| Decision-oriented | Use targets and constraints to compare plausible options, explain tradeoffs, and state assumptions and uncertainty |

Use deterministic calculations for numerical comparisons. A causal claim, forecast, or scenario result must have an appropriate supporting method; unavailable assumptions or simulations must not be presented as measured results. Recommendations should make their reasoning inspectable.

Model references and retrieval timestamps should be available with the answer. Where access, missing definitions, or missing data prevent a complete answer, state what is missing and ask a focused question if the user can resolve it.

## Tool and service design

- Reuse the existing MCP server through its HTTP transport; keep model access and tool implementations in that project.
- The assistant service combines the user question, current saved context, relevant catalog entries, and permitted MCP results.
- Expose only an approved set of tools needed for the enabled business capabilities. Enforce tool access on the service, not only through instructions to the AI.
- Separate metadata discovery for setup from tools available during a user conversation.
- Do not assume the Anaplan browser session automatically authorizes MCP API access. Maintain a supported per-user connection flow.
- Keep LLM credentials and Anaplan authorization material out of page scripts and business-context documents.
- Treat shared catalogs as permission-sensitive: an admin's discovery access must not become an alternate route to restricted metadata or data for another user. Tenant, model, and user access govern retrieval and cache use.
- Treat page text, model contents, and imported documents as information rather than authority to grant tool access or execute actions.

## Read-only boundary for version 1

The assistant can read model metadata and permitted data and compute comparisons for its answers. Enforce an explicit read-tool allowlist in the server. Model enabling and context editing write Xanaplan configuration, not Anaplan business data.

Candidate setup tools are `show_workspaces` and `show_models`. Candidate discovery and answer tools include `show_modules`, `show_lineitems`, `show_moduledetails`, `show_savedviews`, `show_viewdetails`, appropriate dimension lookup tools, and `read_cells`. Final selection follows the pilot questions; tools are exposed according to the request and user's capability.

Do not expose cell writes, list edits, imports, processes, delete actions, model administration, or `run_export` in this initial scope. If a data request exceeds the supported read path, explain the limit and narrow it instead of silently introducing action execution. Read-request jobs for larger datasets can be assessed separately if the pilot requires them.

The existing MCP project registers a broad tool collection. Reuse its implementations while adding a configurable server-side read-only profile or an equivalently enforced private gateway. Hiding tools in the extension or instructing the AI not to call them is insufficient.

## Hosting and shared administration

### Recommended pilot architecture

Use one centrally hosted Xanaplan deployment for the pilot organization. Users install the extension; the project operator deploys and maintains the service once. Admins manage models and context in the UI and do not need to operate a server or keep their computer open.

| Component | Runs or lives where | Responsibility |
| --- | --- | --- |
| Chrome extension | Each user's browser | Assistant and Admin views, connection UI, page-context hints |
| Xanaplan application service | Managed cloud container | Sign-in sessions, organization/admin authorization, model registry, context saves, answer orchestration, and enforced tool policy |
| Anaplan MCP service | A private service in the same deployment/environment | Selected metadata and data-reading tools using the requesting user's Anaplan authorization |
| PostgreSQL database | Managed database | Organizations, memberships, enabled models, context versions, catalog references, and configuration history |
| Private object storage | Managed cloud file storage | Uploaded source files with organization/model access control |
| LLM service | Approved provider reached by the application service | Interpret business questions and compose grounded answers from retrieved evidence |

The existing repository's container/HTTP deployment is a starting point for the MCP component. A concrete pilot deployment can use **Fly.io for the Node.js application and private MCP containers, Fly Managed Postgres, and a private Tigris object-storage bucket**. This is a deployment proposal, not a provisioned service; region, cost, and organization requirements should be confirmed before deployment. File-storage location/replication controls must match the chosen data-residency requirements. The components can instead run in the organization's approved cloud without changing the product workflow.

Keep the MCP endpoint private to the application service in this design. Do not distribute a shared MCP bearer token or the admin's Anaplan credentials to user extensions. Bind every MCP session to the authenticated application user and organization, and validate session ownership and model access on the service.

### How an admin's Save reaches users

1. The extension submits the selected workspace/model, edited context, and source attachment reference to the authenticated application service.
2. The service verifies administrator membership and the selected model's accessibility, then saves a version under the organization's model record.
3. The next assistant request resolves the active context version from that central record.
4. The service retrieves data under the asking user's Anaplan identity and uses the saved business context to interpret it.

No file distribution, extension reinstall, or user-by-user configuration is required. Different organizations have separate model registries and context even if display names coincide. Local browser storage is reserved for transient UI state and appropriate session handling, not distribution of shared business context.

### Context and data handling

Store context and attachments centrally. Query live Anaplan data when a question needs it; do not copy entire model data into the context store. Limit any caches to their user/access scope and freshness policy. Configuration history identifies who enabled a model or changed its context.

Admin-written context is intended for the authorized users of that model, so the editor should make its audience clear. Shared catalog discovery must still respect each asking user's metadata permissions. Retrieving with an admin identity and filtering afterwards is not an acceptable substitute for user access checks.

Question text, relevant saved context, and selected query results are sent to the configured LLM provider to generate an answer. Provider choice and retention settings are deployment decisions that must be clear to the organization. Keeping credentials on the service does not mean model data never leaves Anaplan.

Running costs consist of application/MCP hosting, database/file storage, and LLM usage. For the pilot, set usage limits and record tokens, latency, and read volume per question before estimating a recurring budget.

### Additions needed beyond the current MCP repository

The local checkout provides tool implementations, HTTP transport, and per-session Anaplan OAuth state. The hosted product still needs organization membership, admin roles, persistent configuration/context storage, attachment processing, app-user-to-MCP-session ownership, the selected-tool boundary, and the assistant/LLM loop. An in-memory MCP session or shared outer bearer token is not a complete shared administration system.

## First design validation

Choose one business planning use case and 5–10 representative questions covering facts, analysis, and recommendations. Include a question spanning modules, a follow-up changing a period or scenario, and a question where a missing business assumption requires clarification.

Success means an admin can enable the model and save business context without module/card/page mapping; a separate business user can then receive grounded answers through the panel on a real Anaplan page. Update the context from the admin account and verify that the user's next question uses the new version. Also verify that a user without model access cannot obtain the context or data, and that a write request cannot execute through the assistant.

## Open decisions

1. What “Anaplan file” means for the context upload and which format should be supported first.
2. Initial business planning use case and representative user questions.
3. Before deployment: hosting region, organization sign-in/provisioning details, and an approved LLM provider. These do not block the two-view interaction design.

Cross-model analysis and exact screen layouts can be scoped after these decisions. The first validation uses one enabled model and can retrieve from multiple modules within it.

## Reference material

- [Anaplan MCP repository](https://github.com/larasrinath/anaplan-mcp): reusable server, tools, and deployment starting point.
- [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage): local and account-sync storage behavior; neither is the proposed organization-wide context registry.
- [Fly Managed Postgres](https://fly.io/docs/mpg/), [private networking](https://fly.io/docs/networking/private-networking/), and [Tigris object storage](https://fly.io/docs/tigris/): available components for the proposed pilot deployment.

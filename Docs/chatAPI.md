This system documentation outlines the backend logic, data structure, and state-machine transitions for the AI Scout Stress Assessment service. It is designed to be used by both developers maintaining the code and senior specialists who consume the output.
1. Function Specification: post_chat(request)
The post_chat function acts as a Stateful Webhook. It manages the dialogue flow by tracking a user’s session in a database and determining the next logical question based on the "Interrogation Pyramid."
 * Endpoint: https://kalatitmanisha.com/_functions/chat
 * Method: POST
 * Authentication: Requires an API Secret or Wix Session ID (recommended to be passed in headers or body).
2. The Conversation State Machine
The backend uses a strictly sequential state machine to ensure the "Scout" logic is followed before escalation to a human "Specialist."
| Phase | Description | Key Logic Trigger |
|---|---|---|
| WELCOME | Trust-building & Informed Consent. | User's first message or "Start" command. |
| LEVEL 1 | Discovery: General detection of stress. | Completing all LEVEL_1_QUESTIONS. |
| LEVEL 2 | Drilling: Category-specific exploration. | AI Categorization of previous answers. |
| COMPLETED | Finalization & Escalation. | Completion of category-specific drilling. |
3. Data Schema: StressSessions (Wix Data)
This collection acts as the persistent cache for the conversation. Each document represents a single user interaction.
| Field Key | Type | Description |
|---|---|---|
| _id | String | Unique sessionId (e.g., UUID or Phone Number). |
| phase | String | Current state (WELCOME, LEVEL_1, LEVEL_2, COMPLETED). |
| questionIndex | Number | Tracks which Level 1 question is being asked. |
| responses | Array | A log of objects: [{ "q": "Question", "a": "Answer" }]. |
| category | String | Identified stressor: (Financial, Relational, External, Health, Internal). |
| summary | String | AI-generated "Handoff Summary" for the Senior Specialist. |
4. Logic Flow & AI Integration
Step 1: The Trust Bridge (Phase: WELCOME)
The function first checks if a session exists. If not, it presents the Trust Script, which includes:
 * Security: Mentioning AES-256 equivalent encryption (Wix Data default).
 * Privacy: Highlighting the "Senior Specialist only" access rule.
 * Scope: Disclaiming medical/crisis intervention capabilities.
Step 2: Discovery & Detection (Phase: LEVEL_1)
The function iterates through standard discovery questions. Once the array is exhausted, the backend makes an internal call to the AI API (Gemini or OpenAI) with a classification prompt.
Step 3: Targeted Drilling (Phase: LEVEL_2)
Based on the AI's classification (e.g., "External Stress" due to war), the backend fetches the relevant LEVEL_2_PROMPT. This ensures the user feels understood without a human having to manually switch tracks.
Step 4: Summarization & Handoff
Upon the final answer, the backend triggers a "Summary Agent."
 * Input: Entire responses array.
 * Output: Concatenated Markdown summary containing Primary Source, Narrative Snapshot, and Urgency Keywords.
5. Security & Error Handling
 * Secret Management: AI API keys are stored in the Wix Secrets Manager and accessed via wix-secrets-backend. They are never exposed to the frontend.
 * Red Flag Detection: (Optional but Recommended) A regex filter should scan message for crisis keywords. If triggered, the state machine should jump to a CRISIS_ESCAPE phase and provide immediate emergency numbers.
 * Timeout: Sessions idle for more than 24 hours can be flagged for "Incomplete" via a scheduled Wix Job.
Implementation Note for Junior Developers
> Strict Guardrail: Do not modify the WELCOME text without legal review, as it contains the Informed Consent language necessary for managing sensitive data related to critical disease or war.
> 

# System Documentation: `post_chat(request)`
**Version:** 1.0  
**Last Updated:** February 2026  
**Status:** Functional Specification for AI Scout Deployment

---

## 1. Overview
The `post_chat` function is a stateful backend routine designed for the Wix platform. It manages a multi-stage "Pyramid" interview process to identify root causes of stress (Relational, Financial, Health, External, or Internal). It serves as the primary bridge between the user-facing UI and the AI processing engine.

## 2. Technical Specification
* **Endpoint:** `https://yourdomain.com/_functions/chat`
* **Method:** `POST`
* **Backend Environment:** Wix Velo (Node.js runtime)
* **Database:** Wix Data Collections (`StressSessions`)

---

## 3. The Conversation State Machine
The backend utilizes a linear state machine to ensure logical progression and data integrity.



| Phase | Description | Transition Trigger |
| :--- | :--- | :--- |
| **WELCOME** | Consent & Trust Bridge. | Any user input. |
| **LEVEL_1** | Discovery (General Questions). | Completion of Question Array. |
| **LEVEL_2** | Drill-down (Category Specific). | AI classification of L1 data. |
| **COMPLETED** | Summary generation & Handoff. | Final L2 response received. |

---

## 4. Database Schema: `StressSessions`
The system relies on a persistent cache to manage conversation history across stateless HTTP hits.

| Field Key | Type | Description |
| :--- | :--- | :--- |
| `_id` | String | Session ID / User identifier. |
| `phase` | String | Current state of the pyramid. |
| `questionIndex`| Number | Index of the current L1 question. |
| `category` | String | Stress category identified by AI. |
| `responses` | Array | Objects containing `{ "q": string, "a": string }`. |
| `consentAt` | DateTime | Timestamp of user agreement. |

---

## 5. Logical Flow & AI Hooks

### A. Phase: WELCOME (Trust & Privacy)
* **Logic:** If `sessionId` is not found, initialize session and return `WELCOME_TEXT`.
* **Purpose:** Establishes informed consent regarding data encryption and the "Human-in-the-Loop" review process.

### B. Phase: LEVEL_1 (General Assessment)
* **Logic:** Iterates through `LEVEL_1_QUESTIONS`.
* **Data Capture:** Stores verbatim responses in the `responses` array.

### C. Phase: LEVEL_2 (AI Classification)
* **Trigger:** Triggered automatically after the last L1 answer.
* **AI Prompt:** "Analyze [responses] and classify into: Financial, Relational, External, Health, or Internal."
* **Result:** Updates `session.category` and fetches the corresponding drill-down question.

### D. Phase: COMPLETED (Synthesis)
* **Logic:** Calls the AI "Summarizer" agent.
* **Output:** Generates a concise Handoff Summary including:
    * Primary Stressor
    * Narrative Snapshot (Context)
    * Urgency/Risk Keywords

---

## 6. Security & Governance
1.  **Encryption:** Data is stored in Wix's secure environment.
2.  **API Safety:** AI keys are retrieved via `wix-secrets-backend` and never exposed to the client.
3.  **Scope Boundary:** The system includes a mandatory disclaimer that it is not a crisis or medical diagnostic tool.

---

## 7. Error Handling
* **Missing SessionID:** Returns `400 Bad Request`.
* **AI API Timeout:** Defaults to a general "Tell me more" prompt to keep the user engaged while retrying.

# KalatitManisha — App Structure & Navigation

## 1. Core Philosophy
KalatitManisha (कालातीत मनीषा — *Timeless Intellect*) is a contemplative, multi-platform application designed to help users reflect on perennial human dilemmas through the philosophical lens of the Bhagavad Gita.

The app is intentionally **non-prescriptive**:
- it does not offer solutions,
- it does not diagnose,
- it does not replace professional or spiritual guidance.

Instead, it provides structured reflection, resonance, and study.

---

## 2. High-Level Layout Model

The application follows a **panel-based layout with routed central content**.

### Always-live structural regions
1. Header  
2. Footer  
3. Left Panel (Navigation)  
4. Right Panel (Context Selectors)  

### Dynamic region
5. Central Panel (Screens)

Only the **Central Panel** changes when navigating between pages/screens.

---

## 3. Platform-specific Behavior

### Web
- **Wide displays**: Left and Right panels are visible.
- **Narrow displays**: Panels are hidden and accessible via drawers.

### Mobile (iOS / Android)
- Left and Right panels are hidden by default.
- Panels can be opened via drawer handles.
- Tapping outside a drawer closes it.

Panel visibility is a *presentation concern*, not a navigation concern.

---

## 4. Panels and Their Responsibilities

### Left Panel — Main Navigation
- Houses the primary menu:
  - Home
  - Explore
  - Gita Verse
  - Dilemma
  - About (and future items)
- Does not change application state beyond navigation.

### Right Panel — Context Selectors
- Language selector
- Country selector
- Chapter selector
- Verse selector

Selections are cached and persisted across sessions.

---

## 5. Central Panel — Screens

The Central Panel renders **one screen at a time** based on routing.

All screens live under:
Project Context: KalatitManisha (Responsive App Shell)

Role for Assistant: Senior React/React Native Developer
Current Status: Moving a high-fidelity React (Web) prototype into the production repository.

1. Architectural Overview

We are building a responsive "Holy Grail" layout application that works seamlessly across Mobile, Tablet, and Desktop. The layout logic is defined as follows:

Framework: React (Functional Components)

Styling: Tailwind CSS

Icons: Lucide-React

Navigation Pattern: Sidebars for Tablet/Desktop, Drawer for Mobile.

2. Layout Rules (Strict)

The app uses a strict Flexbox implementation to ensure 3 separate scrolling regions:

Container: h-screen, flex-col, overflow-hidden.

Header/Footer: Fixed height, non-scrollable.

Body Area: flex-1, flex-row, overflow-hidden.

Panels (Left Sidebar, Main Content, Right Sidebar):

All must handle their own scrolling (overflow-y-auto).

Mobile (<768px): Header + Main + Footer. (Left Sidebar accessible via Overlay/Drawer).

Tablet (768px - 1024px): Header + Left Sidebar + Main + Footer.

Desktop (>1024px): Header + Left Sidebar + Main + Right Sidebar + Footer.

3. Implementation Logic (Reference Code)

I have a prototype App.jsx that uses the following Tailwind pattern for the layout:

// Simplified Structure
<div className="flex flex-col h-screen overflow-hidden">
  <header className="h-16 shrink-0" />
  
  <div className="flex flex-1 overflow-hidden">
    {/* Left Sidebar: Hidden on mobile, Flex on md+ */}
    <aside className="hidden md:flex w-64 overflow-y-auto" />
    
    {/* Main Content: Always visible, takes remaining space */}
    <main className="flex-1 overflow-y-auto" />
    
    {/* Right Sidebar: Hidden on mobile/tablet, Block on lg+ */}
    <aside className="hidden lg:block w-72 overflow-y-auto" />
  </div>

  <footer className="h-14 shrink-0" />
</div>


4. Immediate Tasks for VS Code

Please assist me with the following in the KalatitManisha project:

Component Extraction: Refactor the prototype into separate files:

components/layout/Header.tsx

components/layout/SidebarLeft.tsx

components/layout/SidebarRight.tsx

components/layout/MobileDrawer.tsx

screens/Dashboard.tsx

Native Adaptation (If applicable):

If this is a React Native project, convert HTML tags (div, span) to Native components (View, Text, SafeAreaView).

Convert overflow-y-auto elements to <ScrollView> or <FlatList>.

If using NativeWind, keep the Tailwind classes. If not, convert to StyleSheet.

Routing: Prepare the navigation structure (React Navigation or Expo Router) to fit inside the Main content area.
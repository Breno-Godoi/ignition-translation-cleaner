Ignition Translation Cleaner
A React + TypeScript web application for managing and cleaning translation XML files.

Features
1. Sync Translation
Upload up to translation XML files in Ignition's standard format.

Merge translation keys and values into a single unified XML file.

Detect conflicting translations (different values for the same key).

Download merged XML file:

Includes all unique keys with consistent values.

Excludes conflicting keys but shows them in the UI for manual review.

Workflow
Upload XML files.

Review conflicts flagged in the UI.

Download the merged translation file.

XML Format Example:

```
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE properties SYSTEM "http://java.sun.com/dtd/properties.dtd">
<properties>
  <comment>Locale: en</comment>
  <entry key="#disable_picker_tool_d">disable picker tool d</entry>
  <entry key="#shift">shift</entry>
  <entry key="#create">create</entry>
</properties>
```

2. Translation Cleaner (Work in Progress)
This feature helps developers find unused or missing translations within an Ignition project export:

Upload an Ignition project export.

Upload one translation XML file.

The application scans through project files (views, scripts, tags, etc.) for all translation keys present in the XML file.

Reports unused keys (present in XML but not referenced in the project).

Reports missing translations (keys referenced in the project but not present in the XML).

Planned Output:
A filtered XML with only used keys.

A list of missing keys for manual translation.

Tech Stack
React + TypeScript (UI)

Vite (build tool)

Bootstrap (styling)

fast-xml-parser (XML parsing)

Development Setup

# Install dependencies
npm install

# Run development server
npm run dev

# Build production version
npm run build

# Preview production build
npm run preview


Future Enhancements
Manual resolution of conflicts (choose which value to keep).

Export conflict report as CSV or JSON.

Full implementation of Translation Cleaner (with project-wide scanning).

Multi-language translation merging and validation.

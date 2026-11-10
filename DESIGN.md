---
name: Neighborhood Projection Studio
description: Source-derived survey drawing folio; browser and finish review pending.
colors:
  primary: "#1748b8"
  primary-soft: "#eaf0ff"
  ink: "#233043"
  ink-muted: "#526277"
  page: "#f5f7fa"
  surface: "#fff"
  field: "#fbfcfe"
  border: "#cbd3df"
  retained-label: "#166534"
  lost-label: "#465267"
  introduced-label: "#92400e"
  selected-point: "#1d4ed8"
  retained-line: "#15803d"
  lost-line: "#52525b"
  introduced-line: "#b45309"
typography:
  body:
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    lineHeight: 1.5
  app-title:
    fontSize: "1.45rem"
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  control-label:
    fontSize: "0.83rem"
    fontWeight: 600
  identifier:
    fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, monospace'
rounded:
  viewport: "3px"
  chip: "4px"
  control: "5px"
spacing:
  compact: "8px"
  control-group: "12px"
  section: "24px"
  shell-inline: "30px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "7px 13px"
  search-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "5px 9px"
    width: "230px"
---

# Design System: Neighborhood Projection Studio

## Overview

**Creative North Star: "Survey drawing folio"**

This document extracts the current source in `web/src/styles.css`, `App.tsx`, `ProjectionScene.tsx`, `view.ts` and `web/index.html`. It inherits the existing `PRODUCT.md`, approved code-first direction and seed `997d7f7f`. It records authored code, not a rendered or approved interface. Browser captures, visual/contrast/accessibility assessment and independent finish review are pending; the associated evidence disposition is **recapture**.

The working scene is a light plotting field beside a connected selected-record margin. A compact study bar opens reports and chooses explicitly synthetic SDK examples. Selection connects a record's original values, its observed projected coordinates and retained, lost or introduced neighbors. The numerical model and imported data remain separate from display geometry and camera state.

**Key Characteristics:**

- One dominant plotting field with aligned record and rank information.
- Cobalt selection, green retained relationships, patterned lost and introduced relationships, and amber introduced labels.
- System sans for controls and prose; monospace for literal IDs, with tabular numerals for data.
- Immediate selection and opt-in camera movement, without ambient animation.

## Colors

The frontmatter records exact authored values; their appearance and contrast have not been measured in a browser. UI custom properties own the control palette. Scene constants separately own point and line colors, so the different cobalt/green/amber values are deliberately recorded as separate observed source roles rather than silently unified.

Use `primary` for active controls, links and focus. `ink` and `ink-muted` distinguish primary text and supporting information on the light surfaces. Retained/lost/introduced states use words and line/mark distinctions as well as color. A selected point has its own scene cobalt; canonical data never depend on the displayed color.

## Typography

Body text is authored at 15px with line-height 1.5. The app title uses 1.45rem, reducing to 1.25rem at the 480px breakpoint. Section headings and compact labels use the source's smaller scale. Font sizes in rem are source values, not measured pixel sizes or a guarantee against user zoom.

The system sans stack was explicitly selected by the direction brief. No external font or new asset is implied. Identifiers use the monospace stack for literal identity; rank and measurement fields use tabular numerals. Formatted numbers are presentation text; the accepted JSON retains the canonical input and analysis values.

## Layout

The shell is capped at 1760px and uses 24px/30px outer padding. The desktop workspace is `minmax(0,3fr)` plus `minmax(320px,1fr)`, with a single 1px rule joining plot and annotation margin. At 1100px it becomes 2fr plus a 300px minimum margin. At 800px it stacks plot then inspector; at 480px shell inline padding is 12px. These are authored breakpoints, not verified responsive screenshots.

The scene viewport uses a 350px–720px height clamp around 60vh; small layouts use the source's alternate clamp/fixed 340px height. Diagnostic values form a compact wrapping strip, not separate metric cards. The catalogue shows 16 rows per page. Constant input hides the scatter and uses that catalogue for selection. The coincident-point preview is capped at 16 IDs, with a PT/EN direction to the complete catalogue.

## Elevation & Depth

The source uses flat surfaces and fine rules. It defines no box shadows, glass or ornamental gradients. Active controls use a border and tonal fill; keyboard focus uses a 3px cobalt outline with 3px offset. Those authored states do not by themselves establish contrast or accessibility conformance.

## Shapes

Controls use 5px corners, record chips 4px and the plotting viewport 3px. Tables and data rows use simple rules and aligned cells. The plot's circles, squares, diamonds and line patterns encode actual selected/report relationships; no decorative chart or invented cluster shape belongs in this surface.

## Components

Primary buttons name the action, with a dark cobalt hover state. Secondary controls use a light surface and a 1px border; disabled/loading/error states are explicit in source. Search fields have a visible border, cobalt caret and source-defined focus treatment. Selection, caret, underline offset and scrollbars are themed in the stylesheet.

The scene offers 3D controls and a 2D PC1/PC2 fallback. The fallback does not recompute the 3D neighborhood model. CPU binary64 normalization precedes Float32 geometry; canonical coordinates and ranks stay in the accepted report. Camera interaction is opt-in, with accessible step buttons and lifecycle cleanup, but actual WebGL/pointer behavior has not been exercised in a browser.

PT-BR is the default and EN is a presentation choice. User imports remain explicitly unverified even when input hashes or producer metadata match a bundled sample. Only controlled bundled-sample operations receive the synthetic-example provenance label.

## Do's and Don'ts

- **Do** preserve the one-plot/connected-margin composition and literal stable IDs.
- **Do** keep camera/display transformations separate from numerical analysis.
- **Do** preserve the exact first-body direction comment through the production build.
- **Do** keep native evidence, source inspection and browser evidence distinct.
- **Don't** introduce marketing heroes, metric-card walls, ambient motion, external fonts or decorative data.
- **Don't** label imported producer/hash metadata as verified execution.
- **Don't** announce visual, GPU, pointer or accessibility approval without valid browser evidence and the finish review.

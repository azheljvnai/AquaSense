# Historical Data Dashboard Card Mismatch Bugfix Design

## Overview

The Historical Data page currently displays metric cards using a different structure (`hist-stat-card`) than the Dashboard page (`metric-card scard`). This creates visual inconsistency and a confusing user experience. The fix will replace the Historical Data card structure with the same structure used on the Dashboard, ensuring consistent presentation of water quality metrics across both pages while preserving the statistical calculations (avg, min, max) that are unique to the Historical Data page.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when the Historical Data page renders cards with class "hist-stat-card" instead of "metric-card scard"
- **Property (P)**: The desired behavior - Historical Data cards should use the same structure as Dashboard cards (metric-card scard with sparklines)
- **Preservation**: Existing Dashboard card structure, statistical calculations, threshold-based badge updates, and color schemes that must remain unchanged
- **hist-stat-card**: The current (incorrect) card structure used on Historical Data page with hist-stat-body wrapper and min-max range display
- **metric-card scard**: The correct card structure used on Dashboard page with scard-label, scard-val, scard-badge, and sparkline elements
- **updateStatCards()**: The function in `public/js/features/historical-data.js` that updates the stat card values and badges based on calculated statistics

## Bug Details

### Bug Condition

The bug manifests when a user views the Historical Data page. The page renders metric cards with a different HTML structure than the Dashboard page, causing visual inconsistency. The cards lack sparkline charts, use different icon sizes, display metrics in a different order, and have a different layout structure.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type PageView
  OUTPUT: boolean
  
  RETURN input.page == 'historical-data'
         AND cardStructure(input.page) != cardStructure('dashboard')
         AND cardClass(input.page) == 'hist-stat-card'
         AND NOT hasSparklines(input.page)
END FUNCTION
```

### Examples

- **Example 1**: User navigates to Historical Data page → sees cards with class "hist-stat-card" → cards have different structure than Dashboard (actual: hist-stat-body wrapper with min-max range; expected: scard-label, scard-val, scard-badge structure)
- **Example 2**: User views Historical Data page → sees icons with size 16px → icons are smaller than Dashboard icons (actual: 16px; expected: 20px)
- **Example 3**: User compares card order → Historical Data shows pH, DO, Turbidity, Temperature → Dashboard shows Temperature, pH, DO, Turbidity (actual: different order; expected: same order)
- **Example 4**: User looks for sparkline charts on Historical Data page → no sparkline SVG elements present → cannot see trend visualization (actual: missing sparklines; expected: sparklines present)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Dashboard page cards must continue to display with the existing "metric-card scard" structure and styling
- Historical Data page must continue to calculate and display average, min, and max statistics for each metric
- Historical Data page must continue to update stat card badges based on threshold values (Normal/Warning/Critical)
- Both pages must continue to use the same color scheme for each metric (Temperature=red, pH=blue, DO=green, Turbidity=yellow)
- Historical Data page must continue to update cards when the date range or thresholds change

**Scope:**
All inputs that do NOT involve viewing the Historical Data page should be completely unaffected by this fix. This includes:
- Dashboard page rendering and updates
- Water Quality page rendering
- Statistical calculations for Historical Data metrics
- Threshold-based badge logic
- Color scheme definitions

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Incorrect HTML Structure**: The Historical Data page HTML in `public/index.html` (lines 305-340) uses a different card structure with classes "hist-stat-card", "hist-stat-icon", "hist-stat-body", "hist-stat-label", "hist-stat-val", "hist-stat-range", and "hist-stat-badge" instead of the Dashboard structure with "metric-card scard", "metric-icon", "scard-label", "scard-val", "scard-badge", and sparkline SVG elements.

2. **Missing Sparkline Elements**: The Historical Data cards do not include `<svg class="spark" id="sp-{metric}">` elements that are present on Dashboard cards.

3. **Incorrect Icon Size**: The Historical Data cards use `icon-16` class for icons instead of `icon-20` used on Dashboard.

4. **Different Card Order**: The Historical Data cards are ordered as pH, DO, Turbidity, Temperature instead of Temperature, pH, DO, Turbidity as on Dashboard.

5. **JavaScript Update Logic**: The `updateStatCards()` function in `public/js/features/historical-data.js` targets the old element IDs (hstat-{metric}-avg, hstat-{metric}-min, hstat-{metric}-max, hstat-{metric}-badge) which will need to be updated to match the new structure.

## Correctness Properties

Property 1: Bug Condition - Historical Data Cards Match Dashboard Structure

_For any_ page view where the user navigates to the Historical Data page, the system SHALL render metric cards with class "metric-card scard" matching the Dashboard structure, including sparkline SVG elements with appropriate IDs, icons with size 20px, and cards in the same order as Dashboard (Temperature, pH, DO, Turbidity).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Dashboard and Statistical Calculations Unchanged

_For any_ page view that is NOT the Historical Data page, or any statistical calculation on the Historical Data page, the system SHALL produce exactly the same behavior as the original code, preserving Dashboard card structure, average/min/max calculations, threshold-based badge updates, and color schemes.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `public/index.html`

**Section**: Historical Data stat cards (lines 305-340)

**Specific Changes**:
1. **Replace Card Structure**: Replace the four `hist-stat-card` divs with `metric-card scard` divs matching the Dashboard structure
   - Change class from "hist-stat-card" to "metric-card scard {metric-class}"
   - Change "hist-stat-icon" to "metric-icon" with icon-20 instead of icon-16
   - Remove "hist-stat-body" wrapper div
   - Change "hist-stat-label" to "scard-label"
   - Change "hist-stat-val" to "scard-val"
   - Change "hist-stat-badge" to "scard-badge"
   - Remove "hist-stat-range" div (min-max display)
   - Add `<svg class="spark" id="sp-{metric}">` elements

2. **Reorder Cards**: Change card order from pH, DO, Turbidity, Temperature to Temperature, pH, DO, Turbidity to match Dashboard

3. **Update Element IDs**: Change IDs to match Dashboard pattern:
   - "hstat-{metric}-avg" → "v-{metric}" (for the value display)
   - "hstat-{metric}-badge" → "b-{metric}" (for the badge)
   - Remove "hstat-{metric}-min" and "hstat-{metric}-max" IDs (no longer displayed in cards)

**File**: `public/js/features/historical-data.js`

**Function**: `updateStatCards()`

**Specific Changes**:
4. **Update JavaScript Selectors**: Modify the `updateStatCards()` function to target the new element IDs:
   - Change `getElementById('hstat-${k}-avg')` to `getElementById('v-${k}')`
   - Change `getElementById('hstat-${k}-badge')` to `getElementById('b-${k}')`
   - Remove references to `hstat-${k}-min` and `hstat-${k}-max` elements

5. **Preserve Statistical Display**: Since min/max values will no longer be displayed in the cards, consider if this information should be preserved elsewhere (e.g., tooltip, separate section) or if displaying only the average is acceptable for the unified design

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that inspect the DOM structure of the Historical Data page and compare it to the Dashboard page structure. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Card Structure Test**: Navigate to Historical Data page and verify cards have class "hist-stat-card" (will fail on unfixed code - should be "metric-card scard")
2. **Sparkline Test**: Check for presence of `<svg class="spark">` elements on Historical Data cards (will fail on unfixed code - sparklines missing)
3. **Icon Size Test**: Verify Historical Data card icons use class "icon-16" (will fail on unfixed code - should be "icon-20")
4. **Card Order Test**: Verify Historical Data cards are ordered pH, DO, Turbidity, Temperature (will fail on unfixed code - should be Temperature, pH, DO, Turbidity)

**Expected Counterexamples**:
- Historical Data cards use "hist-stat-card" class instead of "metric-card scard"
- Historical Data cards missing sparkline SVG elements
- Historical Data cards use 16px icons instead of 20px
- Historical Data cards in different order than Dashboard

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (viewing Historical Data page), the fixed code produces the expected behavior (cards match Dashboard structure).

**Pseudocode:**
```
FOR ALL pageView WHERE isBugCondition(pageView) DO
  result := renderHistoricalDataPage_fixed(pageView)
  ASSERT cardStructure(result) == cardStructure('dashboard')
  ASSERT hasSparklines(result) == true
  ASSERT iconSize(result) == 20
  ASSERT cardOrder(result) == ['temp', 'ph', 'do', 'turb']
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (viewing other pages, performing calculations), the fixed code produces the same result as the original code.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT originalBehavior(input) = fixedBehavior(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for Dashboard rendering and statistical calculations, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Dashboard Preservation**: Observe that Dashboard cards render correctly on unfixed code, then write test to verify this continues after fix
2. **Statistical Calculation Preservation**: Observe that avg/min/max calculations work correctly on unfixed code, then write test to verify this continues after fix
3. **Badge Update Preservation**: Observe that threshold-based badge updates work correctly on unfixed code, then write test to verify this continues after fix
4. **Color Scheme Preservation**: Observe that color schemes are consistent on unfixed code, then write test to verify this continues after fix

### Unit Tests

- Test DOM structure of Historical Data cards matches Dashboard cards after fix
- Test that sparkline elements are present on Historical Data cards
- Test that icon sizes are 20px on Historical Data cards
- Test that card order matches Dashboard order
- Test that `updateStatCards()` function correctly updates the new element IDs
- Test that statistical calculations (avg, min, max) continue to work correctly

### Property-Based Tests

- Generate random sensor readings and verify Historical Data cards display correct average values
- Generate random threshold configurations and verify badge updates work correctly on Historical Data page
- Generate random date ranges and verify cards update correctly when range changes
- Test that Dashboard cards remain unchanged across many page navigation scenarios

### Integration Tests

- Test full user flow: navigate to Dashboard → see cards → navigate to Historical Data → see matching card structure
- Test that both pages update correctly when new sensor readings arrive
- Test that threshold changes update badges on both Dashboard and Historical Data pages
- Test that sparklines render correctly on both pages (though Historical Data sparklines may not be populated initially)

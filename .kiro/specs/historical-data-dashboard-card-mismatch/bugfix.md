# Bugfix Requirements Document

## Introduction

The Historical Data page displays metric cards that are inconsistent with the Dashboard page's metric cards. Users expect the same visual format and information display across both views, but currently the Historical Data cards use a different structure (hist-stat-card) compared to the Dashboard cards (metric-card scard). This creates a confusing user experience where the same metrics are presented differently depending on which page the user is viewing.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN viewing the Historical Data page THEN the system displays cards with class "hist-stat-card" that have a different structure than dashboard cards

1.2 WHEN viewing the Historical Data page THEN the system displays cards without sparkline charts (missing `<svg class="spark">` elements)

1.3 WHEN viewing the Historical Data page THEN the system displays cards with a "hist-stat-body" wrapper and min-max range display instead of the simple label-value-badge structure used on the dashboard

1.4 WHEN viewing the Historical Data page THEN the system displays icons with size 16px instead of 20px as used on the dashboard

1.5 WHEN viewing the Historical Data page THEN the system displays cards in a different order (pH, DO, Turbidity, Temperature) compared to the dashboard (Temperature, pH, DO, Turbidity)

### Expected Behavior (Correct)

2.1 WHEN viewing the Historical Data page THEN the system SHALL display cards with class "metric-card scard" matching the dashboard structure

2.2 WHEN viewing the Historical Data page THEN the system SHALL display cards with sparkline charts (`<svg class="spark">` elements with appropriate IDs)

2.3 WHEN viewing the Historical Data page THEN the system SHALL display cards with the same label-value-badge structure as the dashboard (scard-label, scard-val, scard-badge)

2.4 WHEN viewing the Historical Data page THEN the system SHALL display icons with size 20px matching the dashboard

2.5 WHEN viewing the Historical Data page THEN the system SHALL display cards in the same order as the dashboard (Temperature, pH, DO, Turbidity)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN viewing the Dashboard page THEN the system SHALL CONTINUE TO display metric cards with the existing structure and styling

3.2 WHEN viewing the Historical Data page THEN the system SHALL CONTINUE TO calculate and display average, min, and max statistics for each metric

3.3 WHEN viewing the Historical Data page THEN the system SHALL CONTINUE TO update stat card badges based on threshold values (Normal/Warning/Critical)

3.4 WHEN viewing either page THEN the system SHALL CONTINUE TO use the same color scheme for each metric (Temperature=red, pH=blue, DO=green, Turbidity=yellow)

3.5 WHEN viewing the Historical Data page THEN the system SHALL CONTINUE TO update cards when the date range or thresholds change

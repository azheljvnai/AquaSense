# Bugfix Requirements Document

## Introduction

The Historical Data cards (with IDs `hist-v-{metric}` and `hist-b-{metric}`) are not displaying live sensor values from the Dashboard. Instead, they only show historical averages calculated from past readings. This creates a discrepancy where the Dashboard cards show current real-time values while the Historical Data cards show outdated averaged data. Users expect both card sets to display the same current live sensor readings.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN new sensor data arrives and `updateCard(key, val)` is called THEN the system only updates Dashboard cards (`v-{metric}` and `b-{metric}`) and does not update Historical Data cards (`hist-v-{metric}` and `hist-b-{metric}`)

1.2 WHEN Historical Data cards are displayed THEN the system shows historical averages from `updateStatCards()` instead of current live sensor values

1.3 WHEN a user views both Dashboard and Historical Data sections THEN the system displays different values for the same metrics, causing confusion

### Expected Behavior (Correct)

2.1 WHEN new sensor data arrives and `updateCard(key, val)` is called THEN the system SHALL update both Dashboard cards (`v-{metric}` and `b-{metric}`) AND Historical Data cards (`hist-v-{metric}` and `hist-b-{metric}`) with the same live value

2.2 WHEN Historical Data cards are displayed THEN the system SHALL show the current live sensor values matching the Dashboard cards

2.3 WHEN a user views both Dashboard and Historical Data sections THEN the system SHALL display identical current values for the same metrics

### Unchanged Behavior (Regression Prevention)

3.1 WHEN new sensor data arrives THEN the system SHALL CONTINUE TO update Dashboard cards (`v-{metric}` and `b-{metric}`) with live values and badges

3.2 WHEN new sensor data arrives THEN the system SHALL CONTINUE TO update Water Quality monitoring cards (`wq-avg-{metric}` and `wq-pond-{metric}`) with live values

3.3 WHEN new sensor data arrives THEN the system SHALL CONTINUE TO add values to sparkline data arrays and draw sparkline charts

3.4 WHEN new sensor data arrives THEN the system SHALL CONTINUE TO log critical, stress, and warning conditions

3.5 WHEN Historical Data range is changed THEN the system SHALL CONTINUE TO calculate and display historical statistics (min, max, avg) for the selected time range

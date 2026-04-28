# Bugfix Requirements Document

## Introduction

The historical data graph is empty when the user first navigates to the Historical Data page. The `init()` function calls `refresh()` at startup, but `refresh()` defaults to the `week` range and only fetches data for the current calendar week — meaning no automatic fetch of the last 24 hours occurs on initialization. Additionally, the default view should display only the most recent 6 hours of data, with horizontal scrolling to navigate through earlier timestamps in the 24-hour window.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user navigates to the Historical Data page for the first time THEN the system renders an empty graph with no data visible

1.2 WHEN the Historical Data page initializes THEN the system defaults to the `week` range instead of fetching the last 24 hours of available data

1.3 WHEN the 24h range is selected and data exists THEN the system does not automatically scroll the chart to show the most recent 6 hours as the default visible window

### Expected Behavior (Correct)

2.1 WHEN the user navigates to the Historical Data page for the first time THEN the system SHALL automatically fetch and render the last 24 hours of available sensor data

2.2 WHEN the Historical Data page initializes THEN the system SHALL default to the `24h` range and trigger a data fetch from RTDB for the last 24 hours

2.3 WHEN the 24h range is active and data is loaded THEN the system SHALL display only the most recent 6 hours in the visible chart viewport by default, with the chart scrolled to the rightmost (most recent) position

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the user manually selects the `week`, `month`, or `custom` range THEN the system SHALL CONTINUE TO fetch and render data for the selected range correctly

3.2 WHEN the user switches between metric tabs (All, pH, DO, Turbidity, Temp) THEN the system SHALL CONTINUE TO toggle dataset visibility without re-fetching data

3.3 WHEN a new sensor reading arrives while the Historical Data page is active THEN the system SHALL CONTINUE TO append the reading to the chart in real time

3.4 WHEN the user applies a custom date range THEN the system SHALL CONTINUE TO validate the date inputs and fetch data for the specified range

3.5 WHEN the 24h range is active THEN the system SHALL CONTINUE TO support horizontal scrolling so the user can navigate through earlier timestamps beyond the default 6-hour visible window

3.6 WHEN the user exports CSV data THEN the system SHALL CONTINUE TO export all readings for the currently selected range

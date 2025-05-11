# TDD Dashboard User Guide

## Overview

The TDD (Test-Driven Development) Dashboard provides a visual interface for monitoring and controlling the TDD process in your VS Code environment. It helps you:

- Visualize test execution progress over time
- See code coverage statistics for your projects
- Configure TDD behavior to match your workflow
- Interact with test results directly in VS Code

## Features

### 1. TDD Dashboard Panel

The TDD Dashboard is accessible through the AI Development Monitor panel. You can open it by:
- Clicking the "TDD Dashboard" button in the toolbar
- Selecting the "TDD Dashboard" tab in the AI Development Monitor panel
- Using the command palette: `AI Dev: Show TDD Dashboard`

### 2. Real-time Test Progress Visualization

The progress visualization displays a history of your test runs, showing:
- Pass/fail trends over time
- Test coverage improvements
- Key test metrics

### 3. Code Coverage Highlighting

When you open a file from the coverage section:
- Lines covered by tests will be highlighted in green
- Uncovered lines will be highlighted in red
- Hover over highlighted lines to see coverage details

To toggle the coverage highlighting:
- Use the "Show inline coverage" option in the TDD Configuration section

### 4. TDD Configuration Options

Customize your TDD workflow with these settings:
- **Auto-run tests**: Automatically run tests when you save code changes
- **Show inline coverage**: Toggle code coverage highlighting in the editor
- **Default iterations**: Set how many TDD iterations to run (3, 5, or 10)
- **Test framework**: Choose a specific test framework or use auto-detection

These settings can be changed directly in the dashboard or through VS Code settings (`aiDevelopmentMonitor.tdd.*`).

### 5. Interactive Test Results Display

The test results section shows:
- Test execution stats by iteration
- Pass/fail status with visual indicators
- Quick access to test code with the "View Tests" button

## Using the TDD Dashboard

1. Start by writing or loading your code
2. Click "Run Diagnostic Test" to begin TDD analysis
3. View the results in the dashboard
4. Use the configuration options to customize behavior
5. Click on files in the coverage section to see highlighted code
6. View test details by clicking "View Tests" in the results section

## Additional Information

For more information on TDD methodologies and best practices, visit the [TDD Flow Documentation](/docs/tdd_flow.md).

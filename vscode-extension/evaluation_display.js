/**
 * Initialize the evaluation display module
 * @param {Object} options Configuration options
 */
function initialize(options) {
    // Store references to required dependencies
    const { context, statusBarItem, AIMonitorPanel, notificationHandler } = options;
    
    // Store references for later use
    this.context = context;
    this.statusBarItem = statusBarItem;
    this.AIMonitorPanel = AIMonitorPanel;
    this.notificationHandler = notificationHandler;
    
    // Additional initialization logic
    console.log('Evaluation display module initialized');
}

/**
 * Show evaluation results in both the panel and as notifications
 * @param {Object} evaluation The evaluation result
 * @param {Object} suggestionData The original suggestion data
 */
function showEvaluationResult(evaluation, suggestionData) {
  // Store the evaluation for later use
  lastEvaluation = evaluation;
  
  Logger.info(`Showing evaluation result: ${evaluation.accept ? 'ACCEPTED' : 'REJECTED'}`, 'evaluation');
  
  // Show in panel if available
  if (AIMonitorPanel.currentPanel) {
    AIMonitorPanel.currentPanel.setEvaluationResults(evaluation);
    Logger.debug('Displayed evaluation in monitor panel', 'evaluation');
  } else {
    // Auto-show panel based on user preference
    const config = vscode.workspace.getConfiguration('aiDevelopmentMonitor');
    if (config.get('showPanel', true)) {
      Logger.debug('Auto-showing monitor panel', 'evaluation');
      const panel = AIMonitorPanel.createOrShow(context);
      panel.setEvaluationResults(evaluation);
    }
  }
  
  // Show notification based on user preferences
  notificationHandler.showEvaluationResult(evaluation, suggestionData);
  
  // Update status bar
  updateStatusBar();
}

// Export the functions
module.exports = {
    initialize,
    showEvaluationResult
};
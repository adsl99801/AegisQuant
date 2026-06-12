/**
 * Code.gs
 * 程式入口點
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('量化回測系統')
    .addItem('1. 初始化與抓取資料', 'setupAndFetchData')
    .addItem('2. 執行回測', 'runBacktest')
    .addItem('3. 查看最近三次再平衡', 'showAnalysis')
    .addItem('4. 清除回測結果', 'clearBacktestResults')
    .addItem('5. 繪製績效走勢圖', 'drawPerformanceChart')
    .addItem('6.testSendEmail', 'testSendEmail')
    .addItem('7.rebalanceCal', 'rebalanceCal')
    .addToUi();
}
function testSendEmail() {
  const recipient = 'adsl99801@gmail.com';
  const subject = '量化回測通知 - 完成 (無訊號)';
  const msg = '回測已完成，但未產生任何訊號。';
  
  // 發送郵件
  GmailApp.sendEmail(recipient, subject, msg);
  
  Logger.log('郵件已發送至: ' + recipient);
}
function setupAndFetchData() {
  MarketDataFetcher.fetchAndSetup();
}

function runBacktest() {
  RebalanceController.run();
}

function showAnalysis() {
  Analysis.showLastRebalances(3);
}

function drawPerformanceChart() {
  Analysis.drawChart();
}

function clearBacktestResults() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.alert('確認清除', '確定要清除所有回測結果嗎？這將無法復原。', ui.ButtonSet.YES_NO);
  
  if (response == ui.Button.YES) {
    DailyLogger.init(true);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var chartSheet = ss.getSheetByName('Performance Chart');
    if (chartSheet) ss.deleteSheet(chartSheet);
    ui.alert('回測結果已清除。');
  }
}


function rebalanceCal() {
  RebalanceCalculator.run();
}

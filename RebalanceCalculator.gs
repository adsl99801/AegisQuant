/**
 * RebalanceCalculator.gs
 * 負責執行參數化的再平衡試算
 */
var RebalanceCalculator = {
  run: function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('Rebalance Calculator');
    
    // 1. 初始化工作表 (若不存在)
    if (!sheet) {
      sheet = ss.insertSheet('Rebalance Calculator');
      
      // 設定標題與預設值
      sheet.getRange('A1').setValue('總資金 (USD)');
      sheet.getRange('B1').setValue(54000); 
      
      var headers = ['標的', '當前權重 (%)', '目標權重 (%)', '即時現價', '現股', '目標股', '建議操作'];
      sheet.getRange('A3:G3').setValues([headers]);
      sheet.getRange('A3:G3').setBackground('#e0e0e0').setFontWeight('bold');
      
      // 從 DailyLog 讀取最後一筆的目標權重
      var dailyLog = ss.getSheetByName('DailyLog');
      var defaults = [];
      
      if (dailyLog && dailyLog.getLastRow() > 1) {
        var lastRow = dailyLog.getLastRow();
        var headers = dailyLog.getRange(1, 1, 1, dailyLog.getLastColumn()).getValues()[0];
        var lastData = dailyLog.getRange(lastRow, 1, 1, dailyLog.getLastColumn()).getValues()[0];
        
        var parseWeight = function(str) {
          // 格式: "10.00 / 25.5%"，提取百分比
          if (!str || str === '') return 0;
          var parts = String(str).split(' / ');
          if (parts.length >= 2) {
            var pctStr = parts[1].replace('%', '');
            return Number(pctStr) / 100; // 轉換為小數
          }
          return 0;
        };
        
        defaults = Constants.TICKERS.map(function(t) {
          var colIdx = headers.indexOf(t + '_股數/佔比');
          var weight = (colIdx > -1) ? parseWeight(lastData[colIdx]) : 0;
          return [t, 0, weight];
        });
      } else {
        // 如果沒有 DailyLog，使用預設值
        defaults = Constants.TICKERS.map(function(t) {
          return [t, 0, Constants.BASE_WEIGHTS[t] || 0];
        });
      }
      
      sheet.getRange(4, 1, defaults.length, 3).setValues(defaults);
      
      // 格式化百分比
      sheet.getRange('B4:C100').setNumberFormat('0.00%');
      
      // 調整欄寬
      sheet.setColumnWidth(1, 80);
      sheet.setColumnWidth(7, 120);
      
      SpreadsheetApp.getUi().alert('已建立「Rebalance Calculator」工作表。\n目標權重已從 DailyLog 最後一筆自動填入。\n請在 B1 輸入總資金，再次執行即可計算。');
      return;
    }
    
    // 2. 讀取參數
    var capital = sheet.getRange('B1').getValue();
    var lastRow = sheet.getLastRow();
    if (lastRow < 4) {
      SpreadsheetApp.getUi().alert('請在第4列開始輸入標的資料。');
      return;
    }
    
    // 讀取 A ~ C 欄 (標的, 當前%, 目標%)
    var range = sheet.getRange(4, 1, lastRow - 3, 3);
    var data = range.getValues(); 
    
    // 正規化目標權重總和
    var totalTgt = 0;
    data.forEach(function(r) { totalTgt += (Number(r[2]) || 0); });
    
    // 簡易價格抓取函數 (Yahoo)
    var getPrice = function(ticker) {
      try {
        var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?interval=1d&range=1d';
        var response = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
        var json = JSON.parse(response.getContentText());
        if (json.chart && json.chart.result && json.chart.result.length > 0) {
          return json.chart.result[0].meta.regularMarketPrice;
        }
        return 0;
      } catch(e) {
        Logger.log("Error fetching " + ticker + ": " + e);
        return 0;
      }
    };
    
    var outputRows = [];
    
    for (var i = 0; i < data.length; i++) {
      var ticker = data[i][0];
      var currPct = Number(data[i][1]) || 0;
      var rawTgtPct = Number(data[i][2]) || 0;
      
      if (!ticker) {
        outputRows.push(['', '', '', '']); 
        continue;
      }
      
      var price = getPrice(ticker);
      
      // 計算邏輯
      var normalizedTgt = (totalTgt > 0) ? (rawTgtPct / totalTgt) : 0;
      
      var currVal = capital * currPct;
      var currShares = (price > 0) ? Math.floor(currVal / price) : 0;
      
      var tgtVal = capital * normalizedTgt;
      var tgtShares = (price > 0) ? Math.floor(tgtVal / price) : 0;
      
      var diff = tgtShares - currShares;
      var action = diff > 0 ? "買入 " + diff : (diff < 0 ? "賣出 " + (-diff) : "持倉");
      
      if (price <= 0) {
        action = "抓取失敗";
        price = 0;
      }
      
      outputRows.push([price, currShares, tgtShares, action]);
    }
    
    // 3. 寫入結果 (D ~ G 欄)
    if (outputRows.length > 0) {
      sheet.getRange(4, 4, outputRows.length, 4).setValues(outputRows);
    }
    
    SpreadsheetApp.getUi().alert('計算完成！結果已更新至 Rebalance Calculator 工作表。\n(目標權重已自動歸一化)');
  }
};

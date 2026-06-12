/**
 * DailyLogger.gs
 * 用來記錄每日回測結果
 */
var DailyLogger = {
  sheet: null,

  init: function(clear) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    this.sheet = ss.getSheetByName('DailyLog');
    if (!this.sheet) {
      this.sheet = ss.insertSheet('DailyLog');
    }
    if (clear) {
      this.sheet.clear();
      var headers = [
        '日期', '淨值/成本/%', 
        Constants.TICKERS.join('/') + '/VIX %', 
        '當年內大盤績效/此策略績效',  
        '訊號', '策略說明', '操作', 'Portfolio詳情'
      ];
      Constants.TICKERS.forEach(function(t) {
        headers.push(t + '_股數/佔比');
      });
      this.sheet.appendRow(headers);
      this.sheet.setFrozenRows(1); // Freeze the header row
    }
  },

  appendBatch: function(records) {
    var rows = records.map(function(r) {
      var row = [
        Utils.formatDate(new Date(r.date)),
        (r.valueCost || ''),
        (r.tickerChanges || ''),
        (r.ytdComparison || ''),
        (r.reason || ''),
        (r.description || ''),
        (r.actionLog || ''),
        (r.portfolioDetails || '')
      ];
      Constants.TICKERS.forEach(function(t) {
        row.push(r[t.toLowerCase()] || '');
      });
      return row;
    });
    this.sheet.getRange(this.sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  },

  getLastRowData: function() {
    if (!this.sheet || this.sheet.getLastRow() < 2) return null;
    var lastRow = this.sheet.getLastRow();
    var row = this.sheet.getRange(lastRow, 1, 1, this.sheet.getLastColumn()).getValues()[0];
    return {
        date: new Date(row[0]),
        valueCost: row[1],
        ytdComparison: row[3],
        portfolioDetails: row[7] // Key for restoration
    };
  },

  deleteLastNRows: function(n) {
    if (!this.sheet) return;
    var lastRow = this.sheet.getLastRow();
    if (lastRow < 2) return; // Header only
    
    var rowsToDelete = Math.min(n, lastRow - 1); // Keep header
    if (rowsToDelete > 0) {
      this.sheet.deleteRows(lastRow - rowsToDelete + 1, rowsToDelete);
      LoggerWrapper.log('Deleted last ' + rowsToDelete + ' rows from DailyLog.');
    }
  },

  getLastNRows: function(n) {
    var lastRow = this.sheet.getLastRow();
    if (lastRow <= 1) return [];
    var startRow = Math.max(2, lastRow - n + 1);
    return this.sheet.getRange(startRow, 1, lastRow - startRow + 1, this.sheet.getLastColumn()).getValues().map(function(row) {
      var record = {
        date: row[0],
        valueCost: row[1],
        tickerChanges: row[2],
        ytdComparison: row[3],
        reason: row[4],
        description: row[5],
        actionLog: row[6],
        portfolioDetails: row[7]
      };
      Constants.TICKERS.forEach(function(t, idx) {
        record[t.toLowerCase()] = row[8 + idx];
      });
      return record;
    });
  }
};

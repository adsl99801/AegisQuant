/**
 * MarketDataFetcher.gs
 * 負責從 Yahoo Finance 抓取資料並整理
 */
var MarketDataFetcher = {
  fetchAndSetup: function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // 1. Determine Start Date (Resume or Fresh)
    // Default: Fetch 200 days prior to START_DATE for Warm Up (MA100)
    var startDateObj = new Date(Constants.START_DATE);
    startDateObj.setDate(startDateObj.getDate() - 200);
    var startDate = startDateObj.toISOString().split('T')[0];

    var sheets = ss.getSheets();
    var lastYear = 0;
    
    // Find latest year sheet
    sheets.forEach(function(s) {
       var name = s.getName();
       if (name.match(/^\d{4}Data$/)) {
          var y = parseInt(name.substring(0, 4));
          if (y > lastYear) lastYear = y;
       }
    });

    // 2. Fetch Data
    var allTickers = Constants.TICKERS.concat([Constants.BENCHMARK, Constants.VIX]);
    var expectedCols = 1 + allTickers.length * 5;

    if (lastYear > 0) {
       var lastSheet = ss.getSheetByName(lastYear + 'Data');
       if (lastSheet && lastSheet.getLastRow() > 1) {
          // Check Schema Compatibility
          if (lastSheet.getLastColumn() === expectedCols) {
              var lastDateVal = lastSheet.getRange(lastSheet.getLastRow(), 1).getValue();
              if (lastDateVal) {
                 var lastDateObj = new Date(lastDateVal);
                 if (!isNaN(lastDateObj.getTime())) {
                    // Resume from 14 days ago to cover updates
                    var resumeDate = new Date(lastDateObj);
                    resumeDate.setDate(resumeDate.getDate() - 14);
                    startDate = resumeDate.toISOString().split('T')[0];
                    LoggerWrapper.log('Resuming data fetch from: ' + startDate);
                 }
              }
          } else {
              LoggerWrapper.log('Schema mismatch detected (Sheet: ' + lastSheet.getLastColumn() + ', Expected: ' + expectedCols + '). Forcing full re-fetch.');
          }
       }
    }
    
    // 2. Fetch Data in Parallel
    var dataMap = {};
    var dates = new Set();
    var requests = [];
    var activeTickers = [];
    
    allTickers.forEach(function(ticker) {
      if (!ticker) return;
      activeTickers.push(ticker);
      
      var start = Math.floor(new Date(startDate).getTime() / 1000);
      var endDateObj = new Date(Constants.END_DATE);
      endDateObj.setDate(endDateObj.getDate() + 1);
      var end = Math.floor(endDateObj.getTime() / 1000);
      
      var encodedTicker = encodeURIComponent(ticker);
      var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodedTicker + 
                '?period1=' + start + '&period2=' + end + 
                '&interval=1d&events=history&includeAdjustedClose=true';
                
      requests.push({
        url: url,
        muteHttpExceptions: true,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
    });
    
    LoggerWrapper.log('Fetching data in parallel for: ' + activeTickers.join(', '));
    var responses = UrlFetchApp.fetchAll(requests);
    
    responses.forEach(function(response, index) {
      var ticker = activeTickers[index];
      var data = {};
      
      try {
        if (response.getResponseCode() !== 200) {
          LoggerWrapper.error('無法抓取 ' + ticker + ': ' + response.getContentText());
        } else {
          var jsonContent = response.getContentText();
          if (jsonContent) {
            var json = JSON.parse(jsonContent);
            if (json.chart && json.chart.result && json.chart.result.length > 0) {
              var result = json.chart.result[0];
              var timestamps = result.timestamp;
              var quote = result.indicators.quote[0];
              var adjCloseArr = (result.indicators.adjclose && result.indicators.adjclose[0]) ? result.indicators.adjclose[0].adjclose : [];
              
              if (timestamps && quote) {
                for (var i = 0; i < timestamps.length; i++) {
                  var ts = timestamps[i];
                  var dateObj = new Date(ts * 1000);
                  var dateStr = dateObj.toISOString().split('T')[0];
                  
                  var open = quote.open[i];
                  var high = quote.high[i];
                  var low = quote.low[i];
                  var close = quote.close[i];
                  var adjClose = (adjCloseArr.length > i && adjCloseArr[i] != null) ? adjCloseArr[i] : close;
                  
                  if (close != null && open != null) {
                    data[dateStr] = { 
                      open: Number(open), 
                      high: Number(high), 
                      low: Number(low), 
                      close: Number(close), 
                      adjClose: Number(adjClose) 
                    };
                  }
                }
              } else {
                LoggerWrapper.error('抓取 ' + ticker + ' 無時間序列數據');
              }
            } else {
              LoggerWrapper.error('抓取 ' + ticker + ' 無數據結構');
            }
          }
        }
      } catch (e) {
        LoggerWrapper.error('解析錯誤 ' + ticker + ': ' + e);
      }
      
      dataMap[ticker] = data;
      Object.keys(data).forEach(function(d) { dates.add(d); });
    });
    
    // 3. Backfill Logic (Only for fetched range)
    Constants.TICKERS.forEach(function(ticker) {
      if (dataMap[ticker]) {
        var tickerDates = Object.keys(dataMap[ticker]).sort();
        if (tickerDates.length > 0) {
           var prevClose = dataMap[ticker][tickerDates[0]];
           var sortedAll = Array.from(dates).sort();
           
           sortedAll.forEach(function(d) {
              if (d >= tickerDates[0]) {
                 if (dataMap[ticker][d]) {
                    prevClose = dataMap[ticker][d];
                 } else {
                    dataMap[ticker][d] = prevClose;
                 }
              }
           });
        }
      }
    });

    // 4. Group New Data by Year
    var sortedDates = Array.from(dates).sort();
    var newDataByYear = {};
    
    sortedDates.forEach(function(date) {
      var year = date.split('-')[0];
      if (!newDataByYear[year]) newDataByYear[year] = [];
      
      var row = [date];
      allTickers.forEach(function(ticker) {
        var dayData = dataMap[ticker] ? dataMap[ticker][date] : null;
        if (dayData) {
          row.push(dayData.open, dayData.high, dayData.low, dayData.close, dayData.adjClose);
        } else {
          row.push('', '', '', '', '');
        }
      });
      newDataByYear[year].push(row);
    });
    
    // Headers
    var headers = ['日期'];
    allTickers.forEach(function(t) {
      headers.push(t + '_開盤', t + '_最高', t + '_最低', t + '_收盤', t + '_還原收盤');
    });

    // 5. Merge and Write
    Object.keys(newDataByYear).forEach(function(year) {
      var sheetName = year + 'Data';
      var sheet = ss.getSheetByName(sheetName);
      
      var finalRows = [];
      if (sheet && sheet.getLastRow() > 1 && sheet.getLastColumn() === headers.length) {
         var existingData = sheet.getDataRange().getValues();
         var existingRows = existingData.slice(1);
         
         var rowMap = new Map();
         existingRows.forEach(function(r) {
            if (r[0]) {
               var dObj = new Date(r[0]);
               if (!isNaN(dObj.getTime())) {
                  var d = dObj.toISOString().split('T')[0];
                  rowMap.set(d, r);
               }
            }
         });
         
         newDataByYear[year].forEach(function(r) {
            rowMap.set(r[0], r);
         });
         
         var sortedKeys = Array.from(rowMap.keys()).sort();
         sortedKeys.forEach(function(k) {
            finalRows.push(rowMap.get(k));
         });
         
         sheet.clear();
      } else {
         if (!sheet) {
             sheet = ss.insertSheet(sheetName);
         } else {
             sheet.clear();
         }
         finalRows = newDataByYear[year];
      }
      
      if (finalRows.length > 0) {
        var allData = [headers].concat(finalRows);
        sheet.getRange(1, 1, allData.length, headers.length).setValues(allData);
        LoggerWrapper.log('Updated ' + year + ' (' + finalRows.length + ' rows)');
      }
    });

    // Flush all writes once at the very end
    SpreadsheetApp.flush();

    try {
      SpreadsheetApp.getUi().alert('資料抓取與更新完成！');
    } catch (e) {
      LoggerWrapper.log('資料抓取與更新完成！');
    }
  }
};

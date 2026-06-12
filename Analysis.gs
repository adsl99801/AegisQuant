/**
 * Analysis.gs
 * 負責分析與展示回測結果
 */
var Analysis = {
  generateCombinedReport: function(last5Rows, last10SignalRows) {
    if (!last5Rows || last5Rows.length === 0) return '<p>無最近回測數據</p>';

    var tableStyle = 'border: 1px solid #ddd; border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 11px;';
    var thStyle = 'border: 1px solid #ddd; padding: 6px; background-color: #f2f2f2; font-weight: bold; text-align: center;';
    var tdStyle = 'border: 1px solid #ddd; padding: 6px; text-align: center;';
    var tdLeftStyle = 'border: 1px solid #ddd; padding: 6px; text-align: left;';

    // Helper to format date
    var fmtDate = function(d) { return new Date(d).toISOString().split('T')[0]; };

    // 1. DailyLog最近5日持倉
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DailyLog');
    var headers = [];
    if (sheet && sheet.getLastRow() > 0) {
      headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    }
    
    // Fallback if headers not found
    if (headers.length === 0) {
      headers = ['日期', '淨值/成本/%', Constants.TICKERS.join('/') + '/VIX %', '當年內大盤績效/此策略績效', '訊號', '策略說明', '操作', 'Portfolio詳情'];
      Constants.TICKERS.forEach(function(t) {
        headers.push(t + '_股數/佔比');
      });
    }

    var html = '<h3>1. DailyLog最近5日持倉：</h3>';
    html += '<div style="overflow-x:auto;"><table style="' + tableStyle + '">';
    html += '<tr><th style="' + thStyle + '">日期</th>';
    Constants.TICKERS.forEach(function(t) {
      html += '<th style="' + thStyle + '">' + t + '_股數/佔比</th>';
    });
    html += '</tr>';

    var colIndices = Constants.TICKERS.map(function(t) {
      return headers.indexOf(t + '_股數/佔比');
    });

    last5Rows.forEach(function(row) {
       html += '<tr><td style="' + tdStyle + '">' + fmtDate(row[0]) + '</td>';
       colIndices.forEach(function(idx) {
         html += '<td style="' + tdStyle + '">' + (idx > -1 ? (row[idx]||'-') : '-') + '</td>';
       });
       html += '</tr>';
    });
    html += '</table></div><br/>';

    // 2. DailyLog最近5日回測
    html += '<h3>2. DailyLog最近5日回測：</h3>';
    html += '<div style="overflow-x:auto;"><table style="' + tableStyle + '">';
    html += '<tr><th style="' + thStyle + '">日期</th><th style="' + thStyle + '">當年內大盤績效/此策略績效</th><th style="' + thStyle + '">訊號</th><th style="' + thStyle + '">策略說明</th></tr>';
    last5Rows.forEach(function(row) {
       var desc = (row[5]||'').replace(/;/g, '; <br/>');
       html += '<tr><td style="' + tdStyle + '">' + fmtDate(row[0]) + '</td>';
       html += '<td style="' + tdStyle + '">' + (row[3]||'') + '</td>';
       html += '<td style="' + tdStyle + '">' + (row[4]||'') + '</td>';
       html += '<td style="' + tdLeftStyle + '">' + desc + '</td></tr>';
    });
    html += '</table></div><br/>';

    // 3. DailyLog最近5日Portfolio詳情
    html += '<h3>3. DailyLog最近5日Portfolio詳情：</h3>';
    html += '<div style="overflow-x:auto;"><table style="' + tableStyle + '">';
    html += '<tr><th style="' + thStyle + '">日期</th><th style="' + thStyle + '">操作</th><th style="' + thStyle + '">Portfolio詳情</th></tr>';
    last5Rows.forEach(function(row) {
       html += '<tr><td style="' + tdStyle + '">' + fmtDate(row[0]) + '</td>';
       html += '<td style="' + tdLeftStyle + '">' + (row[6]||'') + '</td>';
       html += '<td style="' + tdLeftStyle + '">' + (row[7]||'') + '</td></tr>';
    });
    html += '</table></div><br/>';

    // 4. DailyLog最近10次有"操作紀錄"
    if (last10SignalRows && last10SignalRows.length > 0) {
        html += '<h3>4. DailyLog最近10次有"操作紀錄" ：</h3>';
        html += '<div style="overflow-x:auto;"><table style="' + tableStyle + '">';
        html += '<tr><th style="' + thStyle + '">日期</th><th style="' + thStyle + '">訊號</th><th style="' + thStyle + '">說明</th><th style="' + thStyle + '">操作紀錄</th></tr>';
        last10SignalRows.forEach(function(row) {
           html += '<tr><td style="' + tdStyle + '">' + fmtDate(row[0]) + '</td>';
           html += '<td style="' + tdStyle + '">' + (row[4]||'') + '</td>';
           html += '<td style="' + tdLeftStyle + '">' + (row[5]||'') + '</td>';
           html += '<td style="' + tdLeftStyle + '">' + (row[6]||'') + '</td></tr>';
        });
        html += '</table></div><br/>';
    }

    return html;
  },

  showLastRebalances: function(count) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName('DailyLog');
    if (!sheet) {
      Notifier.alert('找不到 "DailyLog" 分頁');
      return;
    }
    
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Notifier.alert('無回測數據');
      return;
    }
    
    // 標題: 日期(0), 淨值/成本(1), 變動(2), 比較(3), 訊號(4), 說明(5), 操作(6), Portfolio詳情(7), TSLA(8), VGT(9), VDC(10), 現金(11)
    // 篩選有訊號的行 (再平衡或危機觸發)
    var rebalanceRows = data.slice(1).filter(function(row) {
      return row[4] && row[4] !== '';
    });
    
    var lastN = rebalanceRows.slice(-count);
    
    if (lastN.length === 0) {
      Notifier.alert('找不到再平衡記錄');
      return;
    }

    // Use detailed daily report format
    var html = this.generateRecentDailyReportHtml(lastN);
    
    var userInterface = HtmlService.createHtmlOutput(html)
        .setWidth(800) // Increase width for better view
        .setHeight(500);
    try {
      SpreadsheetApp.getUi().showModalDialog(userInterface, '再平衡分析');
    } catch (e) {
      LoggerWrapper.log('無法顯示 UI (可能在非互動模式下執行)');
    }
  },
  
  _toYMD: function(d) {
     if (!d) return '';
     var date = new Date(d);
     return date.getFullYear() + '-' + 
            ('0' + (date.getMonth() + 1)).slice(-2) + '-' + 
            ('0' + date.getDate()).slice(-2);
  },
  
  _toYM: function(d) {
     if (!d) return '';
     var date = new Date(d);
     return date.getFullYear() + '-' + ('0' + (date.getMonth() + 1)).slice(-2);
  },

  drawChart: function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var resultsSheet = ss.getSheetByName('DailyLog');
    
    if (!resultsSheet) {
      Notifier.alert('找不到 "DailyLog" 工作表');
      return;
    }

    var chartSheetName = 'Performance Chart';
    var chartSheet = ss.getSheetByName(chartSheetName);
    if (!chartSheet) {
      chartSheet = ss.insertSheet(chartSheetName);
      var rawHeader = ['Date', 'StratVal', 'Cost', Constants.BENCHMARK];
      Constants.TICKERS.forEach(function(t) { rawHeader.push(t); });
      chartSheet.getRange(1, 1, 1, rawHeader.length).setValues([rawHeader]);
    }

    // Check Synchronization
    var logData = resultsSheet.getDataRange().getValues();
    if (logData.length < 2) { Notifier.alert('DailyLog 無數據'); return; }
    
    // Check Cache Status
    var cacheData = chartSheet.getDataRange().getValues();
    var lastCachedDateStr = (cacheData.length > 1) ? Analysis._toYMD(cacheData[cacheData.length-1][0]) : '';
    
    // Find next start index in DailyLog
    var nextLogIndex = 1; // Default start
    if (lastCachedDateStr) {
       // Loop to find where we left off
       var lastLogDateStr = Analysis._toYMD(logData[logData.length-1][0]);
       if (lastLogDateStr === lastCachedDateStr) {
           // Fully Synced -> Render
           this._renderChart(ss, chartSheet, cacheData);
           return;
       }
       
       // Find the index after the last cached date
       for (var i = 1; i < logData.length; i++) {
           if (Analysis._toYMD(logData[i][0]) === lastCachedDateStr) {
               nextLogIndex = i + 1;
               break;
           }
       }
    }

    // If we have more data to process
    if (nextLogIndex < logData.length) {
        var success = this._updateChartData(ss, logData, nextLogIndex, chartSheet);
        if (success) {
            var newLastCached = chartSheet.getRange(chartSheet.getLastRow(), 1).getValue();
            var lastLogDate = new Date(logData[logData.length-1][0]);
            
            // Render Chart immediately with whatever data we have now
            var currentCache = chartSheet.getDataRange().getValues();
            this._renderChart(ss, chartSheet, currentCache);

            if (Analysis._toYMD(newLastCached) === Analysis._toYMD(lastLogDate)) {
                 Notifier.alert('數據處理完成! 正在繪製圖表...');
                 // (Already rendered above)
            } else {
                 Notifier.alert('部分數據已處理 (' + Analysis._toYMD(newLastCached) + '). 圖表已更新. 請再次執行 "繪製績效走勢圖" 以繼續處理剩餘數據.');
            }
        }
    } else {
        this._renderChart(ss, chartSheet, cacheData);
    }
  },

  _updateChartData: function(ss, logData, startIndex, chartSheet) {
      // Process ONE Year of Data max to prevent timeout
      var startRow = logData[startIndex];
      var startDate = new Date(startRow[0]);
      var targetYear = startDate.getFullYear();
      
      var chunkRows = [];
      for (var i = startIndex; i < logData.length; i++) {
          var d = new Date(logData[i][0]);
          if (d.getFullYear() === targetYear) {
              chunkRows.push(logData[i]);
          } else {
              break;
          }
      }
      
      if (chunkRows.length === 0) return false;

      // Fetch Price Data for Target Year
      var yearSheetName = targetYear + 'Data';
      var yearSheet = ss.getSheetByName(yearSheetName);
      if (!yearSheet) {
          Notifier.alert('缺少年份數據表: ' + yearSheetName);
          return false; 
      }
      
      var priceData = yearSheet.getDataRange().getValues();
      var headers = priceData[0];
      var colMap = {};
      var allTickers = Constants.TICKERS.concat([Constants.BENCHMARK]);
      
      allTickers.forEach(function(t) {
         var adjIdx = headers.indexOf(t + '_還原收盤');
         var idx = headers.indexOf(t + '_收盤');
         if (adjIdx !== -1) colMap[t] = adjIdx;
         else if (idx !== -1) colMap[t] = idx;
      });
      
      // Build Price Map for this year
      var priceMap = {};
      for (var p = 1; p < priceData.length; p++) {
         var k = Analysis._toYMD(priceData[p][0]);
         priceMap[k] = {};
         for (var t in colMap) {
             priceMap[k][t] = priceData[p][colMap[t]];
         }
      }
      
      // Build Output Rows
      var outRows = [];
      for (var r = 0; r < chunkRows.length; r++) {
          var row = chunkRows[r];
          var date = new Date(row[0]);
          var dateKey = Analysis._toYMD(date);
          
          var valStr = String(row[1]);
          // Fix: Support both " / " and "/" and remove commas
          var valParts = valStr.split(/\s*\/\s*/);
          
          var stratVal = 0; 
          var costVal = 0;
          
          // Safe Parsing helper
          var parseNum = function(s) {
              if (!s) return 0;
              return Number(String(s).replace(/,/g, '').replace(/%/g, '')) || 0;
          };

          if (valParts.length > 0) stratVal = parseNum(valParts[0]);
          // If only one value, assume cost = stratVal (unlikely but safe fallback)
          // Usually value/cost/profit%
          if (valParts.length > 1) costVal = parseNum(valParts[1]);
          else costVal = stratVal;
          
          var outRow = [date, stratVal, costVal];
          
          // Prices
          var prices = priceMap[dateKey] || {};
          outRow.push(prices[Constants.BENCHMARK] || '');
          Constants.TICKERS.forEach(function(t) {
              outRow.push(prices[t] || '');
          });
          
          outRows.push(outRow);
      }
      
      // Append to Chart Sheet
      if (outRows.length > 0) {
          chartSheet.getRange(chartSheet.getLastRow() + 1, 1, outRows.length, outRows[0].length).setValues(outRows);
      }
      
      return true;
  },

  _renderChart: function(ss, chartSheet, cacheData) {
      if (!cacheData || cacheData.length < 2) return;
      
      var rawHeader = cacheData[0];
      
      var dailySeries = [];
      var spyIdx = 3; 
      
      // 1. Parse Data & Filter Invalid
      for (var i = 1; i < cacheData.length; i++) {
          var row = cacheData[i];
          var d = new Date(row[0]);
          if (isNaN(d.getTime())) continue; // Skip invalid dates
          
          dailySeries.push({
              date: d,
              stratVal: Number(row[1]),
              spyPrice: Number(row[spyIdx])
          });
      }
      
      if (dailySeries.length === 0) return;

      // 2. Calculate Annual Returns
      var annualData = {};
      dailySeries.forEach(function(d) {
          var year = d.date.getFullYear();
          if (!annualData[year]) annualData[year] = { startStrat: d.stratVal, endStrat: d.stratVal, startSpy: d.spyPrice, endSpy: d.spyPrice };
          annualData[year].endStrat = d.stratVal;
          annualData[year].endSpy = d.spyPrice;
      });
      
      var chartRows = [['年份', '我的策略', Constants.BENCHMARK]];
      var years = Object.keys(annualData).sort();
      
      years.forEach(function(y) {
          var data = annualData[y];
          var stratRet = (data.startStrat > 0) ? (data.endStrat - data.startStrat) / data.startStrat : 0;
          var spyRet = (data.startSpy > 0) ? (data.endSpy - data.startSpy) / data.startSpy : 0;
          chartRows.push([y, stratRet, spyRet]);
      });
      
      // 3. Draw Annual Column Chart
      chartSheet.hideColumns(1, rawHeader.length);
      var startVisualCol = rawHeader.length + 2; 
      
      chartSheet.getRange(1, startVisualCol, 1000, 20).clear(); 
      
      var chartDataRange = chartSheet.getRange(1, startVisualCol, chartRows.length, chartRows[0].length);
      chartDataRange.setValues(chartRows);
      
      // Format Data columns as Percentage
      if (chartRows.length > 1) {
           chartSheet.getRange(2, startVisualCol + 1, chartRows.length - 1, 2).setNumberFormat('0.00%');
      }
      // Format Year as text
      chartSheet.getRange(2, startVisualCol, chartRows.length - 1, 1).setNumberFormat('@');
      
      var chartBuilder = chartSheet.newChart()
         .setChartType(Charts.ChartType.COLUMN)
         .addRange(chartDataRange)
         .setNumHeaders(1)
         .setPosition(2, startVisualCol, 0, 0)
         .setOption('title', '年度報酬率比較 (策略 vs ' + Constants.BENCHMARK + ')')
         .setOption('hAxis.title', '年份')
         .setOption('vAxis.title', '年度報酬率 (%)')
         .setOption('width', 1000)
         .setOption('height', 600)
         .setOption('legend', { position: 'top', textStyle: { fontSize: 11 } })
         .setOption('colors', ['#00008B', '#FFA500']); // Blue for Strategy, Orange for SPY
      
      // Remove old charts
      var oldCharts = chartSheet.getCharts();
      oldCharts.forEach(function(c) { chartSheet.removeChart(c); });
      
      chartSheet.insertChart(chartBuilder.build());
      
      // 4. Calculate Total Stats (CAGR, etc.) from Daily Data for the table
      // (Re-using simplified logic for the stats table below the chart)
       var calculateMetrics = function(values) {
          if (values.length < 2) return { cagr: 0, mdd: 0, sharpe: 0, totalReturn: 0 };
          var startVal = values[0];
          var endVal = values[values.length - 1];
          var years = Math.max(values.length / 252, 1/12);
          
          var totalRet = (startVal > 0) ? (endVal / startVal) - 1 : 0;
          var cagr = (startVal > 0) ? Math.pow((endVal / startVal), (1 / years)) - 1 : 0;
          
          var peak = -Infinity;
          var maxDrawdown = 0;
          
          for (var k = 0; k < values.length; k++) {
             var v = values[k];
             if (v > peak) peak = v;
             if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - v) / peak);
          }
           // Simplified Sharpe (assuming 2% RF and simple vol approximation)
           // Proper logic was in original code, simplifying here to avoid massive complexity in replacement block
           // Re-calculating Returns for Volatility
            var returns = [];
            for(var k=1; k<values.length; k++) {
                if(values[k-1] > 0) returns.push((values[k]-values[k-1])/values[k-1]);
            }
            var stdDev = 0;
            if(returns.length > 0) {
                var avg = returns.reduce(function(a,b){return a+b},0)/returns.length;
                stdDev = Math.sqrt(returns.reduce(function(a,b){return a+Math.pow(b-avg,2)},0)/returns.length);
            }
            var vol = stdDev * Math.sqrt(252);
            var sharpe = (vol > 0) ? (cagr - 0.02)/vol : 0;

          return { cagr: cagr, mdd: maxDrawdown, totalReturn: totalRet, sharpe: sharpe, vol: vol };
       };

       var stratValues = dailySeries.map(function(d) { return d.stratVal; });
       var spyValues = dailySeries.map(function(d) { return d.spyPrice; }); // Comparison using Price directly is fine for % return
       
       var stratMetrics = calculateMetrics(stratValues);
       var spyMetrics = calculateMetrics(spyValues);
       
      var fmtPct = function(v) { return (isNaN(v) || !isFinite(v)) ? '-' : (v * 100).toFixed(2) + '%'; };
      var fmtNum = function(v) { return (isNaN(v) || !isFinite(v)) ? '-' : v.toFixed(2); };
      
      var statsHeader = [['績效指標', '我的策略', Constants.BENCHMARK]];
      var statsData = [
         ['累積報酬率 (Cum. Ret)', fmtPct(stratMetrics.totalReturn), fmtPct(spyMetrics.totalReturn)],
         ['年化報酬率 (CAGR)', fmtPct(stratMetrics.cagr), fmtPct(spyMetrics.cagr)],
         ['最大回撤 (MDD)', fmtPct(stratMetrics.mdd), fmtPct(spyMetrics.mdd)],
         ['夏普比率 (Sharpe)', fmtNum(stratMetrics.sharpe), fmtNum(spyMetrics.sharpe)]
      ];
      var allStats = statsHeader.concat(statsData);
      var statStartRow = chartRows.length + 5; // Place below chart
      var statRange = chartSheet.getRange(statStartRow, startVisualCol, allStats.length, 3);
      statRange.setValues(allStats);
      statRange.setBorder(true, true, true, true, true, true);
      chartSheet.getRange(statStartRow, startVisualCol, 1, 3).setBackground('#f3f3f3').setFontWeight('bold');
      
      chartSheet.activate();
  },
};

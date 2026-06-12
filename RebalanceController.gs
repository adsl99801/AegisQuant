/**
 * RebalanceController.gs
 * 4 層優先級量化策略核心：危機 -> 鎖倉 -> 趨勢 -> 評分
 */

var RebalanceController = {
  config: {
    CHUNK_SIZE: 200,
    BUFFER_SIZE: 220, // 180 (MA) + buffer
    MA_PERIOD: Constants.CONSTRAINTS.MA_TREND_DAYS, // 100
    SCORE_PERIOD: 63, // 3 months for scoring
    MDD_LOOKBACK: 5,  // 5-day MDD
    CRISIS_EXIT_DAYS: 3
  },

  run: function(targetEndYear) {
    var startTime = new Date().getTime();
    Logger.log('開始執行量化策略回測 (支援續且更新機制)...');
    if (targetEndYear) Logger.log('🎯 指定執行至 ' + targetEndYear + ' 年底');

    var ctx = this._initializeContext();
    var resumed = false;
    
    // If targetEndYear is specified, we force a restart (Clear All), ignoring resume ability.
    if (targetEndYear) {
       resumed = false;
    } else {
       resumed = this._tryResume(ctx);
    }

    if (resumed) {
       Logger.log('✅ 已恢復進度，從 ' + Utils.formatDate(ctx.startDate) + ' 接續執行...');
    } else {
       Logger.log('🔄 重新開始完整回測...');
       DailyLogger.init(true);
       ctx.startDate = new Date(Constants.START_DATE);
       this._processFirstDay(ctx);
    }

    var sortedYears = ctx.years.sort();
    for (var yIdx = 0; yIdx < sortedYears.length; yIdx++) {
      var year = sortedYears[yIdx];
      
      // Filter: Skip years before start year
      if (parseInt(year) < ctx.startDate.getFullYear()) continue;
      
      // Filter: Stop if year > targetEndYear
      if (targetEndYear && parseInt(year) > parseInt(targetEndYear)) {
         Logger.log('已達指定年份 ' + targetEndYear + '，停止執行。');
         break; 
      }
      
      var sheetName = year + 'Data';
      var sheet = ctx.ss.getSheetByName(sheetName);
      if (!sheet) continue;
      
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) continue;
      
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var tickerMap = this._buildTickerMap(headers, ctx.allTickers);
      
      for (var row = 2; row <= lastRow; row += this.config.CHUNK_SIZE) {
        var rowsToRead = Math.min(this.config.CHUNK_SIZE, lastRow - row + 1);
        var chunk = sheet.getRange(row, 1, rowsToRead, sheet.getLastColumn()).getValues();
        this._processChunk(ctx, chunk, tickerMap);
      }
    }

    this._finalizeAndReport(ctx);
    Logger.log('執行耗時: ' + ((new Date().getTime() - startTime) / 1000) + ' 秒');
  },
  
  _tryResume: function(ctx) {
     DailyLogger.init(false); // Do not clear yet
     var lastData = DailyLogger.getLastRowData();
     
     // Need at least 2 weeks of data to resume meaningfully (buffer)
     if (!lastData) return false;
     
     // "Update last week" -> Delete last 7 rows
     DailyLogger.deleteLastNRows(7); 
     
     // Get NEW last row
     lastData = DailyLogger.getLastRowData();
     if (!lastData) return false;
     
     var lastDate = new Date(lastData.date);
     var portStateStr = lastData.portfolioDetails;
     
     // Set Start Date to Next Day
     var startDate = new Date(lastDate);
     startDate.setDate(startDate.getDate() + 1);
     ctx.startDate = startDate;
     
     // Restore Portfolio
     this._restorePortfolioState(ctx, portStateStr);
     
     // Restore Buffer (Need ~200 days history for MA)
     // This is the heavy part: need to read data BEFORE startDate
     this._restoreBuffer(ctx, startDate);
     
     // Set Loop State
     ctx.currentYear = startDate.getFullYear();
     this._initBenchmarkUnits(ctx);
     
     // Get Current Portfolio Value from last row
     var currentVal = 0;
     if (lastData.valueCost) {
         var valParts = String(lastData.valueCost).split('/');
         var currentValStr = valParts[0].replace(/,/g, '').trim();
         currentVal = parseFloat(currentValStr);
     }
     
     var lastYear = lastDate.getFullYear();
     var currentYear = startDate.getFullYear();
     
     if (currentYear !== lastYear) {
         // Year boundary crossed!
         // SOY portfolio value for currentYear is the closing value of lastYear
         if (currentVal > 0) {
             ctx.soyPortfolioValue = currentVal;
         }
         // SOY benchmark value for currentYear is the closing value of lastYear
         var spyPrice = 0;
         var sPrev = ctx.ss.getSheetByName(lastYear + 'Data');
         if (sPrev && sPrev.getLastRow() > 1) {
             var vals = sPrev.getRange(sPrev.getLastRow(), 1, 1, sPrev.getLastColumn()).getValues()[0];
             var headers = sPrev.getRange(1, 1, 1, sPrev.getLastColumn()).getValues()[0];
             var spyIdx = headers.indexOf(Constants.BENCHMARK + '_收盤');
             if (spyIdx > -1) {
                 spyPrice = vals[spyIdx];
             }
         }
         if (spyPrice > 0 && ctx.benchmarkUnits > 0) {
             ctx.soyBenchmarkValue = ctx.benchmarkUnits * spyPrice;
         }
         Logger.log(`Year boundary crossed during resume (${lastYear} -> ${currentYear}): SOY Port=${ctx.soyPortfolioValue.toFixed(2)} Bench=${ctx.soyBenchmarkValue.toFixed(2)}`);
     } else {
         // Same year!
         // Restore SOY Portfolio Value from YTD reverse calculation
         if (lastData.ytdComparison && currentVal > 0) {
             try {
                 var ytdParts = String(lastData.ytdComparison).split('/');
                 if (ytdParts.length > 1) {
                     var stratYtdStr = ytdParts[1].replace('%', '').trim();
                     var stratYtd = parseFloat(stratYtdStr) / 100;
                     if (!isNaN(stratYtd) && (1 + stratYtd) !== 0) {
                         ctx.soyPortfolioValue = currentVal / (1 + stratYtd);
                         Logger.log(`Resumed SOY Portfolio Value: ${ctx.soyPortfolioValue.toFixed(2)} (Derived YTD: ${stratYtd*100}%)`);
                     }
                 }
             } catch (e) {
                 Logger.log('Error restoring SOY Portfolio Value: ' + e.message);
             }
         }
         
         // Restore SOY Benchmark Value
         this._updateSoyValuesForResume(ctx, currentYear);
     }

     return true;
  },

  _updateSoyValuesForResume: function(ctx, resumeYear) {
      var startYear = parseInt(Constants.START_DATE.split('-')[0]);
      if (resumeYear === startYear) {
         ctx.soyBenchmarkValue = Constants.INITIAL_CAPITAL;
         Logger.log('Resumed SOY Benchmark Value for ' + resumeYear + ' (Start Year): ' + ctx.soyBenchmarkValue);
         return;
      }
      
      // Benchmark: We want the value at the end of the previous year
      var prevYear = resumeYear - 1;
      var sPrev = ctx.ss.getSheetByName(prevYear + 'Data');
      var spyPrice = 0;
      
      if (sPrev && sPrev.getLastRow() > 1) {
         var vals = sPrev.getRange(sPrev.getLastRow(), 1, 1, sPrev.getLastColumn()).getValues()[0];
         var headers = sPrev.getRange(1, 1, 1, sPrev.getLastColumn()).getValues()[0];
         var spyIdx = headers.indexOf(Constants.BENCHMARK + '_收盤');
         if (spyIdx > -1) {
            spyPrice = vals[spyIdx];
         }
      }
      
      // Fallback: If previous year sheet doesn't exist or is empty, use the first day of the current year
      if (spyPrice <= 0) {
         var sCurr = ctx.ss.getSheetByName(resumeYear + 'Data');
         if (sCurr && sCurr.getLastRow() > 1) {
            var vals = sCurr.getRange(2, 1, 1, sCurr.getLastColumn()).getValues()[0];
            var headers = sCurr.getRange(1, 1, 1, sCurr.getLastColumn()).getValues()[0];
            var spyIdx = headers.indexOf(Constants.BENCHMARK + '_收盤');
            if (spyIdx > -1) {
               spyPrice = vals[spyIdx];
            }
         }
      }
      
      if (spyPrice > 0 && ctx.benchmarkUnits > 0) {
         ctx.soyBenchmarkValue = ctx.benchmarkUnits * spyPrice;
         Logger.log('Resumed SOY Benchmark Value for ' + resumeYear + ': ' + ctx.soyBenchmarkValue + ' (Ref Price: ' + spyPrice + ')');
      }
  },
  
  _restorePortfolioState: function(ctx, detailStr) {
     // Format: "現金:1234|TSLA:10@200.5,VGT:20@300.0" (Comma at end maybe)
     if (!detailStr) return;
     
     var parts = detailStr.split('|');
     var cashPart = parts[0];
     var assetPart = parts.length > 1 ? parts[1] : "";
     
     // Cash
     var cashMatch = cashPart.match(/現金:([\d\.]+)/);
     if (cashMatch) ctx.portfolio.cash = parseFloat(cashMatch[1]);
     
     // Assets
     if (assetPart) {
        var assets = assetPart.split(',');
        assets.forEach(function(s) {
           if (!s) return;
           // s: "TSLA:10@200.5"
           var m = s.match(/([A-Z]+):(\d+)@([\d\.]+)/);
           if (m) {
              var t = m[1];
              var h = parseInt(m[2]);
              var c = parseFloat(m[3]);
              ctx.portfolio.holdings[t] = h;
              ctx.portfolio.avgCosts[t] = c;
           }
        });
     }
  },
  
  _restoreBuffer: function(ctx, resumeDate) {
     // Need previous N days.
     var lookback = this.config.BUFFER_SIZE;
     var bufferStartDate = new Date(resumeDate);
     bufferStartDate.setDate(bufferStartDate.getDate() - (lookback * 2)); // *2 for weekends/holidays safety
     
     // Scan all YearData sheets that might cover this range
     // Ideally just check current year and prev year
     var yearsToCheck = [resumeDate.getFullYear(), resumeDate.getFullYear() - 1];
     var loaded = [];
     
     var self = this;
     
     // Need sorted keys to iterate
     var allRows = [];
     
     yearsToCheck.forEach(function(y) {
       var s = ctx.ss.getSheetByName(y + 'Data');
       if (s && s.getLastRow() > 1) {
          var vals = s.getDataRange().getValues();
          var headers = vals[0];
          var tMap = self._buildTickerMap(headers, ctx.allTickers);
          
          for (var i = 1; i < vals.length; i++) {
             var rowDate = new Date(vals[i][0]);
             if (rowDate >= bufferStartDate && rowDate < resumeDate) {
                var day = self._parseRow(vals[i], tMap, ctx.allTickers);
                allRows.push(day);
             }
          }
       }
     });
     
     // Sort by date
     allRows.sort(function(a,b) { return a.date - b.date; });
     
     // Take last N
     ctx.buffer = allRows.slice(-lookback);
     
     // Init prev prices from last buffer item
     if (ctx.buffer.length > 0) {
        var last = ctx.buffer[ctx.buffer.length-1];
        ctx.allTickers.forEach(function(t) {
           if (last[t]) {
              ctx.prevClosePrices[t] = last[t].close;
              ctx.prevHighPrices[t] = last[t].high;
           }
        });
     }
  },
  
  _initBenchmarkUnits: function(ctx) {
      var startDateStr = Constants.START_DATE; // '2010-06-29'
      var startYear = startDateStr.split('-')[0];
      var s = ctx.ss.getSheetByName(startYear + 'Data');
      if (s && s.getLastRow() > 1) {
          var vals = s.getDataRange().getValues();
          var headers = vals[0];
          var spyIdx = headers.indexOf(Constants.BENCHMARK + '_收盤');
          if (spyIdx === -1) spyIdx = headers.indexOf(Constants.BENCHMARK + '_Close');
          if (spyIdx === -1) spyIdx = headers.indexOf(Constants.BENCHMARK + '.Close');
          
          if (spyIdx > -1) {
             // Find row with date matching startDateStr
             for (var i = 1; i < vals.length; i++) {
                var rowDate = vals[i][0];
                var rowDateStr = (rowDate instanceof Date) ? rowDate.toISOString().split('T')[0] : String(rowDate);
                if (rowDateStr.indexOf(startDateStr) === 0) {
                   var price = vals[i][spyIdx];
                   if (price > 0) {
                      ctx.benchmarkUnits = Constants.INITIAL_CAPITAL / price;
                      Logger.log('Set Benchmark Units (Resume): ' + ctx.benchmarkUnits.toFixed(4) + ' (Ref Price: ' + price + ' on ' + startDateStr + ')');
                      return;
                   }
                }
             }
          }
      }
      Logger.log('Warning: could not find benchmark price on ' + startDateStr + ' during resume.');
  },

  _initializeContext: function() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Find all YearData sheets
    var sheets = ss.getSheets();
    var years = [];
    sheets.forEach(function(s) {
      var name = s.getName();
      if (name.match(/^\d{4}Data$/)) {
        years.push(name.substring(0, 4));
      }
    });

    // Default to 'Data' if no YearData sheets (fallback)
    if (years.length === 0 && ss.getSheetByName('Data')) years.push('Data');
    var allTickers = Constants.TICKERS.concat([Constants.BENCHMARK, Constants.VIX]);
    
    return {
      ss: ss,
      years: years,
      allTickers: allTickers,
      
      portfolio: PortfolioManager.create(),
      buffer: [],
      prevClosePrices: {},
      prevHighPrices: {}, // Needed for Gap Up (Open > PrevHigh)
      prevLowPrices: {}, // Needed for Crisis Exit (SPY Low > PrevLow)
      resultsBuffer: [],
      collectedSignals: [],
      
      soyPortfolioValue: Constants.INITIAL_CAPITAL,
      soyBenchmarkValue: Constants.INITIAL_CAPITAL,
      benchmarkUnits: 0,
      currentYear: null,
      currentYear: null,
      lastProcessedDate: null,
      lastPortfolioValue: Constants.INITIAL_CAPITAL, // Track prev close for YTD

      
      // State Tracking
      crisisMode: false,
      crisisExitCount: 0, // Count consecutive days satisfying exit condition
      portfolioMax: Constants.INITIAL_CAPITAL // For MDD calculation
    };
  },

  _buildTickerMap: function(headers, allTickers) {
    var tickerMap = {};
    allTickers.forEach(function(t) {
      tickerMap[t] = {
        open:     headers.indexOf(t + '_開盤'),
        high:     headers.indexOf(t + '_最高'),
        low:      headers.indexOf(t + '_最低'),
        close:    headers.indexOf(t + '_收盤'),
        adjClose: headers.indexOf(t + '_還原收盤')
      };
    });
    return tickerMap;
  },

  _processFirstDay: function(ctx) {
    // Need to peek first available data to init benchmark units
    // Simplified: We handle init in loop if not initialized
  },

  _processChunk: function(ctx, chunk, tickerMap) {
    for (var i = 0; i < chunk.length; i++) {
      var rawRow = chunk[i];
      var day = this._parseRow(rawRow, tickerMap, ctx.allTickers);
      
      // Date Deduplication
      if (ctx.lastProcessedDate && day.date.getTime() === ctx.lastProcessedDate.getTime()) {
         continue; 
      }
      ctx.lastProcessedDate = day.date;
      
      // 0. Data Integrity Patch: Forward Fill Missing Prices
      // If a ticker has no price (0 or missing) but we have history, use Previous Close.
      // This prevents "Portfolio Crash" due to single day missing data (e.g. SGOV 2013-06-25)
      // 0. Data Integrity Patch: Forward Fill Missing Prices
      // If a ticker has no price (0 or missing) but we have history, use Previous Close.
      // This prevents "Portfolio Crash" due to single day missing data (e.g. SGOV 2013-05-28)
      ctx.allTickers.forEach(function(t) {
         var price = day[t] ? day[t].close : null;
         // Check if price is invalid: null, undefined, NaN, or <= 0
         if (price == null || isNaN(price) || price <= 0) {
             if (ctx.prevClosePrices[t] > 0) {
                 // Clone prev price structure if missing entirely
                 if (!day[t]) day[t] = {};
                 day[t].close = ctx.prevClosePrices[t];
                 day[t].adjClose = ctx.prevClosePrices[t]; // Assume unadj for gap fill
                 day[t].high = ctx.prevHighPrices[t] || ctx.prevClosePrices[t]; // Use prev high/low/open too to be safe
                 day[t].low = ctx.prevClosePrices[t];
                 day[t].open = ctx.prevClosePrices[t];
                 
                 // Logger.log(`Derived price for ${t} on ${Utils.formatDate(day.date)} using prev: ${day[t].close}`);
             }
         }
      });

      // 1. Always update Buffer (Warm-up)
      ctx.buffer.push(day);
      if (ctx.buffer.length > this.config.BUFFER_SIZE) ctx.buffer.shift();
      
      // 2. Execution Phase (Only if Valid Date)
      if (day.date >= ctx.startDate) {
          // Initialize Benchmark
          if (ctx.benchmarkUnits === 0 && day[Constants.BENCHMARK]) {
             ctx.benchmarkUnits = Constants.INITIAL_CAPITAL / day[Constants.BENCHMARK].close;
             ctx.currentYear = day.date.getFullYear();
             ctx.soyPortfolioValue = ctx.portfolio.cash;
             ctx.soyBenchmarkValue = Constants.INITIAL_CAPITAL;
          }

          // 357: Calculate Current Value
          var currentValue = ctx.portfolio.updateValue(day);
          day.portfolioValue = currentValue; // Set today's value first so it is included in rolling max
          
          // Calculate Rolling 5-day MDD (Option A)
          var rollingMax = currentValue;
          var lookback = Math.min(ctx.buffer.length, 5);
          for (var k = 0; k < lookback; k++) {
             var prevDayVal = ctx.buffer[ctx.buffer.length - 1 - k].portfolioValue;
             if (prevDayVal !== undefined && prevDayVal > rollingMax) {
                rollingMax = prevDayVal;
             }
          }
          var currentMdd = (rollingMax > 0) ? (rollingMax - currentValue) / rollingMax : 0;

          // Check Year Change based on Date
          // If we detect a new year, the SOY value should be the value *before* today's change?
          // Actually, we want SOY = "Close of Dec 31st".
          // In this loop, `ctx.lastPortfolioValue` stores the closing value of the PREVIOUS loop iteration.
          // So if day.year != ctx.currentYear, `ctx.lastPortfolioValue` IS the Dec 31st close.
          if (day.date.getFullYear() !== ctx.currentYear) {
             // Only update if we have a valid previous value (not first run)
             if (ctx.lastPortfolioValue > 0) {
                 ctx.soyPortfolioValue = ctx.lastPortfolioValue;
                 // Benchmark: approximate using previous close (or just use current day's open? No, consistent with port)
                 // Since we don't track lastBenchmarkValue explicitly in ctx, we can calculate it:
                 // But wait, `day` has current prices. We need PREVIOUS prices.
                 // `ctx.benchmarkUnits` is constant.
                 // So lastBenchmarkValue = ctx.benchmarkUnits * ctx.prevClosePrices[Constants.BENCHMARK].
                 if (ctx.prevClosePrices[Constants.BENCHMARK]) {
                    ctx.soyBenchmarkValue = ctx.benchmarkUnits * ctx.prevClosePrices[Constants.BENCHMARK];
                 }
                 Logger.log(`Year Change ${ctx.currentYear}->${day.date.getFullYear()}: SOY Port=${ctx.soyPortfolioValue.toFixed(0)} Bench=${ctx.soyBenchmarkValue.toFixed(0)}`);
             }
             ctx.currentYear = day.date.getFullYear();
             // Reset Max for new year? No, MDD is usually trailing. 
             // If user wants Calendar Year MDD, reset here. But prompt implies "5-day" or general max.
             // We keep portfolioMax continuous or trailing.
          }

          var strategyResult = this._evaluateStrategy(ctx, day, currentValue, currentMdd);

          var actionLog = "";
          if (strategyResult.shouldRebalance) {
            var exec = RebalanceExecutor.execute(ctx.portfolio, strategyResult.targetWeights, day, {});
            actionLog = exec.actionLog || "";
          }

          this._logDailyResult(ctx, day, currentValue, strategyResult, actionLog);
      }
      
      // 3a. Update Last Portfolio Value (for next iteration's YTD Logic)
      if (day.date >= ctx.startDate) {
          ctx.lastPortfolioValue = day.portfolioValue; 
      }

      // 3b. Update Previous Prices (For Next Day comparison)
      // Must happen AFTER logging to ensure (Today - Prev) calculation works
      ctx.allTickers.forEach(function(t) {
        if (day[t]) {
          ctx.prevClosePrices[t] = day[t].close;
          ctx.prevHighPrices[t] = day[t].high;
          ctx.prevLowPrices[t] = day[t].low;
        }
      });
    }

    if (ctx.resultsBuffer.length > 0) {
      DailyLogger.appendBatch(ctx.resultsBuffer);
      ctx.resultsBuffer = [];
    }
  },

  _evaluateStrategy: function(ctx, day, currentValue, currentMdd) {
    var result = {
      shouldRebalance: false,
      targetWeights: {},
      signals: [],
      descriptions: [],
      gapSignals: []
    };

    var currentWeights = ctx.portfolio.getCurrentWeights(currentValue, day);
    if (ctx.buffer.length < this.config.MA_PERIOD) return result;

    var vix = day[Constants.VIX] ? day[Constants.VIX].close : 20;

    // --- Layer 1: Crisis Detection ---
    var isCrisis = FilterEngine.checkCrisis(vix, currentMdd);
    
    if (ctx.crisisMode) {
      // Check Exit Condition
      if (FilterEngine.checkCrisisExit(vix, day, ctx.buffer)) {
        ctx.crisisExitCount++;
        if (ctx.crisisExitCount >= Constants.CRISIS_CONFIG.WAIT_DAYS) {
          ctx.crisisMode = false;
          ctx.crisisExitCount = 0;
          result.signals.push('🟢解除危機');
          var emaPeriod = Constants.CRISIS_CONFIG.EXIT_EMA_PERIOD || 5;
          result.descriptions.push(`解除原因: VIX(${vix.toFixed(1)})<${Constants.CRISIS_CONFIG.EXIT_VIX}且SPY連續${Constants.CRISIS_CONFIG.WAIT_DAYS}日收高於${emaPeriod}EMA`);
        } else {
          result.descriptions.push(`觀察解除 (${ctx.crisisExitCount}/${Constants.CRISIS_CONFIG.WAIT_DAYS}): VIX(${vix.toFixed(1)})<${Constants.CRISIS_CONFIG.EXIT_VIX}`);
        }
      } else {
        // Reset counter if condition fails
        ctx.crisisExitCount = 0;
        var emaPeriod = Constants.CRISIS_CONFIG.EXIT_EMA_PERIOD || 5;
        if (vix >= Constants.CRISIS_CONFIG.EXIT_VIX) {
             result.descriptions.push(`維持危機: VIX(${vix.toFixed(1)})>=${Constants.CRISIS_CONFIG.EXIT_VIX}`); 
        } else {
             result.descriptions.push(`維持危機: SPY未收高於${emaPeriod}EMA`);
        }
      }
    } else {
      if (isCrisis) {
        ctx.crisisMode = true;
        ctx.crisisExitCount = 0;
        result.signals.push('🔴危機觸發');
        
        var reasons = [];
        if (vix >= Constants.CRISIS_CONFIG.VIX_THRESHOLD) reasons.push(`VIX(${vix.toFixed(1)})>=${Constants.CRISIS_CONFIG.VIX_THRESHOLD}`);
        if (currentMdd >= Constants.CRISIS_CONFIG.MDD_THRESHOLD) reasons.push(`MDD(${(currentMdd*100).toFixed(1)}%)>=${(Constants.CRISIS_CONFIG.MDD_THRESHOLD*100).toFixed(1)}%`);
        result.descriptions.push(`觸發原因: ${reasons.join(' & ')}`);
      }
    }

    // --- Base Target Allocation ---
    var target = {};
    if (ctx.crisisMode) {
       target = JSON.parse(JSON.stringify(Constants.CRISIS_CONFIG.WEIGHTS));
       result.descriptions.push(`防禦模式 VIX:${vix.toFixed(1)} MDD:${(currentMdd*100).toFixed(1)}%`);
    } else {
       target = JSON.parse(JSON.stringify(Constants.BASE_WEIGHTS));
    }

    // --- Layer 2: No Loss Sell (Global Lock) ---
    // Apply to ALL modes: Never realize a loss.
    var locked = {};
    Constants.TICKERS.forEach(t => {

         if (ctx.portfolio.holdings[t] > 0 && day[t]) {
           var cost = ctx.portfolio.avgCosts[t];
           var price = day[t].close;
           
           if (price < cost) {
              locked[t] = true;
              var currentW = currentWeights[t] || 0;
              // Force Target >= Current to prevent selling
              if (target[t] < currentW) {
                target[t] = currentW;
                if (result.signals.indexOf('🔒鎖倉') === -1) result.signals.push('🔒鎖倉');
                result.descriptions.push(`${t}鎖定:現$${price.toFixed(0)}<本$${cost.toFixed(0)}`);
              }
           }
         }
    });

    // --- Layer 3 & 4: Trend, Gap, Score (Normal Mode Only) ---
    if (!ctx.crisisMode) {
       var indicators = this._calculateIndicators(ctx.buffer);
       var allowedTrends = FilterEngine.checkTrend(day, indicators.ma100, indicators.monthlyMom);
       var gapSignals = FilterEngine.checkGapUp(day, ctx.prevHighPrices);

       Constants.TICKERS.forEach(t => {


         // Trend Filter: If Bad Trend AND Not Locked -> Reduce to 0
         if (!allowedTrends[t] && !locked[t]) {
           target[t] = 0;
           result.descriptions.push(`${t}趨勢轉弱(清倉)`);
         }

         // Gap Up
         if (gapSignals[t]) {
            target[t] += Constants.CONSTRAINTS.SCORE_BONUS; 
            result.gapSignals.push(t);
            if (result.signals.indexOf('🚀跳空') === -1) result.signals.push('🚀跳空');
            result.descriptions.push(`${t}跳空`);
         }
       });

       // Scoring
       var scores = ScoringEngine.calculateScores(ctx.buffer, ctx.buffer.length-1);
       if (scores.length > 0) {
         var top = scores[0];
         if (top.score >= 4.0) {
           target[top.ticker] += Constants.CONSTRAINTS.SCORE_BONUS;
           result.descriptions.push(`強勢:${top.ticker}(${top.score.toFixed(1)}分,加碼)`);
         } else {
           result.descriptions.push(`最高分:${top.ticker}(${top.score.toFixed(1)}分,未滿4分不加)`);
         }
       }
    }
    
    
    // --- Max Weight Restraint (Before Normalization) ---
    Constants.TICKERS.forEach(t => {
       if (Constants.MAX_WEIGHTS && Constants.MAX_WEIGHTS[t]) {
           var cap = Constants.MAX_WEIGHTS[t];
           // Logic: We must respect Cap, BUT if Locked, we cannot sell (cannot go below current weight).
           // So Effective Cap = max(Cap, CurrentWeight) if Locked.
           var effectiveCap = cap;
           if (locked[t]) {
             effectiveCap = Math.max(cap, currentWeights[t] || 0);
           }

           if (target[t] > effectiveCap) {
               result.descriptions.push(`${t}權重上限(${ (target[t]*100).toFixed(0) }%->${ (effectiveCap*100).toFixed(0) }%)`);
               target[t] = effectiveCap;
           }
       }
    });

    // --- Normalize (Global) ---
    var norm = this._normalizeWeights(target, locked, currentWeights);
    target = norm.finalWeights;
    if (norm.log) result.descriptions.push(norm.log);
    
    result.targetWeights = target;

    // --- Rebalance Trigger Check ---
    var triggerInfo = this._checkRebalanceTrigger(day, ctx.crisisMode, currentWeights, result.targetWeights, ctx.portfolio);
    
    // Always append descriptions (to identify why we traded or didn't)
    if (triggerInfo.descriptions.length > 0) {
      result.descriptions = result.descriptions.concat(triggerInfo.descriptions);
    }
    
    if (triggerInfo.triggered) {
      result.shouldRebalance = true;
      result.signals = result.signals.concat(triggerInfo.signals);
    } 
    // Gap Up Force Rebalance
    else if (result.gapSignals.length > 0) {
      result.shouldRebalance = true;
    }

    return result;
  },

  _calculateIndicators: function(buffer) {
    var ma100 = {};
    var monthlyMom = {};
    var lookback = Constants.CONSTRAINTS.MA_TREND_DAYS; // 100
    
    Constants.TICKERS.forEach(t => {
      ma100[t] = Utils.calculateMA(buffer.slice(-lookback), t);
      // Monthly Momentum: approx 21 days
      monthlyMom[t] = Utils.calculateReturns(buffer.slice(-21), t);
    });
    return { ma100: ma100, monthlyMom: monthlyMom };
  },

  _checkRebalanceTrigger: function(day, isCrisis, currentWeights, targetWeights, portfolio) {
    var res = { triggered: false, signals: [], descriptions: [] };
    
    // Check Max Drift
    var maxDrift = 0;
    var maxDriftTicker = '';
    Constants.TICKERS.forEach(t => {
        var diff = Math.abs((currentWeights[t]||0) - (targetWeights[t]||0));
        if (diff > maxDrift) {
            maxDrift = diff;
            maxDriftTicker = t;
        }
    });

    var driftTrigger = maxDrift >= Constants.CONSTRAINTS.DRIFT_THRESHOLD;
    var turnover = this._calculateTurnover(currentWeights, targetWeights);
    
    // Detailed Logging for Drift decision
    if (!driftTrigger && !isCrisis) {
       res.descriptions.push(`未達偏離(最大${maxDriftTicker} ${(maxDrift*100).toFixed(1)}% < 15%)`);
    }

    if (driftTrigger || isCrisis) {
       var skipThreshold = Constants.CONSTRAINTS.COST_SKIP_TURNOVER; // 0.10
       
       if (isCrisis) {
         res.triggered = true; // Crisis: Always Rebalance
       } else if (driftTrigger) {
         if (turnover > skipThreshold) {
           res.triggered = true;
           res.signals.push('⚖️偏離');
           res.descriptions.push(`觸發再平衡:最大偏離[${maxDriftTicker}]${(maxDrift*100).toFixed(1)}%>15%且換手${(turnover*100).toFixed(1)}%>10%`);
         } else {
           res.descriptions.push(`忽略偏離:雖最大偏離[${maxDriftTicker}]${(maxDrift*100).toFixed(1)}%但換手${(turnover*100).toFixed(1)}%太低`);
         }
       }
    }
    
    return res;
  },

  _calculateTurnover: function(curr, target) {
    var sumDiff = 0;
    Constants.TICKERS.forEach(t => {
      sumDiff += Math.abs((target[t]||0) - (curr[t]||0));
    });
    return sumDiff / 2;
  },


  _normalizeWeights: function(target, locked, currentWeights) {
    var total = 0;
    Constants.TICKERS.forEach(t => total += (target[t]||0));
    var logMsg = "";
    
    // Tiny floating point tolerance
    if (Math.abs(total - 1.0) < 0.001) return { finalWeights: target, log: "" };

    if (total > 1.0) {
      var excess = total - 1.0;
      logMsg = `總權重${(total*100).toFixed(0)}%>100% `;
      
      // Calculate "Cut Capacity" for each asset
      // Capacity = Target - Floor
      // Floor = Locked ? CurrentWeight : 0
      var capacity = {};
      var totalCapacity = 0;
      
      Constants.TICKERS.forEach(t => {
         var floor = locked[t] ? (currentWeights[t] || 0) : 0;
         var cap = Math.max(0, (target[t] || 0) - floor);
         capacity[t] = cap;
         totalCapacity += cap;
      });

      if (totalCapacity > 0) {
          // If we can absorb the excess within the capacity
          // We cut proportionally to capacity: Cut[t] = Excess * (Capacity[t] / TotalCapacity)
          // Exception: If Excess > TotalCapacity, we cut ALL capacity (to floors), and leaving remainder.
          
          var cutRatio = excess / totalCapacity;
          var isFullCut = false;
          
          if (cutRatio > 1.0) {
             cutRatio = 1.0; // Max cut is 100% of capacity
             isFullCut = true;
             logMsg += "擠壓空間不足(保留鎖倉股數), ";
          } else {
             logMsg += "進行正規化(擠壓加碼與非鎖倉), ";
          }
          
          Constants.TICKERS.forEach(t => {
             if (capacity[t] > 0) {
                var reduction = capacity[t] * cutRatio;
                var oldT = target[t];
                target[t] -= reduction;
                // Debug / Log interesting changes
                if (reduction > 0.001) { 
                   logMsg += `${t}目標削減${(reduction*100).toFixed(1)}%(${(oldT*100).toFixed(1)}%->${(target[t]*100).toFixed(1)}%); `;
                }
             }
          });
          
          if (isFullCut) {
             logMsg += `最終合計${((total - totalCapacity)*100).toFixed(0)}%>100%(現金限制); `;
          }
          
      } else {
         logMsg += "無法正規化(全為鎖倉底限), 維持超額; ";
      }

    } else {
      var remainder = 1.0 - total;
      if (remainder > 0.001) logMsg = `總權重不足, 補${(remainder*100).toFixed(1)}%至現金; `;
    }
    
    return { finalWeights: target, log: logMsg };
  },

  _logDailyResult: function(ctx, day, currentValue, strategyResult, actionLog) {
     var tickerChanges = {};
     ctx.allTickers.forEach(t => {
        if (day[t] && day[t].close > 0 && ctx.prevClosePrices[t] > 0) {
          var pct = (day[t].close - ctx.prevClosePrices[t]) / ctx.prevClosePrices[t];
          tickerChanges[t] = pct;
        } else {
          tickerChanges[t] = 0;
        }
     });
     
     // Output Format String
     var displayTickers = Constants.TICKERS.concat([Constants.VIX]);
     var changeStr = displayTickers.map(t => (tickerChanges[t]*100).toFixed(2) + '%').join('/');

     var benchmarkValue = ctx.benchmarkUnits * day[Constants.BENCHMARK].close;
     var ytdPort = (ctx.soyPortfolioValue > 0) ? (currentValue - ctx.soyPortfolioValue) / ctx.soyPortfolioValue * 100 : 0;
     var ytdBench = (ctx.soyBenchmarkValue > 0) ? (benchmarkValue - ctx.soyBenchmarkValue) / ctx.soyBenchmarkValue * 100 : 0;
     var ytdStr = ytdBench.toFixed(2) + '%/' + ytdPort.toFixed(2) + '%';
     
     var cost = ctx.portfolio.getTotalCost();
     var profit = (cost > 0) ? (currentValue - cost)/cost * 100 : 0;
     var valCostStr = currentValue.toFixed(0) + '/' + cost.toFixed(0) + '/' + profit.toFixed(1) + '%';
     
     // Portfolio Details
      var portDet = '現金:' + ctx.portfolio.cash.toFixed(2) + '|';
      Constants.TICKERS.forEach(t => {

        var h = ctx.portfolio.holdings[t];
        var avg = ctx.portfolio.avgCosts[t] || 0;
        if (h > 0) {
           var price = day[t] ? day[t].close : 0;
           var w = (currentValue > 0) ? (h * price / currentValue * 100) : 0;
           portDet += t + ':' + h.toFixed(0) + '@' + avg.toFixed(2) + '(' + w.toFixed(1) + '%),';
        }
      });

      var logEntry = {
         date: day.date,
         valueCost: valCostStr,
         tickerChanges: changeStr,
         ytdComparison: ytdStr,
         reason: strategyResult.signals.join(','),
         description: strategyResult.descriptions.join(';'),
         actionLog: actionLog,
         portfolioDetails: portDet,
         portfolio: { cash: ctx.portfolio.cash }
      };
      Constants.TICKERS.forEach(t => {
         logEntry[t.toLowerCase()] = this._fmtH(ctx, t, currentValue, day);
      });
      ctx.resultsBuffer.push(logEntry);
  },
  
  _parseRow: function(row, tickerMap, allTickers) {
    var day = { date: new Date(row[0]) };
    allTickers.forEach(function(t) {
      if (tickerMap[t]) {
        var map = tickerMap[t];
        // Check if map.close index within bounds logic implicitly handled by undefined check usually, 
        // but explicit map usage:
        day[t] = {
            open: row[map.open],
            high: row[map.high],
            low: row[map.low],
            close: row[map.close],
            adjClose: row[map.adjClose]
        };
      }
    });
    return day;
  },

  _fmtH: function(ctx, t, currentValue, day) {
    var h = ctx.portfolio.holdings[t] || 0;
    if (h <= 0) return '';
    var price = day[t] ? day[t].close : 0;
    var val = h * price;
    var pct = (currentValue > 0) ? (val / currentValue * 100) : 0;
    return h.toFixed(0) + '/' + pct.toFixed(1) + '%';
  },

  _finalizeAndReport: function(ctx) {
    // 1. Log Final Value
    var finalValue = ctx.portfolio.updateValue({
        date: new Date(), 
    });
    if (ctx.resultsBuffer.length > 0) {
        finalValue = Number(ctx.resultsBuffer[ctx.resultsBuffer.length-1].valueCost.split('/')[0].replace(/,/g,'')); 
    }
    
    // Calculate CAGR
    var startDate = new Date(Constants.START_DATE);
    var endDate = new Date();
    var years = (endDate - startDate) / (1000 * 60 * 60 * 24 * 365.25);
    var cagr = 0;
    if (finalValue > 0 && years > 0) {
      cagr = (Math.pow(finalValue / Constants.INITIAL_CAPITAL, 1 / years) - 1) * 100;
    }
    
    Logger.log('Finished. Final Value: ' + finalValue + ' (CAGR: ' + cagr.toFixed(2) + '%)');

    // 2. Prepare Email Report
    try {
      SpreadsheetApp.flush(); // Ensure all pending logs are written
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName('DailyLog');
      if (sheet && sheet.getLastRow() > 1) {
        var data = sheet.getDataRange().getValues();
        var allRows = data.slice(1);
        
        // A. Recent 5 Days
        var last5Rows = allRows.slice(-5);
        
        // B. Last 10 with Action Records (有"操作紀錄")
        var actionRows = allRows.filter(function(row) {
          // Action Log is at index 6
          return row[6] && row[6] !== '';
        });
        var last10Actions = actionRows.slice(-10);
        
        var htmlBody = "<h2>回測執行完成</h2>";
        htmlBody += "<p><b>最終淨值:</b> $" + finalValue.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + " (年化 " + cagr.toFixed(2) + "%)</p>";
        htmlBody += "<hr>";
        
        if (Analysis && Analysis.generateCombinedReport) {
             htmlBody += Analysis.generateCombinedReport(last5Rows, last10Actions);
        }
        
        var subject = '[回測]今年至今年化 spy N/A /本策略 N/A';
        if (last5Rows.length > 0) {
           var lastRow = last5Rows[last5Rows.length-1];
           // YTD Column is index 3 (row[3]) -> "16.35%/11.45%"
           var ytdStr = lastRow[3] || 'N/A';
           // Split "Spy/Port" -> "16.35%/11.45%"
           // Subject requested: "spy X%/本策略x%"
           // Assuming ytdStr is "Spy% / Port%" or "Spy%/Port%"
           // Let's just append it.
           subject = '[回測]今年至今年化 spy ' + ytdStr.replace('/', '/本策略');
        }
        if (Constants.NOTIFY_ONLY_ON_OPERATION) {
           // Check if there was any action in the LAST processed day.
           // Since we can process multiple days, we should check if ANY of the processed days had action?
           // OR just check the last day? 
           // Requirement says "當有操作時才寄信通知". If we run backtest for 1 year, we probably want to know result regardless?
           // Actually, this script is often run daily (trigger).
           // If run daily, last5Rows has the latest day at the end.
           // We check the LAST row's action.
           
           var lastDayAction = '';
           if (last5Rows.length > 0) {
              lastDayAction = last5Rows[last5Rows.length-1][6]; // Index 6 is ActionLog
           }
           
           if (!lastDayAction || lastDayAction === '') {
              Logger.log('設定為僅有操作時通知，今日無操作，跳過寄信。');
              return;
           }
        }

        Notifier.sendEmail(subject, htmlBody);
      }
    } catch (e) {
      Logger.log('Email報告發送失敗: ' + e);
    }
  }
};

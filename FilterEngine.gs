/**
 * FilterEngine.gs
 * 「老兵 The Veteran」策略專用過濾引擎
 * 4 層優先級版本：危機 > 鎖倉 > 趨勢 > 評分
 */

var FilterEngine = {

  /**
   * 檢查是否觸發危機模式 (Crisis Detection)
   * 規則：VIX >= 25 或 MDD >= 7%
   * @param {number} vix 當日 VIX
   * @param {Object} lastMaxValues 各資產歷史最高價 { VGT: 300, ... }
   * @param {Object} currentPrices 當日收盤價 { VGT: 280, ... }
   * @param {number} portfolioMdd 組合累積最大回撤 (小數, 正數代表 loss)
   * @returns {boolean} 是否處於危機
   */
  checkCrisis: function(vix, portfolioMdd) {
    var vixTrigger = vix >= Constants.CRISIS_CONFIG.VIX_THRESHOLD;
    var mddTrigger = portfolioMdd >= Constants.CRISIS_CONFIG.MDD_THRESHOLD;
    return vixTrigger || mddTrigger;
  },

  /**
   * 判斷是否滿足解除危機條件 (方案 A)
   * 規則：單日 VIX < 20 且 SPY 收盤價 > SPY 5日 EMA
   */
  checkCrisisExit: function(vix, day, buffer) {
    var vixSafe = vix < Constants.CRISIS_CONFIG.EXIT_VIX;
    
    var spySafe = false;
    var spy = Constants.BENCHMARK; // 'SPY'
    
    if (day[spy] && buffer && buffer.length > 0) {
      // 擷取最後 20 天的數據來計算 5日 EMA 以確保精度
      var lookbackSlice = buffer.slice(-20);
      var spyEma = Utils.calculateEMA(lookbackSlice, spy, Constants.CRISIS_CONFIG.EXIT_EMA_PERIOD || 5);
      if (spyEma > 0 && day[spy].close > spyEma) {
        spySafe = true;
      }
    }
    
    return vixSafe && spySafe;
  },

  /**
   * 檢查趨勢過濾 (Layer 3)
   * 規則：價格 < 100MA * 97% 且 近1月報酬 < -2% => 禁止持有 (除非鎖倉)
   * @param {Object} prices 當日價格資料
   * @param {Object} ma100  當日 100MA
   * @param {Object} monthlyReturns 近1月報酬
   * @returns {Object} allowedMap { VGT: true/false }
   */
  checkTrend: function(prices, ma100, monthlyReturns) {
    var allowed = {};
    Constants.TICKERS.forEach(function(t) {
      if (prices[t] && ma100[t] !== undefined) {
        var price = prices[t].close;
        var belowMa = false;
        
        var buffer = Constants.CONSTRAINTS.TREND_MA_BUFFER || 0.97;
        if (price > 0 && ma100[t] > 0) {
           belowMa = price < (ma100[t] * buffer);
        } 
        
        var minMom = Constants.CONSTRAINTS.TREND_MOM_MIN || -0.02;
        var negMom  = monthlyReturns[t] < minMom;
        
        // 若「低於均線緩衝值」且「月報酬低於動能閾值」，則禁止持有 (return false)
        if (belowMa && negMom) {
          allowed[t] = false;
        } else {
          allowed[t] = true;
        }
      } else {
        allowed[t] = true; // 資料不足預設允許
      }
    });
    return allowed;
  },

  /**
   * 檢查跳空開高 (Layer 3 Gap Up)
   * 規則：Open > PrevHigh * 1.005
   * @param {Object} day 當日資料
   * @param {Object} prevHighs 前日最高價
   * @returns {Object} gapSignals { VGT: true/false }
   */
  checkGapUp: function(day, prevHighs) {
    var signals = {};
    // User definition: Gap Up means no overlap with yesterday's price range.
    // Specifically for Up (向上跳空): Today's Low > Yesterday's High (今日最低價 > 昨日最高價).
    // Gap Range (真空區域): Yesterday's High <-> Today's Low.
    
    Constants.TICKERS.forEach(function(t) {
      if (day[t] && prevHighs[t]) {
        // Check if data exists (low and prevHigh)
        if (day[t].low > prevHighs[t]) {
          signals[t] = true;
        }
      }
    });
    return signals;
  }
};
/**
 * Utils.gs
 * 數學與統計工具函式
 */
var Utils = {
  /**
   * 計算移動平均
   */
  calculateMA: function(slice, ticker) {
    if (!slice || slice.length === 0) return 0;
    var sum = 0;
    var count = 0;
    for (var i = 0; i < slice.length; i++) {
      if (slice[i][ticker]) {
        sum += slice[i][ticker].close;
        count++;
      }
    }
    return count > 0 ? sum / count : 0;
  },

  /**
   * 計算區間報酬率
   */
  calculateReturns: function(slice, ticker) {
    if (slice.length < 2) return -999;
    var start = slice[0][ticker];
    var end = slice[slice.length - 1][ticker];
    if (!start || !end || start.adjClose <= 0) return -999;
    return (end.adjClose - start.adjClose) / start.adjClose;
  },

  /**
   * 計算夏普比率 (年化)
   */
  calculateSharpe: function(slice, ticker) {
    var returns = [];
    for (var i = 1; i < slice.length; i++) {
      var curr = slice[i][ticker];
      var prev = slice[i-1][ticker];
      if (curr && prev && prev.adjClose > 0 && curr.adjClose > 0) {
        returns.push((curr.adjClose - prev.adjClose) / prev.adjClose);
      }
    }
    if (returns.length < 2) return 0;
    
    var mean = returns.reduce(function(a, b) { return a + b; }, 0) / returns.length;
    var variance = returns.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / returns.length;
    var stdDev = Math.sqrt(variance);
    
    return stdDev === 0 ? 0 : (mean * 252) / (stdDev * Math.sqrt(252));
  },

  /**
   * 計算相關係數
   */
  calculateCorrelation: function(slice, t1, t2) {
    var n = slice.length;
    if (n < 2) return 0;
    
    var x = [], y = [];
    for (var i = 1; i < n; i++) {
        var p1c = slice[i][t1], p1p = slice[i-1][t1];
        var p2c = slice[i][t2], p2p = slice[i-1][t2];
        
        if (p1c && p1p && p2c && p2p && 
            p1p.adjClose > 0 && p2p.adjClose > 0 &&
            p1c.adjClose > 0 && p2c.adjClose > 0) {
            x.push((p1c.adjClose - p1p.adjClose)/p1p.adjClose);
            y.push((p2c.adjClose - p2p.adjClose)/p2p.adjClose);
        }
    }
    if (x.length < 2) return 0;

    var xMean = x.reduce(function(a,b){return a+b;},0)/x.length;
    var yMean = y.reduce(function(a,b){return a+b;},0)/y.length;
    
    var num = 0, denX = 0, denY = 0;
    for(var i=0; i<x.length; i++) {
        num += (x[i] - xMean) * (y[i] - yMean);
        denX += Math.pow(x[i] - xMean, 2);
        denY += Math.pow(y[i] - yMean, 2);
    }
    var den = Math.sqrt(denX * denY);
    return den === 0 ? 0 : num / den;
  },

  /**
   * 計算 Beta
   */
  calculateBeta: function(slice, asset, bench) {
      var n = slice.length;
      var x = [], y = []; // x = bench, y = asset
      for (var i = 1; i < n; i++) {
          var ac = slice[i][asset], ap = slice[i-1][asset];
          var bc = slice[i][bench], bp = slice[i-1][bench];
          
          if (ac && ap && bc && bp && 
              ap.adjClose > 0 && bp.adjClose > 0 &&
              ac.adjClose > 0 && bc.adjClose > 0) {
              x.push((bc.adjClose - bp.adjClose)/bp.adjClose);
              y.push((ac.adjClose - ap.adjClose)/ap.adjClose);
          }
      }
      if (x.length < 10) return 0;

      var xMean = x.reduce(function(a,b){return a+b;},0)/x.length;
      var yMean = y.reduce(function(a,b){return a+b;},0)/y.length;
      
      var num = 0, den = 0;
      for(var i=0; i<x.length; i++) {
          num += (x[i] - xMean) * (y[i] - yMean);
          den += Math.pow(x[i] - xMean, 2);
      }
      return Math.abs(den) < 1e-9 ? 0 : num / den;
  },

  /**
   * 格式化日期 (YYYY-MM-DD)
   */
  formatDate: function(date) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
};
